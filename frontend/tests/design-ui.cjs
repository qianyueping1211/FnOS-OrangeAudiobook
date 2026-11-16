// Runs only in GitHub Actions. All content and API traffic are synthetic.
const { chromium, webkit } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.cwd();
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173'], { cwd: root, stdio: 'ignore' });
const base = 'http://127.0.0.1:4173';
const books = Array.from({ length: 30 }, (_, i) => ({
  id: 'book-' + i, library_id: 'library-1', title: ['山海之间', '长安十二时辰', '人间草木', '月亮与六便士', '山河故人', '浮生六记'][i % 6],
  author: ['王小川', '马伯庸', '汪曾祺'][i % 3], narrator: '书声工作室', description: '在日常的片刻里，与一个好故事相遇。让声音陪伴每一段旅程。',
  path: '/fixtures/book-' + i, hash: 'fixture-' + i, created_at: '2026-11-13T12:00:00Z', progress_percent: i * 7, cover_url: '/fixture-cover-' + i + '.svg',
}));
const user = { id: 'user-1', username: '听书的人', role: 'admin', uses_default_admin_credentials: false };
let hasToken = false;
let latest = '';
let installCalls = 0;
let refreshCalls = 0;
let writeCalls = 0;
let metadataEdits = 0;
let hasRecent = true;
let installerOverride = null;
const info = () => ({ current_version: '2.1.0', latest_version: latest, tag: latest ? 'v' + latest : '', notes: '本次更新统一了移动端与桌面端的阅读体验。', has_token: hasToken,
  checked_at: Math.floor(Date.now() / 1000), update_available: !!latest, installer: installerOverride || { state: 'idle', progress: 0, message: '' } });
// The running bundle's own version, so fixtures can describe an install that is
// genuinely newer than the page the update panel is rendered by.
const bumpPatch = version => {
  const parts = String(version || '0.0.0').split('.').map(part => Number.parseInt(part, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[parts.length - 1] += 1;
  return parts.join('.');
};

async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Preview did not start');
}
async function fixture(context, gated = false) {
  const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
  const auth = gate(), settings = gate(), optional = gate();
  const counts = {};
  let authSeen;
  const authStarted = new Promise(resolve => { authSeen = resolve; });
  const controls = { counts, authStarted, releaseAuth: auth.release, releaseSettings: settings.release, releaseOptional: optional.release };
  let startup = gated;
  await context.addInitScript(user => {
    localStorage.setItem('auth_token', 'synthetic-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('language', 'zh-CN');
    window.__playCalls = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__playCalls++; return play.call(this); };
  }, user);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('.svg') || url.pathname.includes('/api/proxy/cover')) {
      const index = +(url.pathname.match(/\d+/)?.[0] || 0);
      const colors = ['#55506c', '#665348', '#45645a', '#5a5772', '#6b4e62', '#4a5a6d'];
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="' + colors[index % colors.length] + '"/><path d="M18 0v400" stroke="white" opacity=".2"/><text x="150" y="195" text-anchor="middle" fill="#fff" font-family="serif" font-size="36">山海之间</text><text x="150" y="255" text-anchor="middle" fill="#ddd" font-size="16">有声作品 · ' + (index + 1) + '</text></svg>' });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let result = [];
    const p = url.pathname.replace('/api/v1/', '/api/');
    counts[p] = (counts[p] || 0) + 1;
    if (startup && ['/api/me', '/api/auth/session-restore'].includes(p)) { authSeen(); await auth.promise; }
    if (startup && p === '/api/settings') await settings.promise;
    if (startup && ['/api/favorites', '/api/playlists', '/api/series'].includes(p)) await optional.promise;
    if (p === '/api/me') result = user;
    else if (p === '/api/auth/session-restore') result = { user, token: 'synthetic-session' };
    // A phone that keeps the home page to one screen: every switch in
    // 个性化设置 → 首页调整 except hero / stats / latest books is off.
    else if (p === '/api/settings') result = { theme: 'dark', language: 'zh-CN', bookshelf_progress_enabled: true, settings_json: { bookshelf_cover_shape: 'rect', home_layout: { show_hero: true, show_stats: true, show_recommended: false, show_recent: false, show_recently_added: true, show_collections: false } } };
    else if (p === '/api/system/time-zone') result = { time_zone: 'Asia/Shanghai' };
    else if (p === '/api/health') result = { version: '2.1.0', status: 'ok' };
    else if (p === '/api/books') result = books;
    else if (p === '/api/books/page') {
      const pageSize = Number(url.searchParams.get('page_size') || 24);
      const offset = Number(url.searchParams.get('offset') || 0);
      const items = books.slice(offset, offset + pageSize);
      result = { items, total: books.length, page: Math.floor(offset / pageSize) + 1, page_size: pageSize };
    }
    else if (p === '/api/search') result = books;
    else if (p === '/api/scraper/sources') result = [];
    else if (p === '/api/books/book-0/refresh-files') { refreshCalls++; result = { chapters: 1 }; }
    else if (p === '/api/books/book-0/write-metadata') { writeCalls++; result = { task_id: 'synthetic-write' }; }
    else if (p === '/api/books/book-0/chapters') {
      // Two chapters: a multi-chapter book keeps the list on wide layouts and
      // opens it as a sheet on narrow ones.
      const chapters = [{ id: 'chapter-book-0', book_id: 'book-0', title: refreshCalls ? '改名后的章节' : '原始章节',
        path: '/fixtures/book-0/chapter.mp3', duration: 600, chapter_index: 1, is_extra: 0 },
      { id: 'chapter-book-0b', book_id: 'book-0', title: refreshCalls ? '改名后的第二章' : '原始第二章',
        path: '/fixtures/book-0/chapter2.mp3', duration: 600, chapter_index: 2, is_extra: 0 }];
      result = url.searchParams.has('limit') ? { chapters, total: 2, main_total: 2, extra_total: 0, chapter_type: 'main', offset: 0 } : chapters;
    }
    else if (p === '/api/books/book-0') {
      const book = { ...books[0], library_type: 'local', can_write_metadata_files: true, manual_corrected: false };
      if (request.method() === 'PATCH') {
        const edited = request.postDataJSON();
        assert.equal(edited.manual_corrected, true, 'Editing must default to locked metadata');
        metadataEdits++; result = { ...book, ...edited };
      } else result = book;
    }
    else if (p === '/api/libraries') result = [{ id: 'library-1', name: '我的有声书', path: '/fixtures', library_type: 'local', type: 'local' }];
    else if (p === '/api/progress/book-0') result = { id: 'progress-0', book_id: 'book-0', chapter_id: 'chapter-book-0', position: 120, updated_at: '2026-11-13T12:00:00Z' };
    else if (p === '/api/progress/recent') result = (hasRecent ? books.slice(0, 3) : []).map((book, i) => ({ id: 'progress-' + i, book_id: book.id, chapter_id: 'chapter-book-' + i, book_title: book.title, cover_url: book.cover_url,
      library_id: book.library_id, chapter_title: '第一章 · 故事的开始', position: 120 + i * 40, chapter_duration: 600, updated_at: '2026-11-13T12:00:00Z' }));
    else if (p === '/api/history/summary') result = { books: 3, chapters: 12, position_seconds: 7200 };
    else if (p === '/api/favorites') result = books.slice(2, 5);
    else if (p === '/api/scraper/sources') result = { sources: [] };
    else if (p === '/api/system/updates/token') { hasToken = request.method() === 'PUT'; result = { has_token: hasToken }; }
    else if (p === '/api/system/updates/check') { latest = '2.1.1'; result = info(); }
    else if (p === '/api/system/updates/install') { installCalls++; installerOverride = { state: 'downloading', progress: 0, network: '本机加速：127.0.0.1:7890', message: '正在读取并校验私有版本' }; result = info(); }
    else if (p === '/api/system/updates') result = info();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  const releaseOptional = controls.releaseOptional;
  controls.releaseOptional = () => { startup = false; releaseOptional(); };
  return controls;
}
(async () => {
  let browser;
  try {
    await ready();
    await mkdir(path.join(root, 'ui-artifacts'), { recursive: true });
    const reports = [];
    // --engine=chromium|webkit runs one engine on its own: the CI runner takes the
    // WebKit render process down when both engines share one long-lived process.
    const onlyEngine = (process.argv.find(argument => argument.startsWith('--engine=')) || '').slice('--engine='.length);
    for (const [engine, engineName] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
      if (onlyEngine && onlyEngine !== engineName) continue;
    browser = await engine.launch();
    const sizes = engineName === 'chromium'
      ? [['desktop', { width: 1440, height: 1000 }], ['iphone16pro', { width: 402, height: 874 }], ['iphone16promax', { width: 440, height: 956 }]]
      : [['iphone16pro', { width: 402, height: 874 }], ['iphone16promax', { width: 440, height: 956 }]];
    for (const [device, viewport] of sizes) {
      const mobile = device !== 'desktop';
      const name = engineName + '-' + device;
      const context = await browser.newContext({ viewport, locale: 'zh-CN', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
      const startup = await fixture(context, true);
      const page = await context.newPage();
      // A full document navigation must not interrupt the API fixtures of the
      // preceding screen. WebKit otherwise reports its aborted XHR as a CORS error.
      const navigateTo = async route => {
        if (page.url() !== 'about:blank') await page.waitForLoadState('networkidle');
        return page.goto(base + route);
      };
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(name + ' runtime error:', error.stack || error.message); });
      page.on('console', message => { if (message.type() === 'error') console.error(name + ' browser:', message.text()); });
      const started = Date.now();
      await navigateTo('/');
      await startup.authStarted;
      assert.equal(await page.locator('#main-content').count(), 0, 'Cached content must remain behind server authentication');
      startup.releaseAuth();
      await page.locator('.reader-home h1').waitFor();
      const headerMs = Date.now() - started;
      await page.locator('.reader-book-card').first().waitFor();
      assert.equal(startup.counts['/api/settings'], 1, 'Layout, home and cover settings must share one pending request');
      // 启动后播放器会在后台预热（数据就位、不可见也不出声），首页只要求它别被画出来。
      assert.equal(await page.locator('.reader-player:visible').count(), 0, 'An idle home must not show the player');
      reports.push({ engine: engineName, device, headerMs, latestBooksMs: Date.now() - started, sharedSettingsRequests: startup.counts['/api/settings'], optionalRequestsStillHeld: true });
      startup.releaseSettings();
      startup.releaseOptional();
      await page.locator('.reader-hero a.reader-button').filter({ hasText: '继续播放' }).waitFor();
      assert.equal(await page.getByText('今日推荐', { exact: true }).count(), 0, name + ' home must not label the hero as a daily recommendation');
      assert.match(await page.locator('.reader-hero a.reader-button').getAttribute('href'), /^\/player\?book=book-0&chapter=chapter-book-0$/);
      assert.match(await page.locator('.reader-hero-cover-link').getAttribute('href'), /^\/book\/book-0\?chapter_id=chapter-book-0$/);
      await page.locator('.reader-hero a.reader-button').click();
      await page.locator('.reader-player.is-page').waitFor();
      assert.equal(new URL(page.url()).pathname, '/player');
      await page.locator('.reader-player-book-cover').click();
      await page.waitForURL(url => /\/book\/book-0$/.test(new URL(url).pathname) && new URL(url).search === '?chapter_id=chapter-book-0');
      await page.locator('.reader-book-header').waitFor();
      await page.locator('.reader-mini-info').waitFor();
      await page.locator(mobile ? '.reader-tab[href="/"]' : '.reader-nav[href="/"]').click();
      await page.locator('.reader-hero-cover-link').click();
      await page.waitForURL(url => /\/book\/book-0$/.test(new URL(url).pathname) && new URL(url).search === '?chapter_id=chapter-book-0');
      await page.locator('.reader-book-header').waitFor();
      for (const [route, slug] of [['/', 'home'], ['/bookshelf', 'bookshelf'], ['/search', 'search'], ['/mine', 'settings'], ['/playlists', 'playlists']]) {
        await navigateTo(route);
        await page.waitForSelector('#main-content', { timeout: 20000 });
        await page.locator('h1').first().waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, name + '/' + slug + ' viewport overflow');
        assert.equal(await page.locator('.reader-tabs').isVisible(), mobile);
        if (slug === 'playlists') assert.equal(await page.locator('.reader-page.animate-in').count(), 0);
        if (slug === 'settings') {
          assert.equal(await page.locator('input[type=password]').count(), 0);
          assert.equal(await page.locator('.reader-settings-title').isVisible(), true);
          assert.equal(await page.getByText('通知与事件', { exact: true }).count(), 0);
          assert.equal(await page.locator('#main-content a[href="/admin/libraries"]').count(), 0);
          assert.equal(await page.locator('#main-content input').count(), 0);
          assert.equal(await page.locator('#main-content form').count(), 0);
          assert.equal(await page.getByText('管理听书记录、收藏、书单和个人偏好。', { exact: true }).count(), 0);
          const management = page.locator('#main-content section').filter({ has: page.getByRole('heading', { name: '设置与管理', exact: true }) });
          assert.equal(await management.locator('a').first().getAttribute('href'), '/about');
          assert.equal(await management.locator('a').first().innerText().then(text => text.split('\n')[0]), '系统更新');
          assert.equal(await page.locator('.reader-settings-title + section h2').innerText(), '我的内容');
          assert.equal(await page.locator('.reader-sidebar-toggle').count(), 0);
          if (mobile) {
            const main = page.locator('#main-content');
            await main.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
            const signOut = await page.getByRole('button', { name: '退出登录', exact: true }).boundingBox();
            const miniPlayer = page.locator('.reader-player.is-mini');
            const obstruction = await miniPlayer.isVisible()
              ? await miniPlayer.boundingBox()
              : await page.locator('.reader-tabs').boundingBox();
            assert.ok(signOut.y + signOut.height < obstruction.y, name + ' settings last action must clear floating controls');
          }
        }
        if (slug === 'home') {
          await page.locator('.reader-book-card').first().waitFor();
          assert.ok(await page.locator('.reader-book-card').count() >= 3);
          if (mobile) {
            // 手机首页定死一屏：只摆最新三本，其余卡片即使拿到了也不画。
            assert.ok(await page.locator('.reader-book-card:visible').count() <= 3, name + ' home must paint at most three newest books');
            const scrollerOverflow = await page.locator('.reader-home .reader-page-scroll').evaluate(element => getComputedStyle(element).overflowY);
            assert.equal(scrollerOverflow, 'hidden', name + ' home must not scroll on a phone');
          }
          // 为你推荐 / 最近收听 / 书单与系列 只由个性化设置里的开关决定：
          // 这份 mock 把它们关掉，首页就保持一屏三本。代码里始终保留这些区块。
          assert.equal(await page.getByRole('heading', { name: '为你推荐', exact: true }).count(), 0);
          assert.equal(await page.locator('.reader-brand strong').textContent(), '橙子听书');
          assert.equal(await page.locator('.reader-brand img').evaluate(image => image.complete && image.naturalWidth > 0), true);
          if (mobile) {
            const toolbar = page.locator('.reader-home .reader-page-toolbar');
            const scroller = page.locator('.reader-home .reader-page-scroll');
            const beforeTop = (await toolbar.boundingBox()).y;
            await scroller.evaluate(element => element.scrollTo({ top: 360, behavior: 'instant' }));
            assert.equal(Math.round((await toolbar.boundingBox()).y), Math.round(beforeTop), name + ' home toolbar moved with content');
            assert.equal(await toolbar.evaluate(element => parseFloat(getComputedStyle(element).marginBottom)), 0, name + ' toolbar gap matches home');
            assert.equal(await page.locator('#main-content').evaluate(element => element.scrollTop), 0);
          }
          const heroCover = await page.locator('.reader-hero-cover').boundingBox();
          assert.ok(Math.abs(heroCover.width - heroCover.height) <= 1, name + ' home hero cover must be square');
          assert.equal(await page.locator('.reader-hero-cover').evaluate(element => getComputedStyle(element).transform), 'none');
          if (mobile) {
            // The bar highlights on press, so the page has to follow the press:
            // a tap whose click never arrives must still open the page instead of
            // leaving the highlight on a page that was never shown.
            await page.locator('.reader-tabs .reader-tab', { hasText: '书架' }).first().dispatchEvent('pointerdown');
            await page.locator('.reader-bookshelf-page').waitFor();
            assert.equal(new URL(page.url()).pathname, '/bookshelf', name + ' bottom tab opens on press alone');
            assert.equal(await page.locator('.reader-tabs .reader-tab', { hasText: '书架' }).first().getAttribute('aria-current'), 'page', name + ' bottom tab highlights the page it opened');
            await page.locator('.reader-tabs .reader-tab', { hasText: '首页' }).first().tap();
            await page.locator('.reader-home').waitFor();
            assert.equal(new URL(page.url()).pathname, '/', name + ' bottom tab returns home');
            assert.equal(await page.locator('.reader-tabs .reader-tab', { hasText: '首页' }).first().getAttribute('aria-current'), 'page', name + ' bottom tab highlight follows back home');
          }
        }
        if (slug === 'search') {
          const input = page.locator('.reader-search-field input');
          assert.equal(await input.getAttribute('autofocus'), null);
          const before = await page.evaluate(() => ({ width: innerWidth, scale: visualViewport?.scale || 1 }));
          if (mobile) assert.ok(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize)) >= 16);
          await input.fill('山海');
          await page.locator('.reader-book-card').first().waitFor();
          if (mobile) {
            // Search shares the home/bookshelf chrome now: one fixed top bar with
            // the same bar-to-content gap, and only the results pane scrolling.
            const toolbar = page.locator('.reader-search-page .reader-page-toolbar');
            const scroller = page.locator('.reader-search-page .reader-page-scroll');
            assert.equal(await toolbar.evaluate(element => parseFloat(getComputedStyle(element).marginBottom)), 0, name + ' search toolbar gap matches home');
            const searchTop = (await toolbar.boundingBox()).y;
            await scroller.evaluate(element => element.scrollTo({ top: 360, behavior: 'instant' }));
            assert.equal(Math.round((await toolbar.boundingBox()).y), Math.round(searchTop), name + ' search toolbar moved with content');
            assert.equal(await page.locator('#main-content').evaluate(element => element.scrollTop), 0);
          }
          await input.blur();
          const after = await page.evaluate(() => ({ width: innerWidth, scale: visualViewport?.scale || 1 }));
          assert.deepEqual(after, before, name + ' search focus changed the visual viewport');
          await page.getByRole('button', { name: '展开筛选', exact: true }).click();
          await page.locator('#search-filters').waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.getByRole('button', { name: '清除筛选', exact: true }).click();
        }
        if (slug === 'bookshelf') {
          if (mobile) {
            const toolbar = page.locator('.reader-bookshelf-page .reader-page-toolbar');
            const scroller = page.locator('.reader-bookshelf-page .reader-page-scroll');
            const beforeTop = (await toolbar.boundingBox()).y;
            // The shelf pages on the server: one screen first, then more as the
            // reader scrolls - never the whole 30-book fixture in one response.
            await page.waitForFunction(() => document.querySelectorAll('.reader-bookshelf-page .reader-book-card').length >= 12);
            const firstCount = await page.locator('.reader-bookshelf-page .reader-book-card').count();
            assert.ok(firstCount >= 12, name + ' bookshelf paints a full first screen');
            assert.ok(firstCount <= 24, name + ' bookshelf does not load the whole library at once');
            await scroller.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
            await page.waitForFunction(before => document.querySelectorAll('.reader-bookshelf-page .reader-book-card').length > before, firstCount);
            assert.equal(Math.round((await toolbar.boundingBox()).y), Math.round(beforeTop), name + ' bookshelf toolbar moved with content');
            assert.equal(await toolbar.evaluate(element => parseFloat(getComputedStyle(element).marginBottom)), 0, name + ' toolbar gap matches home');
            assert.equal(await page.locator('#main-content').evaluate(element => element.scrollTop), 0);
          }
          await page.locator('.reader-display-trigger').click();
          const dialog = page.getByRole('dialog');
          await dialog.waitFor();
          const bounds = await dialog.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
          assert.ok(await dialog.locator('button[aria-pressed=true]').count() >= 3);
          await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-filters.png') });
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
          assert.equal(await page.locator('.reader-display-trigger').evaluate(element => element === document.activeElement), true);
        }
        await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-' + slug + '.png'), fullPage: false });
      }
      hasRecent = false;
      await navigateTo('/player');
      await page.getByText('还没有正在播放的书籍', { exact: true }).waitFor();
      assert.equal(await page.locator('audio').count(), 0);
      hasRecent = true;
      await page.reload();
      await page.locator('.reader-player.is-page').waitFor();
      if (mobile) {
        // The playback page is immersive: no tab bar at all.
        assert.equal(await page.locator('.reader-tabs').isVisible(), false, name + ' playback page must hide the bottom navigation');
      } else {
        assert.equal(await page.locator('.reader-sidebar a[href="/player"]').innerText().then(text => text.trim()), '播放');
      }
      assert.equal(await page.locator('audio').count(), 1);
      assert.equal(await page.evaluate(() => window.__playCalls), 0, 'Loading recent playback must stay paused');
      assert.equal(await page.locator('.reader-mini-info').count(), 0, 'Player page must not render a mini player');
      await page.locator('audio').evaluate(audio => { audio.dataset.navigationIdentity = 'same-player'; });
      await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-player.png'), fullPage: false });
      const nav = !mobile ? '.reader-sidebar nav' : '.reader-tabs';
      if (mobile) {
        // The player page hides the tab bar, so leave it through the header's
        // collapse control - still an in-app navigation, no reload.
        await page.getByRole('button', { name: '收起播放器', exact: true }).click();
      } else {
        await page.locator(nav + ' a[href="/bookshelf"]').click();
      }
      await page.locator('.reader-mini-info').waitFor();
      assert.equal(await page.locator('audio').getAttribute('data-navigation-identity'), 'same-player');
      await page.locator(nav + ' a[href="/mine"]').click();
      await page.locator('.reader-mini-info').waitFor();
      assert.equal(await page.locator('.reader-player.is-mini').evaluate(element => getComputedStyle(element).position), 'fixed');
      if (mobile) assert.equal(await page.locator('.reader-tabs').evaluate(element => getComputedStyle(element).position), 'fixed');
      // 手机端接管了历史：站内跳转一律覆盖当前这一条，一次点按不增加历史，
      // 右滑才没有可退的上一页（没有系统整页滑动动画，也不会换分区）。
      if (mobile) {
        assert.equal(await page.locator('.reader-tab.is-active').getAttribute('href'), '/mine');
        const historyDepth = await page.evaluate(() => history.length);
        await page.locator('.reader-tab[href="/bookshelf"]').click();
        await page.waitForFunction(() => location.pathname === '/bookshelf');
        assert.equal(await page.evaluate(() => history.length), historyDepth, name + ' one tap must not add a history entry on mobile');
        assert.equal(await page.locator('.reader-tab.is-active').getAttribute('href'), '/bookshelf');
      }
      await page.locator(nav + ' a[href="/bookshelf"]').click();
      await page.locator('.reader-library-search').click();
      await page.locator('.reader-player.is-mini').evaluate(async element => {
        await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
      });
      const miniBefore = await page.locator('.reader-player.is-mini').boundingBox();
      const tabsBefore = mobile ? await page.locator('.reader-tabs').boundingBox() : null;
      await page.locator('.reader-search-field input').fill('山海');
      await page.locator('.reader-book-card').first().waitFor();
      await page.locator('.reader-search-field input').blur();
      await page.locator('#main-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const miniAfter = await page.locator('.reader-player.is-mini').boundingBox();
      assert.ok(Math.abs(miniBefore.y - miniAfter.y) <= 1, name + ' mini-player moved while scrolling: ' + JSON.stringify({ miniBefore, miniAfter }));
      if (mobile) {
        const tabsAfter = await page.locator('.reader-tabs').boundingBox();
        assert.ok(Math.abs(tabsBefore.y - tabsAfter.y) <= 1 && Math.abs(tabsBefore.width - tabsAfter.width) <= 1);
      }
      assert.equal(await page.locator('audio').getAttribute('data-navigation-identity'), 'same-player');
      await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-floating-search.png') });
      await page.locator(nav + ' a[href="/player"]').click();
      await page.locator('.reader-player.is-page').waitFor();
      assert.equal(await page.locator('audio').getAttribute('data-navigation-identity'), 'same-player');
      assert.equal(await page.evaluate(() => window.__playCalls), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, name + '/player viewport overflow');
      refreshCalls = 0; writeCalls = 0; metadataEdits = 0;
      await navigateTo('/book/book-0');
      await page.getByRole('button', { name: '编辑', exact: true }).waitFor().catch(async error => {
        console.error(name + ' book details DOM:', await page.locator('body').innerText());
        console.error(name + ' runtime errors:', errors);
        await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-book-details-failure.png'), fullPage: true });
        throw error;
      });
      const headerBounds = await page.locator('.reader-book-header').boundingBox();
      assert.ok(headerBounds.width > 0 && headerBounds.x >= 0, name + ' book header renders');
      if (mobile) {
        // Narrow layouts keep the page short: the chapter list lives in a sheet.
        assert.equal(await page.locator('.reader-book-chapters').count(), 0, name + ' chapter list must not render inline on mobile');
      } else {
        const chapterBounds = await page.locator('.reader-book-chapters').boundingBox();
        assert.ok(Math.abs(headerBounds.x - chapterBounds.x) <= 1, name + ' book sections left alignment');
        assert.ok(Math.abs(headerBounds.width - chapterBounds.width) <= 1, name + ' book sections width alignment');
      }
      assert.equal(await page.getByRole('button', { name: '刷新文件', exact: true }).count(), 0);
      await page.getByRole('button', { name: '刮削', exact: true }).click();
      if (mobile) {
        // Close the scrape dialog first, then read the refreshed chapter list
        // out of the cover sheet - the same place a phone user opens it.
        await page.getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByRole('button', { name: '章节列表', exact: true }).click();
      }
      await page.getByText('改名后的章节', { exact: true }).waitFor();
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      const lock = page.getByRole('checkbox', { name: /锁定元数据/ });
      assert.equal(await lock.isChecked(), true);
      assert.equal(await page.getByRole('button', { name: '写入文件', exact: true }).count(), 0);
      await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-book-edit.png'), fullPage: false });
      // The edit dialog shares the manual scrape shell: the page behind it is
      // dimmed and blurred, and the header carries the close control.
      const editDialog = page.locator('.fixed.inset-0.z-\\[200\\]');
      const editMask = editDialog.locator('.absolute.inset-0');
      const editMaskBox = await editMask.boundingBox();
      const viewportSize = page.viewportSize();
      assert.ok(editMaskBox.width >= viewportSize.width - 1 && editMaskBox.height >= viewportSize.height - 1, name + ' edit dialog dims the whole page');
      assert.ok((await editMask.evaluate(element => getComputedStyle(element).backdropFilter)).includes('blur'), name + ' edit dialog blurs the page behind it');
      assert.equal(await editDialog.getByRole('button', { name: '关闭', exact: true }).count(), 1, name + ' edit dialog header close control');
      assert.equal((await editDialog.locator('h2').first().innerText()).trim(), '编辑书籍元数据', name + ' edit dialog carries the header title');
      await editDialog.getByRole('button', { name: '关闭', exact: true }).click();
      await lock.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      await lock.waitFor();
      // The 章节 tab keeps the chapter manager inside the dialog. Its list is
      // virtualized, so a container without a resolved height paints zero rows.
      await page.getByRole('button', { name: '章节', exact: true }).click();
      const chapterRows = page.locator('.chapter-tab-panel button', { hasText: '改名后的章节' });
      await chapterRows.first().waitFor();
      assert.ok(await chapterRows.count() >= 1, name + ' edit 章节 tab renders chapters');
      assert.ok((await page.locator('.chapter-tab-panel').boundingBox()).height > 0, name + ' edit 章节 tab keeps a measurable height');
      await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-book-edit-chapters.png'), fullPage: false });
      await page.getByRole('button', { name: '元数据', exact: true }).click();
      await lock.waitFor();
      assert.equal(await lock.isChecked(), true);
      await page.getByRole('button', { name: '保存', exact: true }).click();
      // The button changes its label to Saving before the async writes finish.
      await lock.waitFor({ state: 'hidden' });
      assert.equal(metadataEdits, 1);
      assert.equal(writeCalls, 1);
      assert.equal(refreshCalls, 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, name + '/book viewport overflow');
      if (!mobile) {
        await navigateTo('/about');
        await page.getByRole('button', { name: '检查更新', exact: true }).waitFor();
        assert.equal(await page.locator('.reader-update-panel').count(), 1);
        assert.equal(await page.locator('#main-content').getByText('橙子听书', { exact: true }).count(), 0, 'Update page must not repeat the app/version footer');
        await page.locator('input[type=password]').fill('ghp_readonly_synthetic_fixture_12345');
        await page.getByRole('button', { name: '保存令牌', exact: true }).click();
        await page.getByRole('button', { name: '删除令牌', exact: true }).waitFor();
        assert.equal(await page.locator('input[type=password]').inputValue(), '');
        assert.ok((await page.locator('input[type=password]').getAttribute('placeholder')).includes('•'));
        await page.getByRole('button', { name: '检查更新', exact: true }).click();
        await page.getByRole('button', { name: '升级', exact: true }).click();
        const confirm = page.getByRole('button', { name: '确认', exact: true });
        await confirm.waitFor();
        assert.equal(await confirm.evaluate(element => element === document.activeElement), true);
        assert.equal(installCalls, 0);
        await page.screenshot({ path: path.join(root, 'ui-artifacts', 'desktop-update-confirm.png') });
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await page.locator('input[type=password]').fill('ghp_changed_synthetic_fixture_12345');
        await page.getByRole('button', { name: '保存令牌', exact: true }).waitFor();
        const updateHeadingBefore = await page.locator('.reader-update-summary').boundingBox();
        await page.getByRole('button', { name: '升级', exact: true }).click();
        await page.getByRole('button', { name: '确认', exact: true }).click();
        await page.getByText('正在读取并校验私有版本', { exact: true }).waitFor();
        const updateMessage = await page.locator('.reader-update-message').innerText();
        assert.equal(updateMessage.includes('本机加速'), false, name + ' the in-progress status must not repeat the acceleration address');
        assert.equal(await page.locator('.reader-update-summary').boundingBox().then(b => b.y), updateHeadingBefore.y);
        assert.equal(installCalls, 1, 'This install call is intercepted by the synthetic fixture');
        // The freshly installed version is newer than this bundle and a further
        // release is already published: the upgrade entry has to stay reachable,
        // it must not be replaced by the reload hint.
        const installedVersion = bumpPatch(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
        installerOverride = { state: 'completed', progress: 100, message: '安装完成', version: installedVersion, network: '本机加速：127.0.0.1:7890' };
        latest = '9.9.0';
        await page.reload();
        await page.getByRole('button', { name: '升级', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '重新载入', exact: true }).count(), 0, name + ' a published release must keep the upgrade entry');
        // The acceleration address must not surface anywhere: it is not a user
        // facing fact, and rolling it in the primary button misled people into
        // thinking the upgrade had already changed something.
        assert.equal(await page.locator('.reader-marquee').count(), 0, name + ' the acceleration address must not ride in the upgrade button');
        assert.equal((await page.locator('.reader-update-actions').innerText()).includes('本机加速'), false, name + ' the acceleration address must stay out of the update actions');
        assert.equal(await page.locator('.reader-update-message').count(), 0, name + ' a stale install receipt must not open a status line');
        // Nothing newer is published, so the panel falls back to the reload hint,
        // and that reload must land on home rather than the update page.
        latest = '';
        await page.reload();
        await page.getByRole('button', { name: '重新载入', exact: true }).waitFor();
        // A finished install leaves its receipt in the status file forever; it must
        // not keep occupying the panel once there is nothing to install.
        assert.equal(await page.getByText('安装完成', { exact: true }).count(), 0, name + ' a stale install receipt stays hidden');
        assert.equal(await page.locator('.reader-marquee').count(), 0, name + ' no acceleration hint without a release');
        await page.getByRole('button', { name: '重新载入', exact: true }).click();
        await page.waitForURL(url => new URL(url).pathname === '/', { timeout: 15000 });
        await page.locator('.reader-home').waitFor();
        assert.equal(new URL(page.url()).pathname, '/', name + ' reload after an install lands on home');
        installerOverride = null;
      }
      if (mobile) {
        // The system update page is a fixed screen on a phone: panel, notes and
        // licences all sit inside one viewport, so the shell must not scroll it.
        await navigateTo('/about');
        await page.locator('.reader-update-panel').waitFor();
        const aboutScroller = await page.locator('.reader-about-page .reader-page-scroll').evaluate(element => getComputedStyle(element).overflowY);
        assert.equal(aboutScroller, 'hidden', name + ' the update page must not scroll on a phone');
        assert.equal((await page.locator('.reader-update-actions').innerText()).includes('本机加速'), false, name + ' the acceleration address must stay out of the update actions');
        await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-update-locked.png') });
      }
      assert.deepEqual(errors, [], name + ' runtime errors');
      await context.close();
    }
    await browser.close(); browser = null;
    }
    await writeFile(path.join(root, 'ui-artifacts', 'startup-report.json'), JSON.stringify(reports, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
