import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScopedRead } from '../src/core/api/sharedRead.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('concurrent consumers share settings but the next visit always reads fresh data', async () => {
  const responses = [deferred<number>(), deferred<number>()];
  let calls = 0;
  const read = createScopedRead(() => responses[calls++].promise, () => 'same-session');
  const layout = read(), cover = read(), home = read();
  assert.equal(calls, 1);
  assert.equal(layout, cover);
  assert.equal(cover, home);
  responses[0].resolve(1);
  assert.deepEqual(await Promise.all([layout, cover, home]), [1, 1, 1]);
  const next = read();
  assert.equal(calls, 2);
  responses[1].resolve(2);
  assert.equal(await next, 2);
});

test('responses from a replaced account or server cannot update the new session', async () => {
  let scope = 'server-a/alice';
  const oldResponse = deferred<string>(), newResponse = deferred<string>();
  const read = createScopedRead(() => scope === 'server-a/alice' ? oldResponse.promise : newResponse.promise, () => scope);
  const oldRead = read();
  const rejection = assert.rejects(oldRead, /obsolete session/);
  scope = 'server-b/bob';
  const next = read();
  oldResponse.resolve('alice-settings');
  await rejection;
  assert.equal(read(), next);
  newResponse.resolve('bob-settings');
  assert.equal(await next, 'bob-settings');
});

test('failed shared reads do not poison a later retry', async () => {
  let calls = 0;
  const read = createScopedRead(async () => {
    if (++calls === 1) throw new Error('offline');
    return 'restored';
  }, () => 'session');
  await assert.rejects(read(), /offline/);
  assert.equal(await read(), 'restored');
  assert.equal(calls, 2);
});

import { isMiniPlayerHiddenPath } from '../src/features/player/platform.ts';
test('only the full playback route hides the mini player', () => {
  assert.equal(isMiniPlayerHiddenPath('/player'), true);
  for (const path of ['/', '/search', '/book/a', '/mine', '/about', '/admin/libraries', '/personalization', '/plugin-pages/a/b']) {
    assert.equal(isMiniPlayerHiddenPath(path), false, path);
  }
});
