import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_KINDS, isNormalizedRecord } from '../lib/normalized-record.mjs';

test('RECORD_KINDS — contains expected kinds', () => {
  for (const k of [
    'user_turn', 'assistant_turn', 'tool_use', 'tool_result',
    'tokens', 'skill_invoke', 'context_reset', 'session_meta',
    'permission_mode', 'branch_change',
  ]) {
    assert.ok(RECORD_KINDS.includes(k), `missing kind: ${k}`);
  }
});

test('isNormalizedRecord — valid record', () => {
  assert.equal(isNormalizedRecord({
    kind: 'tool_use', ts: '2026-05-01T10:00:00.000Z', harness: 'claude-code', tool: 'Read',
  }), true);
});

test('isNormalizedRecord — rejects invalid', () => {
  assert.equal(isNormalizedRecord(null), false);
  assert.equal(isNormalizedRecord({ kind: 'bogus' }), false);
  assert.equal(isNormalizedRecord({ kind: 'user_turn' }), false);
});