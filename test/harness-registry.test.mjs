import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HARNESS_REGISTRY, HARNESS_IDS, getHarness, getEnabledHarnesses,
} from '../lib/harness-registry.mjs';

test('HARNESS_REGISTRY — known harnesses', () => {
  assert.deepEqual(HARNESS_IDS, ['claude-code', 'pi', 'antigravity', 'grok', 'opencode']);
  assert.equal(HARNESS_REGISTRY.length, 5);
});

test('getHarness — claude-code watch config', () => {
  const h = getHarness('claude-code');
  assert.ok(h);
  assert.equal(h.id, 'claude-code');
  assert.ok(h.capabilities.pulse);
  assert.ok(h.capabilities.trace);
  assert.ok(h.watch.matchLogFile('D--src-foo/uuid.jsonl'));
  assert.equal(h.watch.matchLogFile('readme.txt'), false);

  const ctx = h.watch.ctxFromPath('D--src-foo/abc-def-123.jsonl');
  assert.equal(ctx.harness, 'claude-code');
  assert.equal(ctx.session_id, 'abc-def-123');
  assert.equal(ctx.slug, 'abc-def-');
  assert.equal(ctx.project_id, 'D--src-foo');

  assert.equal(h.watch.rebuildArg('D--src-foo/sess.jsonl'), '--session=D--src-foo/sess.jsonl');
});

test('getHarness — pi ctxFromPath extracts UUID from timestamp prefix', () => {
  const h = getHarness('pi');
  const ctx = h.watch.ctxFromPath('--D--src-ebrain--/2026-04-26T14-22-51-638Z_019dca2b.jsonl');
  assert.equal(ctx.harness, 'pi');
  assert.equal(ctx.session_id, '019dca2b');
});

test('getHarness — antigravity matches nested log paths', () => {
  const h = getHarness('antigravity');
  assert.ok(h.watch.matchLogFile('c7f6b422/.system_generated/logs/transcript.jsonl'));
  assert.ok(h.watch.matchLogFile('c7f6b422/.system_generated/logs/overview.txt'));
  assert.equal(h.watch.matchLogFile('c7f6b422/other.jsonl'), false);
  assert.equal(h.capabilities.tokens, false);
  assert.equal(h.capabilities.size_proxy, 'tool_calls');

  const ctx = h.watch.ctxFromPath('c7f6b422/.system_generated/logs/transcript.jsonl');
  assert.equal(ctx.harness, 'antigravity');
  assert.equal(ctx.session_id, 'c7f6b422');
});

test('getEnabledHarnesses — filters by id list', () => {
  const enabled = getEnabledHarnesses(['pi', 'antigravity']);
  assert.equal(enabled.length, 2);
  assert.ok(enabled.every(h => h.id === 'pi' || h.id === 'antigravity'));
});