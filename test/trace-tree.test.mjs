/**
 * test/trace-tree.test.mjs → hooks/trace-tree.mjs
 *
 * The unified ContextTree reconstruction from NormalizedRecords. Parity:
 * every fixture runs raw records → adapter → NRs → reconstructTraceFromNRs
 * and deep-equals the OLD per-harness reconstruction on the same fixture
 * (hooks/context-tree.mjs + hooks/grok-context-tree.mjs are the oracles
 * until archived). Known deliberate deltas are asserted explicitly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconstructTraceFromNRs } from '../hooks/trace-tree.mjs';
// The superseded per-harness reconstructions live in ARCHIVE as FROZEN parity
// oracles for this suite only — never import them from production code.
import { reconstructContextTree } from '../ARCHIVE/hooks/context-tree.mjs';
import { reconstructGrokContextTree } from '../ARCHIVE/hooks/grok-context-tree.mjs';
import { recordsToNormalized as ccToNorm }   from '../hooks/adapters/claude-code.mjs';
import { recordsToNormalized as grokToNorm } from '../hooks/adapters/grok.mjs';
import { recordsToNormalized as piToNorm }   from '../hooks/adapters/pi.mjs';
import { recordsToNormalized as ocToNorm }   from '../hooks/adapters/opencode.mjs';
import { recordsToNormalized as cpToNorm }   from '../hooks/adapters/copilot.mjs';

// ── CC fixture helpers (ported from context-tree.test.mjs) ────────────────────

function user(opts = {}) {
  return { type: 'user', timestamp: opts.ts || '2026-05-01T10:00:00Z',
    gitBranch: opts.branch || undefined, message: { content: opts.text || 'hello world prompt' } };
}
function asst(opts = {}) {
  return { type: 'assistant', timestamp: opts.ts || '2026-05-01T10:01:00Z',
    message: {
      model: opts.model || 'claude-sonnet-4-6',
      stop_reason: opts.stop_reason || 'end_turn',
      usage: { input_tokens: opts.input || 0, output_tokens: opts.output ?? 100,
                cache_creation_input_tokens: 0, cache_read_input_tokens: opts.cache_read || 0 },
      content: opts.content || [],
    } };
}
function toolUseBlock(name, input, id = 'tu_001') {
  return { type: 'tool_use', id, name, input };
}
function toolResultBlock(id, isError = false, errText = null) {
  const block = { type: 'tool_result', tool_use_id: id, is_error: isError };
  if (errText) block.content = [{ type: 'text', text: errText }];
  return block;
}
function compact(opts = {}) {
  return { type: 'system', subtype: 'compact_boundary', timestamp: opts.ts || '2026-05-01T11:00:00Z' };
}
function permMode(mode, ts) {
  return { type: 'permission-mode', permissionMode: mode, timestamp: ts };
}
function turnDur(ms) {
  return { type: 'system', subtype: 'turn_duration', durationMs: ms };
}

function ccTree(records) {
  return reconstructTraceFromNRs(ccToNorm(records));
}
function assertCcParity(records, label) {
  assert.deepEqual(ccTree(records), reconstructContextTree(records), label);
}

// ── CC parity (deep-equal vs old reconstruction) ──────────────────────────────

test('cc parity — basic single segment', () => {
  assertCcParity([user(), asst()]);
});

test('cc parity — turn counting across compact boundaries', () => {
  assertCcParity([user(), asst(), user(), asst(), compact(), user(), asst()]);
});

test('cc parity — multiple compact boundaries, indices and triggers', () => {
  assertCcParity([
    user(), asst(), compact({ ts: '2026-05-01T11:00:00Z' }),
    user(), asst(), compact({ ts: '2026-05-01T12:00:00Z' }),
    user(), asst(),
  ]);
});

test('cc parity — tool_summary, subagents, sanitised inputs', () => {
  assertCcParity([
    asst({ content: [
      toolUseBlock('Read', { file_path: 'src/foo.js' }, 'tu1'),
      toolUseBlock('Read', { file_path: 'b.js' }, 'tu2'),
      toolUseBlock('Bash', { command: 'git status' }, 'tu3'),
      toolUseBlock('Agent', { description: 'explore the codebase' }, 'tu4'),
    ] }),
    compact(),
    asst({ content: [toolUseBlock('Edit', {
      file_path: 'a.js', old_string: 'A'.repeat(200), new_string: 'B'.repeat(200),
    }, 'tu5')] }),
    asst(),
  ]);
});

test('cc parity — write content stripped, glob/grep/web sanitisers', () => {
  assertCcParity([
    asst({ content: [
      toolUseBlock('Write', { file_path: 'out.js', content: 'x'.repeat(5000) }, 't1'),
      toolUseBlock('Glob', { pattern: '**/*.mjs' }, 't2'),
      toolUseBlock('Grep', { pattern: 'trace', path: 'hooks' }, 't3'),
      toolUseBlock('WebFetch', { url: 'https://example.com' }, 't4'),
      toolUseBlock('MysteryTool', { foo: 'bar', long: 'z'.repeat(400), nested: { a: 1 } }, 't5'),
    ] }),
    asst(),
  ]);
});

test('cc parity — tool result errors attach to the open assistant turn', () => {
  assertCcParity([
    asst({ content: [toolUseBlock('Bash', { command: 'bad-cmd' }, 'tu1')] }),
    { type: 'user', timestamp: '2026-05-01T10:02:00Z',
      message: { content: [toolResultBlock('tu1', true, 'command not found: bad-cmd')] } },
    asst(),
  ]);
});

test('cc parity — tool-result-only user records emit no user turn', () => {
  assertCcParity([
    asst({ content: [toolUseBlock('Bash', { command: 'ls' }, 'tu1')] }),
    { type: 'user', timestamp: '2026-05-01T10:02:00Z',
      message: { content: [toolResultBlock('tu1')] } },
  ]);
});

test('cc parity — permission modes, branches, ai-title, thinking, duration', () => {
  assertCcParity([
    { type: 'ai-title', aiTitle: 'My session title' },
    permMode('default', '2026-05-01T09:59:00Z'),
    user({ branch: 'main' }),
    permMode('plan', '2026-05-01T10:00:30Z'),
    asst({ content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: 'done thinking now' }] }),
    turnDur(5230),
    user({ branch: 'feat/x' }),
    compact(),
    permMode('acceptEdits', '2026-05-01T11:01:00Z'),
    user({ branch: 'master' }),
    asst({ output: 80, cache_read: 20 }),
  ]);
});

test('cc parity — branches repeat across segments (per-record, not change-only)', () => {
  assertCcParity([
    user({ branch: 'main' }), asst(),
    compact(),
    user({ branch: 'main' }), asst(),
  ]);
});

test('cc parity — token accumulation per segment', () => {
  assertCcParity([
    asst({ output: 100, cache_read: 50 }),
    asst({ output: 200, cache_read: 30 }),
    compact(),
    asst({ output: 80, cache_read: 20 }),
  ]);
});

test('cc parity — empty records and trailing compact', () => {
  assert.deepEqual(reconstructTraceFromNRs([]), { ai_title: null, segments: [] });
  assertCcParity([user(), asst(), compact()]);
});

// ── grok parity ───────────────────────────────────────────────────────────────

const TURN = 1780830788417;
function grokRec(update, meta = {}) {
  return {
    method: 'session/update',
    params: { sessionId: 's', update },
    _meta: { agentTimestampMs: meta.ts || 1780831407026, turnStartMs: meta.turn ?? TURN },
  };
}
function grokTree(records, opts) {
  return reconstructTraceFromNRs(grokToNorm(records), opts);
}

test('grok parity — segments on compaction', () => {
  const records = [
    grokRec({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hello world!' } }, { ts: 1000 }),
    grokRec({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Read',
      rawInput: { path: 'D:\\src\\foo.txt' } }, { ts: 2000 }),
    grokRec({ sessionUpdate: 'compaction_checkpoint', checkpoint_id: 'x' }, { ts: 3000, turn: null }),
    grokRec({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'After compact' } }, { ts: 4000 }),
  ];
  const opts = { ai_title: 'Test session' };
  const tree = grokTree(records, opts);
  const old  = reconstructGrokContextTree(records, opts);
  assert.equal(tree.ai_title, 'Test session');
  assert.equal(tree.segments.length, old.segments.length);
  assert.equal(tree.segments[0].compact_trigger, 'auto');
  assert.equal(tree.segments[1].compact_trigger, null);
  assert.equal(tree.segments[0].user_turns, old.segments[0].user_turns);
  assert.equal(tree.segments[0].tool_calls, 1);
  assert.equal(tree.segments[0].tool_summary.Read, 1);
  assert.deepEqual(
    tree.segments[0].turns.find(t => t.role === 'assistant').tool_calls[0].input,
    { file_path: 'D:/src/foo.txt' },
  );
});

test('grok parity — tools + chunked text group into one assistant turn', () => {
  const records = [
    grokRec({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Go' } }),
    grokRec({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Shell', rawInput: { command: 'node --test' } }),
    grokRec({ sessionUpdate: 'tool_call', toolCallId: 'c2', title: 'Grep', rawInput: { pattern: 'trace' } }),
    grokRec({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done' } }),
    grokRec({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '.' } }),
  ];
  const tree = grokTree(records);
  assert.equal(tree.segments.length, 1);
  const asstTurns = tree.segments[0].turns.filter(t => t.role === 'assistant');
  assert.equal(asstTurns.length, 1);
  assert.equal(asstTurns[0].tool_calls.length, 2);
  assert.equal(asstTurns[0].text, 'Done.', 'chunks join without separators');
  assert.equal(tree.segments[0].assistant_turns, 1);
});

test('grok parity — separate turnStartMs produce separate assistant turns', () => {
  const records = [
    grokRec({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first turn' } }, { turn: 100 }),
    grokRec({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'second turn' } }, { turn: 200 }),
  ];
  const tree = grokTree(records);
  const old  = reconstructGrokContextTree(records);
  assert.equal(old.segments[0].turns.length, 2, 'oracle splits by turnStartMs');
  assert.equal(tree.segments[0].turns.length, 2);
  assert.equal(tree.segments[0].turns[0].text, 'first turn');
  assert.equal(tree.segments[0].turns[1].text, 'second turn');
});

test('grok parity — tool failure attaches is_error + error_text', () => {
  const records = [
    grokRec({ sessionUpdate: 'tool_call', toolCallId: 'bad', title: 'Shell', rawInput: { command: 'false' } }),
    grokRec({ sessionUpdate: 'tool_call_update', toolCallId: 'bad', status: 'completed',
      rawOutput: { exit_code: 1, stderr: 'command failed' } }),
  ];
  const tree = grokTree(records);
  const tc = tree.segments[0].turns[0].tool_calls[0];
  assert.equal(tc.is_error, true);
  assert.ok(tc.error_text.includes('failed'));
});

test('grok — thinking chunks set has_thinking and thinking_count', () => {
  const records = [
    grokRec({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }),
    grokRec({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'more' } }),
    grokRec({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer text' } }),
  ];
  const tree = grokTree(records);
  assert.equal(tree.segments[0].thinking_count, 2);
  assert.equal(tree.segments[0].turns[0].has_thinking, true);
});

test('grok — git_branch opt lands in segment branches', () => {
  const records = [
    grokRec({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hello world!' } }),
  ];
  const tree = grokTree(records, { git_branch: 'feat/cap' });
  assert.deepEqual(tree.segments[0].branches, ['feat/cap']);
});

// ── every other harness produces a sane tree (single segment) ─────────────────

test('pi/opencode/copilot NR streams reconstruct sane trees', () => {
  const piTree = reconstructTraceFromNRs(piToNorm([
    { type: 'message', id: 'u1', timestamp: 't1',
      message: { role: 'user', content: [{ type: 'text', text: 'hello pi agent' }] } },
    { type: 'message', id: 'a1', timestamp: 't2',
      message: { role: 'assistant',
        content: [{ type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: 'a.mjs' } }],
        model: 'm', usage: { input: 10, output: 5 }, stopReason: 'end' } },
  ]));
  assert.equal(piTree.segments.length, 1);
  assert.equal(piTree.segments[0].user_turns, 1);
  assert.equal(piTree.segments[0].tool_calls, 1);

  const ocTree = reconstructTraceFromNRs(ocToNorm([
    { id: 'ses_1', version: '1', projectID: 'p', directory: 'D:/x', title: 'T',
      time: { created: 1, updated: 2 } },
    { id: 'msg_u', sessionID: 'ses_1', role: 'user', time: { created: 3 },
      _parts: [{ id: 'p1', type: 'text', text: 'make it work' }] },
    { id: 'msg_a', sessionID: 'ses_1', role: 'assistant', time: { created: 4 },
      modelID: 'm', tokens: { input: 1, output: 2, cache: {} }, finish: 'stop',
      _parts: [{ id: 'p2', type: 'tool', callID: 'c1', tool: 'glob',
        state: { status: 'completed', input: { pattern: '*.md' } } }] },
  ]));
  assert.equal(ocTree.ai_title, 'T');
  assert.equal(ocTree.segments[0].user_turns, 1);
  assert.equal(ocTree.segments[0].tool_calls, 1);
  assert.ok(ocTree.segments[0].turns.some(t => t.role === 'user' && t.text === 'make it work'));

  const cpTree = reconstructTraceFromNRs(cpToNorm([
    { kind: 0, v: { version: 3, sessionId: 'x', creationDate: 1, customTitle: 'CP',
      requests: [{ requestId: 'r1', timestamp: 2, modelId: 'm',
        message: { text: 'what is this repo' }, response: [
          { kind: 'toolInvocationSerialized', invocationMessage: { value: 'Reading' },
            isComplete: true, toolCallId: 'c1', toolId: 'copilot_readFile' },
          { kind: 'markdownContent', content: { value: 'It is the kaaro repo.' } },
        ], completionTokens: 9 }] } },
  ]));
  assert.equal(cpTree.ai_title, 'CP');
  assert.equal(cpTree.segments[0].user_turns, 1);
  assert.equal(cpTree.segments[0].tool_calls, 1);
  assert.ok(cpTree.segments[0].turns.some(t => t.role === 'assistant'));
});
