/**
 * test/adapters/nr-compliance.test.mjs
 *
 * The permanent adapter-contract guard: every NormalizedRecord emitted by
 * every adapter must satisfy validateNormalizedRecord (hooks/normalized-record.mjs).
 *
 * Two sweeps:
 *  1. Event Registry sample traces (hooks/event-types.mjs samples) — the
 *     canonical per-event fixtures.
 *  2. A golden multi-record session per harness — covers envelope kinds
 *     (session_meta, branch_change, unknown_record) the samples may miss.
 *
 * When a harness's storage format changes, fix its adapter until this file
 * is green again — no other layer should need edits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateNormalizedRecord } from '../../hooks/normalized-record.mjs';
import { EVENT_TYPES } from '../../hooks/event-types.mjs';
import { recordsToNormalized as ccToNorm }   from '../../hooks/adapters/claude-code.mjs';
import { recordsToNormalized as piToNorm }   from '../../hooks/adapters/pi.mjs';
import { recordsToNormalized as agToNorm }   from '../../hooks/adapters/antigravity.mjs';
import { recordsToNormalized as grokToNorm } from '../../hooks/adapters/grok.mjs';
import { recordsToNormalized as ocToNorm }   from '../../hooks/adapters/opencode.mjs';
import { recordsToNormalized as cpToNorm }   from '../../hooks/adapters/copilot.mjs';

const ADAPTERS = {
  'claude-code': ccToNorm,
  'pi':          piToNorm,
  'antigravity': agToNorm,
  'grok':        grokToNorm,
  'opencode':    ocToNorm,
  'copilot':     cpToNorm,
};

function assertAllValid(nrs, label) {
  assert.ok(nrs.length > 0, `${label}: adapter emitted no records`);
  for (const nr of nrs) {
    const { ok, errors } = validateNormalizedRecord(nr);
    assert.ok(ok, `${label}: invalid NR ${JSON.stringify(nr)} — ${errors.join('; ')}`);
  }
}

// ── Sweep 1: Event Registry sample traces ─────────────────────────────────────

for (const [eventKey, entry] of Object.entries(EVENT_TYPES)) {
  if (!entry.samples) continue;
  for (const [harness, sample] of Object.entries(entry.samples)) {
    const adapterFn = ADAPTERS[harness];
    if (!adapterFn) continue;
    test(`nr-compliance — sample ${eventKey}/${harness}`, () => {
      assertAllValid(adapterFn([sample.record]), `${eventKey}/${harness}`);
    });
  }
}

// ── Sweep 2: golden sessions per harness ──────────────────────────────────────

const GOLDEN = {
  'claude-code': [
    { type: 'permission-mode', timestamp: 't1', permissionMode: 'acceptEdits' },
    { type: 'system', subtype: 'compact_boundary', timestamp: 't2' },
    { type: 'mode', timestamp: 't3', mode: 'plan' },
    { type: 'attachment', timestamp: 't4', attachment: { type: 'file' } },
    { type: 'ai-title', timestamp: 't5', aiTitle: 'Golden session' },
    { type: 'last-prompt', timestamp: 't5b', lastPrompt: 'do the thing' },
    { type: 'file-history-snapshot', timestamp: 't5c' },
    {
      type: 'system', subtype: 'turn_duration', timestamp: 't6',
      slug: 'golden-slug', durationMs: 1200, messageCount: 4,
      version: '2.0.0', entrypoint: 'cli', cwd: 'D:\\src\\x', gitBranch: 'main',
    },
    {
      type: 'user', timestamp: 't7', gitBranch: 'feat/y',
      message: { content: 'Please run /code-review on the auth module changes' },
    },
    {
      type: 'user', timestamp: 't7b',
      message: { content: [{ type: 'tool_result', is_error: true, tool_name: 'Bash' }] },
    },
    {
      type: 'assistant', timestamp: 't8',
      message: {
        model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 100 },
        content: [
          { type: 'text', text: 'Done.' },
          { type: 'thinking', thinking: 'hmm' },
          { type: 'tool_use', name: 'Bash', input: { command: 'git status' } },
          { type: 'tool_use', name: 'Read', input: { file_path: 'D:\\src\\x\\a.mjs' } },
        ],
      },
    },
    { type: 'totally-new-record-type', timestamp: 't9' },
  ],

  'pi': [
    { type: 'session', version: 3, id: 's1', timestamp: 't1', cwd: 'D:\\src\\ebrain' },
    { type: 'model_change', id: 'mc1', timestamp: 't2', provider: 'openai', modelId: 'gpt-5.4' },
    {
      type: 'message', id: 'u1', timestamp: 't3',
      message: { role: 'user', content: [{ type: 'text', text: 'hello pi' }] },
    },
    {
      type: 'message', id: 'a1', timestamp: 't4',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: 'a.mjs' } },
          { type: 'toolCall', id: 'tc2', name: 'bash', arguments: { command: 'git status' } },
        ],
        provider: 'openai', model: 'gpt-5.4',
        usage: { input: 100, output: 40, cacheRead: 10, cacheWrite: 5 },
        stopReason: 'toolUse',
      },
    },
    { type: 'mystery', id: 'x1', timestamp: 't5' },
  ],

  'antigravity': [
    {
      step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE',
      created_at: '2026-06-07T00:15:33Z',
      content: '<USER_REQUEST>\nSet up the pool\n</USER_REQUEST>',
    },
    {
      step_index: 1, source: 'SYSTEM', type: 'EPHEMERAL_MESSAGE', status: 'DONE',
      created_at: '2026-06-07T00:15:34Z', content: 'Reminder: follow the workflow.',
    },
    {
      step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE',
      created_at: '2026-06-07T00:15:35Z', content: 'I will look at the files.',
      tool_calls: [
        { name: 'view_file', args: { AbsolutePath: '"D:/src/ebrain/README.md"' } },
        { name: 'run_command', args: { CommandLine: '"git status"', Cwd: '"D:\\\\src\\\\ebrain"' } },
      ],
    },
    { step_index: 4, source: 'MODEL', type: 'VIEW_FILE', status: 'ERROR', created_at: '2026-06-07T00:15:41Z', content: 'Permission denied.' },
    { step_index: 5, source: 'MODEL', type: 'BRAND_NEW_STEP', status: 'DONE', created_at: '2026-06-07T00:15:42Z' },
  ],

  'grok': [
    {
      timestamp: 1780830790, method: 'session/update',
      params: { sessionId: 's1', update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Create a branch and build!' },
        _meta: { modelId: 'grok-composer-2.5-fast' },
      } },
    },
    {
      timestamp: 1780830791, method: 'session/update',
      params: { sessionId: 's1', update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'On it — creating the branch now.' },
      } },
    },
    {
      timestamp: 1780830792, method: 'session/update',
      params: { sessionId: 's1', update: {
        sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Shell',
        rawInput: { command: 'node --test', description: 'Run tests' },
      } },
    },
    {
      timestamp: 1780830793, method: 'session/update',
      params: { sessionId: 's1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' } },
    },
    {
      timestamp: 1780831787, method: '_x.ai/session/update',
      params: { sessionId: 's1', update: { sessionUpdate: 'compaction_checkpoint', checkpoint_id: 'abc' } },
    },
    { timestamp: 1780831788, method: 'session/new_thing', params: {} },
  ],

  'opencode': [
    {
      id: 'ses_1', version: '1.0.201', projectID: 'p1',
      directory: 'D:\\src\\x', title: 'Golden opencode',
      time: { created: 1766698155332, updated: 1766698155332 },
    },
    {
      id: 'msg_u1', sessionID: 'ses_1', role: 'user',
      time: { created: 1766698062733 },
      _parts: [{ id: 'prt_1', type: 'text', text: 'create a README' }],
    },
    {
      id: 'msg_a1', sessionID: 'ses_1', role: 'assistant',
      time: { created: 1766698107679, completed: 1766698137064 },
      modelID: 'glm-4.7-free', providerID: 'opencode', mode: 'build',
      tokens: { input: 25801, output: 166, reasoning: 0, cache: { read: 70, write: 12 } },
      finish: 'stop',
      _parts: [
        {
          id: 'prt_t1', type: 'tool', callID: 'call_1', tool: 'glob',
          state: { status: 'completed', input: { pattern: '**/*.md' }, time: { start: 1, end: 2 } },
        },
        { id: 'prt_x1', type: 'step-start' },
      ],
    },
  ],

  'copilot': [
    {
      kind: 0,
      v: {
        version: 3, sessionId: 'abc', creationDate: 1779124637563,
        customTitle: 'Golden copilot', inputState: {},
        requests: [{
          requestId: 'r1', timestamp: 1780942410161, modelId: 'copilot/oswe-vscode-prime',
          message: { text: 'What is the ontology?', parts: [] },
          response: [
            {
              kind: 'toolInvocationSerialized',
              invocationMessage: { value: 'Reading [](file:///d%3A/src/x/README.md)' },
              isComplete: true, toolCallId: 'c1', toolId: 'copilot_readFile',
            },
            { kind: 'markdownContent', content: { value: 'The ontology is…' } },
          ],
          completionTokens: 1092,
        }],
      },
    },
    { kind: 2, k: ['requests'], v: [{
      requestId: 'r2', timestamp: 1780942410200, modelId: 'copilot/oswe-vscode-prime',
      message: { text: 'thanks', parts: [] }, response: [],
    }] },
    { kind: 2, k: ['requests', 0, 'response'], v: [
      { kind: 'markdownContent', content: { value: 'Sure thing.' } },
    ] },
    { kind: 1, k: ['requests', 0, 'completionTokens'], v: 42 },
    { kind: 7, k: 'something', v: {} },
  ],
};

for (const [harness, records] of Object.entries(GOLDEN)) {
  test(`nr-compliance — golden session (${harness})`, () => {
    assertAllValid(ADAPTERS[harness](records), `golden/${harness}`);
  });
}
