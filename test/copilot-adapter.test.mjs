/**
 * test/copilot-adapter.test.mjs â†’ adapters/copilot.mjs + lib/copilot-helpers.mjs
 *
 * Fixtures mirror real VS Code Copilot chatSessions op-log shapes probed
 * 2026-06-11 (chat session format v3, JSONL op-log: kind 0=snapshot,
 * 1=set-keypath, 2=array-append). See memory: harness-storage-formats.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recordsToNormalized } from '../hooks/adapters/copilot.mjs';
import { copilotUriToPath, copilotToolName } from '../hooks/helpers/copilot-helpers.mjs';
import { reduceSession } from '../hooks/session-reducer.mjs';
import { toolNameToKey } from '../hooks/action-keys.mjs';

const T_CREATE = 1779124637563;
const T_REQ    = 1780942410161;

function makeRequest(over = {}) {
  return {
    requestId: 'request_f00b9286',
    timestamp: T_REQ,
    modelId: 'copilot/oswe-vscode-prime',
    message: { text: 'What is the ontology used by the adapters?', parts: [] },
    variableData: { variables: [] },
    response: [],
    ...over,
  };
}

function makeToolInvocation(over = {}) {
  return {
    kind: 'toolInvocationSerialized',
    invocationMessage: {
      value: 'Reading [](file:///d%3A/src/kaaroSessions/README.md)',
      supportThemeIcons: false, supportHtml: false,
      uris: { 'file:///d%3A/src/kaaroSessions/README.md': { $mid: 1, path: '/d:/src/kaaroSessions/README.md', scheme: 'file' } },
    },
    isConfirmed: { type: 1 }, isComplete: true,
    toolCallId: 'call_fgmplVAsqnIe3gZ8cMYlJ0KT',
    toolId: 'copilot_readFile',
    ...over,
  };
}

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('copilotUriToPath â€” encoded file URI string', () => {
  assert.equal(copilotUriToPath('file:///d%3A/src/kaaroSessions/README.md'), 'd:/src/kaaroSessions/README.md');
});

test('copilotUriToPath â€” VS Code uri component object', () => {
  assert.equal(copilotUriToPath({ $mid: 1, path: '/d:/src/x/a.mjs', scheme: 'file' }), 'd:/src/x/a.mjs');
  assert.equal(copilotUriToPath({ path: '/home/u/a.mjs', scheme: 'file' }), '/home/u/a.mjs'); // posix keeps root slash
  assert.equal(copilotUriToPath(null), null);
});

test('copilotToolName â€” strips copilot_ prefix', () => {
  assert.equal(copilotToolName('copilot_readFile'), 'readFile');
  assert.equal(copilotToolName('copilot_findTextInFiles'), 'findTextInFiles');
  assert.equal(copilotToolName(undefined), 'unknown');
});

// â”€â”€ snapshot ops â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('kind:0 snapshot â†’ session_meta with creationDate', () => {
  const nrs = recordsToNormalized([{ kind: 0, v: { version: 3, sessionId: 'abc', creationDate: T_CREATE, requests: [], inputState: {} } }]);
  assert.equal(nrs.length, 1);
  assert.equal(nrs[0].kind, 'session_meta');
  assert.equal(nrs[0].harness, 'copilot');
  assert.equal(nrs[0].ts, new Date(T_CREATE).toISOString());
});

test('kind:0 snapshot with history â†’ requests walked (resumed session)', () => {
  const req = makeRequest({
    response: [makeToolInvocation()],
    completionTokens: 1092,
  });
  const nrs = recordsToNormalized([{ kind: 0, v: { version: 3, creationDate: T_CREATE, customTitle: 'Ontology Q&A', requests: [req] } }]);

  assert.equal(nrs.find(r => r.kind === 'session_meta')?.ai_title, 'Ontology Q&A');
  assert.equal(nrs.find(r => r.kind === 'user_turn')?.text, 'What is the ontology used by the adapters?');
  assert.ok(nrs.find(r => r.kind === 'assistant_turn'));
  assert.equal(nrs.find(r => r.kind === 'tool_use')?.tool, 'readFile');
  assert.equal(nrs.find(r => r.kind === 'tokens')?.tokens.output, 1092);
});

test('old single-JSON dump (no kind) â†’ treated as snapshot', () => {
  const nrs = recordsToNormalized([{
    version: 3, sessionId: 'old', creationDate: T_CREATE,
    customTitle: 'Old format chat', requests: [makeRequest()],
  }]);
  assert.equal(nrs.find(r => r.kind === 'session_meta')?.ai_title, 'Old format chat');
  assert.ok(nrs.find(r => r.kind === 'user_turn'));
});

// â”€â”€ request append â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('kind:2 requests append â†’ user_turn + model meta', () => {
  const nrs = recordsToNormalized([{ kind: 2, k: ['requests'], v: [makeRequest()] }]);
  const turn = nrs.find(r => r.kind === 'user_turn');
  assert.equal(turn.text, 'What is the ontology used by the adapters?');
  assert.equal(turn.ts, new Date(T_REQ).toISOString());
  const meta = nrs.find(r => r.kind === 'session_meta');
  assert.equal(meta.model, 'copilot/oswe-vscode-prime');
});

// â”€â”€ response appends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('response append: toolInvocationSerialized â†’ tool_use with decoded path', () => {
  const nrs = recordsToNormalized([
    { kind: 2, k: ['requests', 0, 'response'], v: [makeToolInvocation()] },
  ]);
  const tool = nrs.find(r => r.kind === 'tool_use');
  assert.equal(tool.tool, 'readFile');
  assert.equal(tool.input.file_path, 'd:/src/kaaroSessions/README.md');
});

test('assistant_turn emitted once per request index across appends', () => {
  const nrs = recordsToNormalized([
    { kind: 2, k: ['requests', 0, 'response'], v: [makeToolInvocation()] },
    { kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'Here is the answer to your question.', supportThemeIcons: false, supportHtml: false }] },
    { kind: 2, k: ['requests', 1, 'response'], v: [makeToolInvocation()] },
  ]);
  assert.equal(nrs.filter(r => r.kind === 'assistant_turn').length, 2); // one per request idx
});

test('response items: thinking + markdown + inlineReference', () => {
  const nrs = recordsToNormalized([{
    kind: 2, k: ['requests', 0, 'response'], v: [
      { kind: 'thinking', value: 'Let me scan the adapters first.' },
      { value: 'The schema is **NormalizedRecord** â€” see lib.', supportThemeIcons: false, supportHtml: false },
      { kind: 'inlineReference', inlineReference: { path: '/d:/x', scheme: 'file' } },
    ],
  }]);
  assert.ok(nrs.find(r => r.kind === 'content_block' && r.block_type === 'thinking'));
  const text = nrs.find(r => r.kind === 'content_block' && r.block_type === 'text');
  assert.equal(text.text, 'The schema is **NormalizedRecord** â€” see lib.');
  // inlineReference is known chrome â€” silenced
  assert.equal(nrs.filter(r => r.kind === 'unknown_record').length, 0);
});

test('response item textEditGroup â†’ edit tool_use (agent-mode file edits)', () => {
  const nrs = recordsToNormalized([{
    kind: 2, k: ['requests', 0, 'response'], v: [
      { kind: 'textEditGroup', uri: { $mid: 1, path: '/d:/src/x/app.mjs', scheme: 'file' }, edits: [[]], done: true },
    ],
  }]);
  const tool = nrs.find(r => r.kind === 'tool_use');
  assert.equal(tool.tool, 'editFile');
  assert.equal(tool.input.file_path, 'd:/src/x/app.mjs');
});

test('unknown response item kind â†’ unknown_record catch-all', () => {
  const nrs = recordsToNormalized([{
    kind: 2, k: ['requests', 0, 'response'], v: [{ kind: 'hologram9000' }],
  }]);
  assert.ok(nrs.find(r => r.kind === 'unknown_record' && r.raw_type === 'response:hologram9000'));
});

// â”€â”€ set ops â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('kind:1 completionTokens â†’ tokens (output only)', () => {
  const nrs = recordsToNormalized([{ kind: 1, k: ['requests', 0, 'completionTokens'], v: 2098 }]);
  assert.equal(nrs.length, 1);
  assert.deepEqual(nrs[0].tokens, { input: 0, output: 2098, cache_create: 0, cache_read: 0 });
});

test('kind:1 customTitle â†’ session_meta ai_title', () => {
  const nrs = recordsToNormalized([{ kind: 1, k: ['customTitle'], v: 'Ontology/schema for adapters' }]);
  assert.equal(nrs[0].kind, 'session_meta');
  assert.equal(nrs[0].ai_title, 'Ontology/schema for adapters');
});

test('kind:1 UI-state sets are silenced (not transcript signal)', () => {
  const nrs = recordsToNormalized([
    { kind: 1, k: ['inputState', 'inputText'], v: 'typingâ€¦' },
    { kind: 1, k: ['requests', 0, 'result'], v: { timings: { totalElapsed: 63340 } } },
    { kind: 1, k: ['requests', 0, 'modelState'], v: {} },
    { kind: 1, k: ['responderUsername'], v: 'GitHub Copilot' },
  ]);
  assert.equal(nrs.length, 0);
});

// â”€â”€ tool key aliases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('toolNameToKey â€” copilot tool names map to canonical keys', () => {
  assert.equal(toolNameToKey('readFile'), 'read');
  assert.equal(toolNameToKey('createFile'), 'write');
  assert.equal(toolNameToKey('editFile'), 'edit');
  assert.equal(toolNameToKey('replaceString'), 'edit');
  assert.equal(toolNameToKey('findTextInFiles'), 'grep_glob');
  assert.equal(toolNameToKey('fileSearch'), 'grep_glob');
  assert.equal(toolNameToKey('listDirectory'), 'grep_glob');
  assert.equal(toolNameToKey('runInTerminal'), 'bash_other');
  assert.equal(toolNameToKey('fetchWebpage'), 'web');
});

// â”€â”€ reducer integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('full op-log reduces to canonical session', () => {
  const ops = [
    { kind: 0, v: { version: 3, sessionId: 's', creationDate: T_CREATE, requests: [] } },
    { kind: 2, k: ['requests'], v: [makeRequest()] },
    { kind: 2, k: ['requests', 0, 'response'], v: [makeToolInvocation()] },
    { kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'Here is a long enough answer text.', supportThemeIcons: false }] },
    { kind: 1, k: ['requests', 0, 'completionTokens'], v: 1092 },
    { kind: 1, k: ['customTitle'], v: 'Ontology/schema for adapters' },
  ];
  const session = reduceSession(recordsToNormalized(ops), {
    session_id: '052d579c-9e9f-4c40-989b-b6923159f2dd',
    project_id: 'D--src-kaaroSessions',
    project_label: 'kaaroSessions',
    harness: 'copilot',
    capabilities: { size_proxy: 'tokens_work' },
  });

  assert.equal(session.user_turns, 1);
  assert.equal(session.assistant_turns, 1);
  assert.equal(session.tool_calls, 1);
  assert.equal(session.tokens.output, 1092);
  assert.equal(session.ai_title, 'Ontology/schema for adapters');
  assert.equal(session.model, 'copilot/oswe-vscode-prime');
  assert.deepEqual(session.file_ops['d:/src/kaarosessions/readme.md'], { read: 1, write: 0, edit: 0 }); // normPath lowercases fully
  assert.equal(session.first_user_message, 'What is the ontology used by the adapters?');
});
