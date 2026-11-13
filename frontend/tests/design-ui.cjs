// Runs only in GitHub Actions. All content and API traffic are synthetic.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.cwd();
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173'], { cwd: root, stdio: 'ignore' });
const base = 'http://127.0.0.1:4173';
const books = Array.from({ length: 12 }, (_, i) => ({
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
const info = () => ({ current_version: '2.1.0', latest_version: latest, tag: latest ? 'v' + latest : '', notes: '本次更新统一了移动端与桌面端的阅读体验。', has_token: hasToken,
  checked_at: Math.floor(Date.now() / 1000), update_available: !!latest, installer: { state: 'idle', progress: 0, message: '' } });
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Preview did not start');
}
async function fixture(context) {
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
    if (p === '/api/me') result = user;
    else if (p === '/api/auth/session-restore') result = { user, token: 'synthetic-session' };
    else if (p === '/api/settings') result = { theme: 'dark', language: 'zh-CN', bookshelf_progress_enabled: true, settings_json: { bookshelf_cover_shape: 'rect' } };
    else if (p === '/api/system/time-zone') result = { time_zone: 'Asia/Shanghai' };
    else if (p === '/api/health') result = { version: '2.1.0', status: 'ok' };
    else if (p === '/api/books' || p === '/api/search') result = books;
    else if (p === '/api/books/book-0/refresh-files') { refreshCalls++; result = { chapters: 1 }; }
    else if (p === '/api/books/book-0/write-metadata') { writeCalls++; result = { task_id: 'synthetic-write' }; }
    else if (p === '/api/books/book-0/chapters') {
      const chapters = [{ id: 'chapter-book-0', book_id: 'book-0', title: refreshCalls ? '改名后的章节' : '原始章节',
        path: '/fixtures/book-0/chapter.mp3', duration: 600, chapter_index: 1, is_extra: 0 }];
      result = url.searchParams.has('limit') ? { chapters, total: 1, main_total: 1, extra_total: 0, chapter_type: 'main', offset: 0 } : chapters;
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
    else if (p === '/api/progress/recent') result = (hasRecent ? books.slice(0, 3) : []).map((book, i) => ({ id: 'progress-' + i, book_id: book.id, chapter_id: 'chapter-book-' + i, book_title: book.title, cover_url: book.cover_url,
      library_id: book.library_id, chapter_title: '第一章 · 故事的开始', position: 120 + i * 40, chapter_duration: 600, updated_at: '2026-11-13T12:00:00Z' }));
    else if (p === '/api/history/summary') result = { books: 3, chapters: 12, position_seconds: 7200 };
    else if (p === '/api/favorites') result = books.slice(2, 5);
    else if (p === '/api/scraper/sources') result = { sources: [] };
    else if (p === '/api/system/updates/token') { hasToken = request.method() === 'PUT'; result = { has_token: hasToken }; }
    else if (p === '/api/system/updates/check') { latest = '2.1.1'; result = info(); }
    else if (p === '/api/system/updates/install') { installCalls++; result = info(); }
    else if (p === '/api/system/updates') result = info();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
}
(async () => {
  let browser;
  try {
    await ready();
    await mkdir(path.join(root, 'ui-artifacts'), { recursive: true });
    browser = await chromium.launch();
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['iphone16pro', { width: 402, height: 874 }], ['iphone16promax', { width: 440, height: 956 }]]) {
      const context = await browser.newContext({ viewport, locale: 'zh-CN', deviceScaleFactor: 1, serviceWorkers: 'block' });
      await fixture(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(name + ' runtime error:', error.stack || error.message); });
      page.on('console', message => { if (message.type() === 'error') console.error(name + ' browser:', message.text()); });
      for (const [route, slug] of [['/', 'home'], ['/bookshelf', 'bookshelf'], ['/search', 'search'], ['/mine', 'settings'], ['/playlists', 'playlists']]) {
        await page.goto(base + route);
        await page.waitForSelector('#main-content', { timeout: 20000 });
        await page.locator('h1').first().waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, name + '/' + slug + ' viewport overflow');
        assert.equal(await page.locator('.reader-tabs').isVisible(), name !== 'desktop');
        if (slug === 'playlists') assert.equal(await page.locator('.reader-page.animate-in').count(), 0);
        if (slug === 'settings') {
          assert.equal(await page.locator('input[type=password]').count(), 0);
          assert.equal(await page.getByText('通知与事件', { exact: true }).count(), 0);
          assert.equal(await page.locator('#main-content a[href="/admin/libraries"]').count(), 0);
          assert.equal(await page.locator('#main-content a[href="/about"]').count(), 0);
          assert.equal(await page.locator('.reader-sidebar-toggle').count(), 0);
        }
        if (slug === 'home') {
          assert.ok(await page.locator('.reader-book-card').count() >= 6);
          assert.equal(await page.locator('.reader-brand strong').textContent(), '橙子听书');
          assert.equal(await page.locator('.reader-brand img').evaluate(image => image.complete && image.naturalWidth > 0), true);
        }
        await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-' + slug + '.png'), fullPage: false });
      }
      hasRecent = false;
      await page.goto(base + '/player');
      await page.getByText('还没有正在播放的书籍', { exact: true }).waitFor();
      assert.equal(await page.locator('audio').count(), 0);
      hasRecent = true;
      await page.reload();
      await page.locator('.reader-player.is-page').waitFor();
      assert.equal(await page.locator('audio').count(), 1);
      assert.equal(await page.evaluate(() => window.__playCalls), 0, 'Loading recent playback must stay paused');
      assert.equal(await page.locator('.reader-mini-info').count(), 0, 'Player page must not render a mini player');
      await page.locator('audio').evaluate(audio => { audio.dataset.navigationIdentity = 'same-player'; });
      await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-player.png'), fullPage: false });
      const nav = name === 'desktop' ? '.reader-sidebar' : '.reader-tabs';
      await page.locator(nav + ' a[href="/bookshelf"]').click();
      await page.locator('.reader-mini-info').waitFor();
      assert.equal(await page.locator('audio').getAttribute('data-navigation-identity'), 'same-player');
      await page.locator(nav + ' a[href="/player"]').click();
      await page.locator('.reader-player.is-page').waitFor();
      assert.equal(await page.locator('audio').getAttribute('data-navigation-identity'), 'same-player');
      assert.equal(await page.evaluate(() => window.__playCalls), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, name + '/player viewport overflow');
      refreshCalls = 0; writeCalls = 0; metadataEdits = 0;
      await page.goto(base + '/book/book-0');
      await page.getByRole('button', { name: '编辑', exact: true }).waitFor().catch(async error => {
        console.error(name + ' book details DOM:', await page.locator('body').innerText());
        console.error(name + ' runtime errors:', errors);
        await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-book-details-failure.png'), fullPage: true });
        throw error;
      });
      const headerBounds = await page.locator('.reader-book-header').boundingBox();
      const chapterBounds = await page.locator('.reader-book-chapters').boundingBox();
      assert.ok(Math.abs(headerBounds.x - chapterBounds.x) <= 1, name + ' book sections left alignment');
      assert.ok(Math.abs(headerBounds.width - chapterBounds.width) <= 1, name + ' book sections width alignment');
      await page.getByRole('button', { name: '刷新文件', exact: true }).click();
      await page.getByText('改名后的章节', { exact: true }).waitFor();
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      const lock = page.getByRole('checkbox', { name: /锁定元数据/ });
      assert.equal(await lock.isChecked(), true);
      assert.equal(await page.getByRole('button', { name: '写入文件', exact: true }).count(), 0);
      await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-book-edit.png'), fullPage: false });
      await page.getByRole('button', { name: '保存', exact: true }).click();
      // The button changes its label to Saving before the async writes finish.
      await lock.waitFor({ state: 'hidden' });
      assert.equal(metadataEdits, 1);
      assert.equal(writeCalls, 1);
      assert.equal(refreshCalls, 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, name + '/book viewport overflow');
      if (name === 'desktop') {
        await page.goto(base + '/about');
        await page.getByRole('button', { name: '检查更新', exact: true }).waitFor();
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
      }
      assert.deepEqual(errors, [], name + ' runtime errors');
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
