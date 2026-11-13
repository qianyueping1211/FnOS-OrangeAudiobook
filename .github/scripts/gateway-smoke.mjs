// The configured TCP port is occupied. Only a Unix-socket-only server can pass.
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ting-gateway-'));
const occupied = net.createServer();
await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
const socket = path.join(root, 'ting.sock');
const env = { ...process.env, FNNAS_GATEWAY_ONLY: '1', FNNAS_GATEWAY_SOCKET: socket, FNNAS_GATEWAY_PREFIX: '/app/ting-reader',
  TING_SERVER__HOST: '127.0.0.1', TING_SERVER__PORT: String(occupied.address().port), TING_DATABASE__PATH: path.join(root, 'data/reader.db'),
  TING_STORAGE__DATA_DIR: path.join(root, 'data'), TING_STORAGE__TEMP_DIR: path.join(root, 'temp'), TING_STORAGE__LOCAL_STORAGE_ROOT: path.join(root, 'storage'),
  TING_PLUGINS__PLUGIN_DIR: path.join(root, 'plugins'), TING_LOGGING__OUTPUT: 'stdout' };
const child = spawn(path.resolve(process.argv[2]), [], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', bytes => { log += bytes; });
child.stderr.on('data', bytes => { log += bytes; });
const request = pathname => new Promise((resolve, reject) => {
  const req = http.get({ socketPath: socket, path: pathname }, response => {
    let body = ''; response.on('data', bytes => { body += bytes; }); response.on('end', () => resolve({ code: response.statusCode, body }));
  });
  req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('timeout')));
});
try {
  let health;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + log);
    try { health = await request('/api/health'); if (health.code === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(health?.code, 200, log);
  assert.equal(JSON.parse(health.body).status, 'healthy');
  const protectedRoute = await request('/api/system/updates');
  assert.ok([401, 403].includes(protectedRoute.code), 'Updates must require authentication');
  console.log('Gateway-only health passed while the configured TCP port remained occupied.');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  occupied.close();
  await fs.rm(root, { recursive: true, force: true });
}
