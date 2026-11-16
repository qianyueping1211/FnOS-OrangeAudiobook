import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNewerVersion } from '../src/core/utils/versionCompare.ts';

test('a newer patch release counts as newer, an older one does not', () => {
  assert.equal(isNewerVersion('2.2.35', '2.2.34'), true);
  assert.equal(isNewerVersion('2.2.34', '2.2.35'), false);
  assert.equal(isNewerVersion('2.2.35', '2.2.35'), false);
});

test('segments compare as numbers, not as text', () => {
  assert.equal(isNewerVersion('2.2.10', '2.2.9'), true);
  assert.equal(isNewerVersion('2.2.9', '2.2.10'), false);
  assert.equal(isNewerVersion('2.3', '2.2.35'), true);
  assert.equal(isNewerVersion('2.2.35.1', '2.2.35'), true);
});

test('a leading v and an unknown version never claim to be newer', () => {
  assert.equal(isNewerVersion('v2.2.35', '2.2.34'), true);
  assert.equal(isNewerVersion('', '2.2.34'), false);
  assert.equal(isNewerVersion('unknown', '2.2.34'), false);
  assert.equal(isNewerVersion('2.2.35', 'unknown'), false);
  assert.equal(isNewerVersion(undefined, '2.2.34'), false);
});
