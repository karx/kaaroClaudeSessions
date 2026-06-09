/**
 * test/pulse-transformer.test.mjs — TDD tests for lib/pulse-transformer.mjs
 *
 * Every NormalizedRecord kind must emit ≥1 pulse. New event types introduced
 * by the full-cognitive-experience refactor are covered here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normRecordsToPulses } from '../lib/pulse-transformer.mjs';

const CTX = {
  session_id:    'aaaabbbb-0000-0000-0000-000000000000',
  slug:          'aaaabbbb',
  project_label: 'test-proj',
  harness:       'claude-code',
};

const TS = '2026-06-09T10:00:00.000Z';

// ── tool_use → tool_call pulse ───────────────────────────────────────────────

test('tool_use NR → tool_call pulse with canonical key', () => {
  const nrs = [{ kind: 'tool_use', harness: 'claude-code', ts: TS,
    tool: 'Read', key: 'read', input: { file_path: 'src/index.mjs' } }];
  const pulses = normRecordsToPulses(nrs, CTX);
  assert.equal(pulses.length, 1);
  assert.equal(pulses[0].event, 'tool_call');
  assert.equal(pulses[0].data.key, 'read');
  assert.equal(pulses[0].data.tool, 'Read');
  assert.equal(pulses[0].data.slug, CTX.slug);
  assert.equal(pulses[0].data.harness, CTX.harness);
});

test('tool_use NR → tool_call pulse preserves where from file_path', () => {
  const nrs = [{ kind: 'tool_use', harness: 'claude-code', ts: TS,
    tool: 'Write', key: 'write', input: { file_path: 'out/result.mjs' } }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.data.where, 'out/result.mjs');
});

// ── tokens NR → tokens pulse ─────────────────────────────────────────────────

test('tokens NR → tokens pulse', () => {
  const nrs = [{ kind: 'tokens', harness: 'claude-code', ts: TS,
    tokens: { input: 500, output: 200, cache_create: 0, cache_read: 8000 } }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'tokens');
  assert.equal(pulse.data.input, 500);
  assert.equal(pulse.data.output, 200);
  assert.equal(pulse.data.cache_read, 8000);
  assert.ok(!pulse.data.synthetic);
});

// ── content_block → words / chirp ────────────────────────────────────────────

test('content_block text ≥3 words → words pulse', () => {
  const nrs = [{ kind: 'content_block', harness: 'claude-code', ts: TS,
    block_type: 'text', text: 'Running the tests now.' }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'words');
  assert.ok(pulse.data.word_count >= 3);
  assert.ok(pulse.data.preview.length > 0);
});

test('content_block text <3 words → chirp pulse', () => {
  const nrs = [{ kind: 'content_block', harness: 'claude-code', ts: TS,
    block_type: 'text', text: 'Got it.' }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'chirp');
  assert.ok(pulse.data.word_count < 3);
});

test('content_block non-text type → unknown pulse (not words/chirp)', () => {
  const nrs = [{ kind: 'content_block', harness: 'claude-code', ts: TS,
    block_type: 'thinking' }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.ok(pulse.event !== 'words' && pulse.event !== 'chirp');
});

// ── user_turn → human_turn pulse ─────────────────────────────────────────────

test('user_turn NR → human_turn pulse', () => {
  const nrs = [{ kind: 'user_turn', harness: 'claude-code', ts: TS,
    text: 'Run all the tests please' }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'human_turn');
  assert.equal(pulse.data.slug, CTX.slug);
});

// ── context_reset → compact pulse ────────────────────────────────────────────

test('context_reset NR → compact pulse', () => {
  const nrs = [{ kind: 'context_reset', harness: 'claude-code', ts: TS }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'compact');
});

// ── permission_mode → permission pulse ───────────────────────────────────────

test('permission_mode NR → permission pulse', () => {
  const nrs = [{ kind: 'permission_mode', harness: 'claude-code', ts: TS, mode: 'default' }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'permission');
  assert.equal(pulse.data.mode, 'default');
});

// ── scaffold → scaffold pulse ─────────────────────────────────────────────────

test('scaffold NR → scaffold pulse', () => {
  const nrs = [{ kind: 'scaffold', harness: 'antigravity', ts: TS,
    content_preview: 'You are in planning mode.' }];
  const ctx = { ...CTX, harness: 'antigravity' };
  const [pulse] = normRecordsToPulses(nrs, ctx);
  assert.equal(pulse.event, 'scaffold');
  assert.equal(pulse.data.content_preview, 'You are in planning mode.');
});

// ── tool_result error/success ─────────────────────────────────────────────────

test('tool_result error:true → tool_error pulse', () => {
  const nrs = [{ kind: 'tool_result', harness: 'claude-code', ts: TS,
    error: true, tool: 'Bash' }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'tool_error');
  assert.equal(pulse.data.tool, 'Bash');
});

test('tool_result error:false → tool_result pulse', () => {
  const nrs = [{ kind: 'tool_result', harness: 'claude-code', ts: TS,
    error: false, tool: 'Read' }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'tool_result');
});

// ── unknown_record → unknown pulse ───────────────────────────────────────────

test('unknown_record NR → unknown pulse with raw_type', () => {
  const nrs = [{ kind: 'unknown_record', harness: 'claude-code', ts: TS,
    raw_type: 'some_future_type' }];
  const [pulse] = normRecordsToPulses(nrs, CTX);
  assert.equal(pulse.event, 'unknown');
  assert.equal(pulse.data.raw_type, 'some_future_type');
});

// ── catch-all invariant ───────────────────────────────────────────────────────

test('unmapped NR kind → unknown pulse (catch-all never drops)', () => {
  const nrs = [{ kind: 'branch_change', harness: 'claude-code', ts: TS, branch: 'main' }];
  const pulses = normRecordsToPulses(nrs, CTX);
  assert.equal(pulses.length, 1);
  assert.equal(pulses[0].event, 'unknown');
});

test('every NR in a mixed batch emits ≥1 pulse', () => {
  const nrs = [
    { kind: 'tool_use', harness: 'claude-code', ts: TS, tool: 'Read', key: 'read', input: {} },
    { kind: 'tokens', harness: 'claude-code', ts: TS, tokens: { input: 100, output: 50, cache_create: 0, cache_read: 0 } },
    { kind: 'user_turn', harness: 'claude-code', ts: TS, text: 'Do this please' },
    { kind: 'context_reset', harness: 'claude-code', ts: TS },
    { kind: 'permission_mode', harness: 'claude-code', ts: TS, mode: 'bypass' },
    { kind: 'assistant_turn', harness: 'claude-code', ts: TS },
    { kind: 'session_meta', harness: 'claude-code', ts: TS, slug: 'x' },
    { kind: 'branch_change', harness: 'claude-code', ts: TS, branch: 'feat/x' },
    { kind: 'skill_invoke', harness: 'claude-code', ts: TS, skill: 'review' },
  ];
  const pulses = normRecordsToPulses(nrs, CTX);
  assert.equal(pulses.length, nrs.length, 'each NR must produce exactly 1 pulse in this batch');
});

// ── synthetic tokens from assistant_turn ─────────────────────────────────────

test('assistant_turn + capabilities.tokens:false → synthetic tokens pulse', () => {
  const nrs = [{ kind: 'assistant_turn', harness: 'antigravity', ts: TS,
    content_length: 400 }];
  const ctx = { ...CTX, harness: 'antigravity' };
  const [pulse] = normRecordsToPulses(nrs, ctx, { tokens: false });
  assert.equal(pulse.event, 'tokens');
  assert.ok(pulse.data.synthetic);
  assert.ok(pulse.data.output > 0, 'estimated output tokens from content_length/4');
});

test('assistant_turn + capabilities.tokens:true → unknown pulse (no duplicate tokens)', () => {
  const nrs = [{ kind: 'assistant_turn', harness: 'claude-code', ts: TS }];
  const [pulse] = normRecordsToPulses(nrs, CTX, { tokens: true });
  assert.notEqual(pulse.event, 'tokens');
});
