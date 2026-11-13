// Real browser check of the packaged SPA inside a same-origin fnOS-like window.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ting-frame-'));
  const socket = path.join(root, 'reader.sock');
  const env = { ...process.env,
    FNNAS_GATEWAY_ONLY: '1', FNNAS_GATEWAY_SOCKET: socket, FNNAS_GATEWAY_PREFIX: '/app/ting-reader',
    STATIC_DIR: path.resolve('.github/ting-reader-fpk-native/app/server/static'),
    TING_DATABASE__PATH: path.join(root, 'data/reader.db'), TING_STORAGE__DATA_DIR: path.join(root, 'data'),
    TING_STORAGE__TEMP_DIR: path.join(root, 'temp'), TING_STORAGE__LOCAL_STORAGE_ROOT: path.join(root, 'storage'),
    TING_PLUGINS__PLUGIN_DIR: path.join(root, 'plugins'), TING_LOGGING__OUTPUT: 'stdout' };
  const child = spawn(path.resolve(process.argv[2]), [], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', b => { log += b; });
  child.stderr.on('data', b => { log += b; });
  const proxy = http.createServer((req, res) => {
    if (req.url === '/desktop') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>fnOS window test</title><iframe title="Ting Reader" src="/app/ting-reader/" style="width:100%;height:900px"></iframe>');
      return;
    }
    const upstream = http.request({ socketPath: socket, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end('Gateway not ready'); });
    req.pipe(upstream);
  });
  let browser;
  try {
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + proxy.address().port;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Server exited: ' + log);
      try {
        const health = await fetch(origin + '/api/health');
        if (health.ok) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 402, height: 874 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(origin + '/desktop');
      const iframe = page.frameLocator('iframe');
      await iframe.locator('#root > *').first().waitFor({ state: 'attached', timeout: 30000 });
      const frame = page.frames().find(f => f.url().includes('/app/ting-reader/'));
      assert.ok(frame, 'The same-origin application frame must load');
      await frame.waitForFunction(() => Boolean(document.querySelector('#root')?.textContent.trim()), null, { timeout: 30000 });
      await context.close();
    }
    console.log('Desktop and mobile browsers rendered the real packaged SPA in a same-origin iframe.');
  } finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await new Promise(resolve => proxy.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
