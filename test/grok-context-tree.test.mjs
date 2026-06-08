import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructGrokContextTree } from '../lib/grok-context-tree.mjs';

const SESSION_ID = '019ea1c9-46ee-77e0-bf36-f87a6403b5db';
const TURN = 1780830788417;

function grokRec(update, meta = {}) {
  return {
    method: 'session/update',
    params: { sessionId: SESSION_ID, update },
    _meta: { agentTimestampMs: meta.ts || 1780831407026, turnStartMs: meta.turn ?? TURN },
  };
}

test('reconstructGrokContextTree — segments on compaction', () => {
  const records = [
    grokRec({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hello world!' } }, { ts: 1000 }),
    grokRec({
      sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Read',
      rawInput: { path: 'D:\\src\\foo.txt' },
    }, { ts: 2000 }),
    grokRec({ sessionUpdate: 'compaction_checkpoint', checkpoint_id: 'x' }, { ts: 3000, turn: null }),
    grokRec({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'After compact' } }, { ts: 4000 }),
  ];

  const tree = reconstructGrokContextTree(records, { ai_title: 'Test session' });
  assert.equal(tree.ai_title, 'Test session');
  assert.equal(tree.segments.length, 2);
  assert.equal(tree.segments[0].compact_trigger, 'auto');
  assert.equal(tree.segments[1].compact_trigger, null);
  assert.equal(tree.segments[0].user_turns, 1);
  assert.equal(tree.segments[0].tool_calls, 1);
  assert.equal(tree.segments[0].tool_summary.Read, 1);
  assert.equal(tree.segments[1].user_turns, 1);
});

test('reconstructGrokContextTree — groups tools into one assistant turn', () => {
  const records = [
    grokRec({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Go' } }),
    grokRec({
      sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Shell',
      rawInput: { command: 'node --test' },
    }),
    grokRec({
      sessionUpdate: 'tool_call', toolCallId: 'c2', title: 'Grep',
      rawInput: { pattern: 'trace' },
    }),
    grokRec({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Done.' },
    }),
  ];

  const tree = reconstructGrokContextTree(records);
  assert.equal(tree.segments.length, 1);
  const asst = tree.segments[0].turns.filter(t => t.role === 'assistant');
  assert.equal(asst.length, 1);
  assert.equal(asst[0].tool_calls.length, 2);
  assert.equal(asst[0].text, 'Done.');
  assert.equal(tree.segments[0].assistant_turns, 1);
});

test('reconstructGrokContextTree — tool failure on update', () => {
  const records = [
    grokRec({
      sessionUpdate: 'tool_call', toolCallId: 'bad', title: 'Shell',
      rawInput: { command: 'false' },
    }),
    grokRec({
      sessionUpdate: 'tool_call_update', toolCallId: 'bad', status: 'completed',
      rawOutput: { exit_code: 1, stderr: 'command failed' },
    }),
  ];

  const tree = reconstructGrokContextTree(records);
  const tc = tree.segments[0].turns[0].tool_calls[0];
  assert.equal(tc.is_error, true);
  assert.ok(tc.error_text.includes('failed'));
});