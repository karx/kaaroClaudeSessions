/**
 * test/analyze-helpers.test.mjs → hooks/helpers/analyze-helpers.mjs (canonicalProjectId)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalProjectId } from '../hooks/helpers/analyze-helpers.mjs';

test('canonicalProjectId — strips Pi wrapping dashes and uppercases the drive letter', () => {
  assert.equal(canonicalProjectId('D--src-ebrain'), 'D--src-ebrain');
  assert.equal(canonicalProjectId('--D--src-ebrain--'), 'D--src-ebrain');
  assert.equal(canonicalProjectId('d--src-ebrain'), 'D--src-ebrain');
  assert.equal(canonicalProjectId('D--src-kaaroSessions'), 'D--src-kaaroSessions');
  assert.equal(canonicalProjectId('--D--src-kaaroSessions--'), 'D--src-kaaroSessions');
});

test('canonicalProjectId — Command Code users-<user>- prefix strips once when the remainder is drive-shaped', () => {
  assert.equal(canonicalProjectId('users-bob-D--src-ebrain'), 'D--src-ebrain');
});

test('canonicalProjectId — leaves a non-drive-shaped id unchanged (no false merge)', () => {
  assert.equal(canonicalProjectId('users-bob-kaaro-src-x'), 'users-bob-kaaro-src-x');
});

test('canonicalProjectId — idempotent', () => {
  for (const id of ['D--src-ebrain', '--D--src-ebrain--', 'd--src-ebrain', 'users-bob-D--src-ebrain']) {
    const once = canonicalProjectId(id);
    assert.equal(canonicalProjectId(once), once);
  }
});
