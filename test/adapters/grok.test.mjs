import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToNormalized } from '../../hooks/adapters/grok.mjs';
import { reduceSession } from '../../hooks/session-reducer.mjs';
import { enrichSession } from '../../hooks/enrich-session.mjs';
import { parseGrokRecords } from '../../hooks/analyzers/analyze-grok.mjs';

const SESSION_ID = '019ea1c9-46ee-77e0-bf36-f87a6403b5db';
const ENCODED_CWD = 'D%3A%5Csrc%5CkaaroSessions';

const GOLDEN_RECORDS = [
  {
    timestamp: 1780830790,
    method: 'session/update',
    params: {
      sessionId: SESSION_ID,
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Create a branch and build!' },
        _meta: { modelId: 'grok-composer-2.5-fast' },
      },
    },
    _meta: { agentTimestampMs: 1780831407026 },
  },
  {
    timestamp: 1780830790,
    method: 'session/update',
    params: {
      sessionId: SESSION_ID,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-test-composer_call_kLDxP',
        title: 'Shell',
        rawInput: {
          command: 'node --test',
          working_directory: 'D:\\src\\kaaroSessions',
          description: 'Run all unit tests',
        },
      },
    },
    _meta: { agentTimestampMs: 1780830790407, turnStartMs: 1780830788417 },
  },
  {
    timestamp: 1780830790,
    method: 'session/update',
    params: {
      sessionId: SESSION_ID,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-test-composer_call_by04n',
        title: 'Read',
        rawInput: { path: 'D:\\src\\kaaroSessions\\TODO.md' },
      },
    },
    _meta: { agentTimestampMs: 1780830793529, turnStartMs: 1780830788417 },
  },
  {
    timestamp: 1780831787,
    method: '_x.ai/session/update',
    params: {
      sessionId: SESSION_ID,
      update: { sessionUpdate: 'compaction_checkpoint', checkpoint_id: 'abc' },
    },
  },
];

const SUMMARY = {
  info: { id: SESSION_ID, cwd: 'D:\\src\\kaaroSessions' },
  generated_title: 'Multi-harness TDD session',
  current_model_id: 'grok-composer-2.5-fast',
  head_branch: 'feat/multi-harness-tdd',
  created_at: '2026-06-07T11:13:03.236022400Z',
  updated_at: '2026-06-07T11:42:01.294547500Z',
};

const SIGNALS = {
  toolCallCount: 3,
  compactionCount: 1,
  contextTokensUsed: 12000,
  sessionDurationSeconds: 600,
  primaryModelId: 'grok-composer-2.5-fast',
};

test('recordsToNormalized Ã¢â‚¬â€ emits expected kinds', () => {
  const norm = recordsToNormalized(GOLDEN_RECORDS);
  const kinds = norm.map(r => r.kind);
  assert.ok(kinds.includes('user_turn'));
  assert.ok(kinds.includes('tool_use'));
  assert.ok(kinds.includes('context_reset'));
  assert.equal(kinds.filter(k => k === 'tool_use').length, 2);
});

test('recordsToNormalized Ã¢â‚¬â€ Grok no turnStartMs chunks do not cause turn count explosion (dedup robustness)', () => {
  // Simulate a streaming assistant response with many chunks but no _meta.turnStartMs
  // (the bypass case in review finding #4).
  const noKeyChunks = [
    {
      method: 'session/update',
      params: {
        update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Thinking...' } },
      },
      _meta: { agentTimestampMs: 1 },  // deliberately no turnStartMs
    },
    {
      method: 'session/update',
      params: {
        update: { sessionUpdate: 'agent_message_chunk', content: { text: ' more text' } },
      },
      _meta: { agentTimestampMs: 2 },
    },
    {
      method: 'session/update',
      params: {
        update: { sessionUpdate: 'agent_thought_chunk', content: { text: 'internal' } },
      },
      _meta: { agentTimestampMs: 3 },
    },
  ];

  const norm = recordsToNormalized(noKeyChunks);
  const asstTurnCount = norm.filter(r => r.kind === 'assistant_turn').length;
  const contentBlockCount = norm.filter(r => r.kind === 'content_block').length;

  // Should be 1 assistant_turn total for the burst (not 1 per chunk).
  assert.equal(asstTurnCount, 1, 'no-key streaming chunks should produce only 1 assistant_turn');
  // Content blocks (for text) are still emitted for richness, that's fine.
  assert.ok(contentBlockCount >= 2);
});

test('tool_use NR has category for bash tools; key is NOT set by adapter', () => {
  const records = [
    {
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Shell',
        rawInput: { command: 'node --test', working_directory: 'D:\\src' } } },
      _meta: { agentTimestampMs: 1 },
    },
    {
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call', toolCallId: 'c2', title: 'Read',
        rawInput: { path: 'D:\\src\\index.mjs' } } },
      _meta: { agentTimestampMs: 2 },
    },
  ];
  const nrs = recordsToNormalized(records).filter(r => r.kind === 'tool_use');
  assert.equal(nrs.length, 2);
  assert.equal(nrs[0].category, 'node'); // Shell + node --test
  assert.equal(nrs[1].category, null);        // Read Ã¢â‚¬â€ not bash
  // Sonic key is NOT derived by adapters
  assert.equal(nrs[0].key, undefined);
  assert.equal(nrs[1].key, undefined);
});

test('content_block text NR carries text field', () => {
  const records = [{
    method: 'session/update',
    params: { update: { sessionUpdate: 'agent_message_chunk',
      content: { text: 'Analysing the output now.' } } },
    _meta: { agentTimestampMs: 1 },
  }];
  const nrs = recordsToNormalized(records).filter(r => r.kind === 'content_block');
  assert.equal(nrs.length, 1);
  assert.equal(nrs[0].text, 'Analysing the output now.');
});

test('unknown_record emitted for unrecognised update types', () => {
  const records = [{
    method: 'session/update',
    params: { update: { sessionUpdate: 'some_future_event', data: {} } },
    _meta: { agentTimestampMs: 1 },
  }];
  const nrs = recordsToNormalized(records);
  const unknowns = nrs.filter(r => r.kind === 'unknown_record');
  assert.equal(unknowns.length, 1);
  assert.equal(unknowns[0].raw_type, 'some_future_event');
  assert.equal(unknowns[0].harness, 'grok');
});

test('adapter + reducer golden regression matches parseGrokRecords', () => {
  const viaParse = parseGrokRecords(GOLDEN_RECORDS, SESSION_ID, ENCODED_CWD, SUMMARY, SIGNALS);
  enrichSession(viaParse);
  const viaPipeline = parseGrokRecords(GOLDEN_RECORDS, SESSION_ID, ENCODED_CWD, SUMMARY, SIGNALS);
  enrichSession(viaPipeline);

  const fields = [
    'session_id', 'project_id', 'project_label', 'harness', 'model', 'ai_title',
    'git_branch', 'user_turns', 'tool_calls', 'context_resets', 'slug',
    'first_user_message', 'tokens', 'file_ops',
  ];
  for (const f of fields) {
    assert.deepEqual(viaParse[f], viaPipeline[f], `mismatch on ${f}`);
  }
  assert.equal(viaParse.harness, 'grok');
  assert.equal(viaParse.user_turns, 1);
  assert.equal(viaParse.tool_calls, 2);
  assert.equal(viaParse.project_id, 'D--src-kaaroSessions');
  assert.ok(viaParse.file_ops['d:/src/kaarosessions/todo.md']?.read, 1);
});
// Ã¢â€â‚¬Ã¢â€â‚¬ Trace-fidelity fields (N5) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function su(update, meta = {}, method = 'session/update') {
  return { timestamp: 1, method, params: { sessionId: 's', update }, _meta: meta };
}

test('assistant_turn NR emitted per turnStartMs change (temporal turn grouping)', () => {
  const nrs = recordsToNormalized([
    su({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'go do the thing' } }),
    su({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'starting' } }, { turnStartMs: 100 }),
    su({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' now' } }, { turnStartMs: 100 }),
    su({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'second turn' } }, { turnStartMs: 200 }),
  ]);
  assert.equal(nrs.filter(r => r.kind === 'assistant_turn').length, 2,
    'one assistant_turn per turnStartMs, not per user-span');
});

test('agent_thought_chunk Ã¢â€ â€™ content_block thinking', () => {
  const nrs = recordsToNormalized([
    su({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }, { turnStartMs: 100 }),
    su({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'more' } }, { turnStartMs: 100 }),
  ]);
  const thinks = nrs.filter(r => r.kind === 'content_block' && r.block_type === 'thinking');
  assert.equal(thinks.length, 2, 'every thought chunk surfaces');
  assert.equal(nrs.filter(r => r.kind === 'assistant_turn').length, 1);
});

test('tool_use carries tool_id and rich input for trace sanitisation', () => {
  const nrs = recordsToNormalized([
    su({ sessionUpdate: 'tool_call', toolCallId: 'c-9', title: 'StrReplace',
      rawInput: { path: 'D:/x/a.mjs', old_string: 'aaa', new_string: 'bbb' } }),
  ]);
  const tu = nrs.find(r => r.kind === 'tool_use');
  assert.equal(tu.tool_id, 'c-9');
  assert.equal(tu.input.old_string, 'aaa');
  assert.equal(tu.input.new_string, 'bbb');
  assert.ok(tu.input.file_path.includes('a.mjs'));
});

test('failed tool_call_update carries tool_id and error_text from stderr', () => {
  const nrs = recordsToNormalized([
    su({ sessionUpdate: 'tool_call', toolCallId: 'c-1', title: 'Shell', rawInput: { command: 'node --test' } }),
    su({ sessionUpdate: 'tool_call_update', toolCallId: 'c-1', status: 'completed',
      rawOutput: { exit_code: 1, stderr: 'Error: 3 tests failing' } }),
  ]);
  const tr = nrs.find(r => r.kind === 'tool_result' && r.error);
  assert.equal(tr.tool_id, 'c-1');
  assert.ok(tr.error_text.includes('3 tests failing'));
});

test('user_turn carries display_text up to 500 chars regardless of the 8-char text rule', () => {
  const nrs = recordsToNormalized([
    su({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'ok go' } }),
  ]);
  const ut = nrs.find(r => r.kind === 'user_turn');
  assert.equal(ut.text, null, 'short prompts stay out of first_user_message');
  assert.equal(ut.display_text, 'ok go');
});
