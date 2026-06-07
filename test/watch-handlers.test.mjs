import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processWatchFilename } from '../lib/watch-handlers.mjs';

const ROOT = 'C:/fake/root';

test('processWatchFilename — claude-code jsonl', () => {
  const r = processWatchFilename('claude-code', 'D--src-foo/abc-def-123.jsonl', ROOT);
  assert.ok(r);
  assert.equal(r.ctx.harness, 'claude-code');
  assert.equal(r.ctx.session_id, 'abc-def-123');
  assert.equal(r.rebuildArg, '--session=D--src-foo/abc-def-123.jsonl');
  assert.equal(r.absPath, 'C:\\fake\\root\\D--src-foo\\abc-def-123.jsonl');
});

test('processWatchFilename — rejects non-log files', () => {
  assert.equal(processWatchFilename('claude-code', 'D--src-foo/readme.txt', ROOT), null);
  assert.equal(processWatchFilename('claude-code', null, ROOT), null);
});

test('processWatchFilename — pi extracts UUID from timestamp prefix', () => {
  const r = processWatchFilename(
    'pi',
    '--D--src-ebrain--/2026-04-26T14-22-51-638Z_019dca2b.jsonl',
    ROOT,
  );
  assert.ok(r);
  assert.equal(r.ctx.harness, 'pi');
  assert.equal(r.ctx.session_id, '019dca2b');
  assert.equal(r.rebuildArg, '--session=--D--src-ebrain--/2026-04-26T14-22-51-638Z_019dca2b.jsonl');
});

test('processWatchFilename — antigravity nested log path', () => {
  const r = processWatchFilename(
    'antigravity',
    'c7f6b422/.system_generated/logs/transcript.jsonl',
    ROOT,
  );
  assert.ok(r);
  assert.equal(r.ctx.harness, 'antigravity');
  assert.equal(r.ctx.session_id, 'c7f6b422');
  assert.equal(r.rebuildArg, null);
});

test('processWatchFilename — antigravity overview.txt', () => {
  const r = processWatchFilename(
    'antigravity',
    'c7f6b422/.system_generated/logs/overview.txt',
    ROOT,
  );
  assert.ok(r);
  assert.equal(r.ctx.session_id, 'c7f6b422');
});

test('processWatchFilename — unknown harness', () => {
  assert.equal(processWatchFilename('grok', 'foo.jsonl', ROOT), null);
});