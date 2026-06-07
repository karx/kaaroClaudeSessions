import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToNormalized } from '../../adapters/grok.mjs';
import { reduceSession } from '../../lib/session-reducer.mjs';
import { enrichSession } from '../../lib/enrich-session.mjs';
import { parseGrokRecords } from '../../analyze-grok.mjs';

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

test('recordsToNormalized — emits expected kinds', () => {
  const norm = recordsToNormalized(GOLDEN_RECORDS);
  const kinds = norm.map(r => r.kind);
  assert.ok(kinds.includes('user_turn'));
  assert.ok(kinds.includes('tool_use'));
  assert.ok(kinds.includes('context_reset'));
  assert.equal(kinds.filter(k => k === 'tool_use').length, 2);
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