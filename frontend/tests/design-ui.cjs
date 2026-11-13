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
    else if (p === '/api/libraries') result = [{ id: 'library-1', name: '我的有声书', path: '/fixtures', library_type: 'local', type: 'local' }];
    else if (p === '/api/progress/recent') result = books.slice(0, 3).map((book, i) => ({ id: 'progress-' + i, book_id: book.id, chapter_id: 'chapter-' + i, book_title: book.title, cover_url: book.cover_url,
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
      page.on('pageerror', error => errors.push(error.message));
      for (const [route, slug] of [['/', 'home'], ['/bookshelf', 'bookshelf'], ['/search', 'search'], ['/mine', 'settings']]) {
        await page.goto(base + route);
        await page.waitForSelector('#main-content', { timeout: 20000 });
        await page.locator('h1').first().waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, name + '/' + slug + ' viewport overflow');
        assert.equal(await page.locator('.reader-tabs').isVisible(), name !== 'desktop');
        if (slug === 'home') assert.ok(await page.locator('.reader-book-card').count() >= 6);
        await page.screenshot({ path: path.join(root, 'ui-artifacts', name + '-' + slug + '.png'), fullPage: false });
      }
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
