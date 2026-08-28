/**
 * test/adapters/grok-bot-live.test.mjs -- live-pulse fixes for grok-bot
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  recordsToNormalized, grokBotSlug, categorizeGrokBotShell,
} from '../../hooks/adapters/grok-bot.mjs';
import { reduceSession } from '../../hooks/session-reducer.mjs';
import { toolNameToKey } from '../../hooks/action-keys.mjs';
import { normRecordsToPulses, stampPulse } from '../../hooks/pulse-transformer.mjs';
import { validateNormalizedRecord } from '../../hooks/normalized-record.mjs';

const GOLDEN = [
  {"role":"user","message":{"content":[{"type":"text","text":"Check D:/src/kaaroSessions and add grok-bot harness support"}]}},
  {"role":"assistant","message":{"content":[{"type":"text","text":"Looking at the harness layout first."}]}},
  {"role":"assistant","message":{"content":[{"type":"tool_use","name":"send_message","input":{"text":{"content":"On it. Looking at kaaroSessions first."}}}]}},
  {"role":"tool","message":{"content":[{"type":"tool_result","name":"send_message","result":{"success":{"timestamp":"1787860893175","messageId":"t0s0"}}}]}},
  {"role":"assistant","message":{"content":[{"type":"tool_use","name":"shell","input":{"command":"git status -sb","workingDirectory":"D:/src/kaaroSessions","description":"Check git status"}}]}},
  {"role":"tool","message":{"content":[{"type":"tool_result","name":"shell","result":{"success":{"command":"git status -sb","workingDirectory":"D:/src/kaaroSessions","stdout":"## kaaro/feat/add-grok-bot","executionTime":200},"isBackground":false}}]}},
  {"role":"assistant","message":{"content":[{"type":"tool_use","name":"read","input":{"path":"docs/harnesses.md"}}]}},
  {"role":"tool","message":{"content":[{"type":"tool_result","name":"read","result":{"error":{"errorMessage":"Path is outside the allowed local-exec root"}}}]}},
];

test('grokBotSlug -- unique across two sand-subagent ids and a parent', () => {
  const parent = '348c59d5-3636-4efd-aac2-465d3881629c';
  const a = 'sand-subagent-25c32331-e9ad-4b12-9c0a-aaaaaaaaaaaa';
  const b = 'sand-subagent-deadbeef-0000-0000-0000-000000000000';
  assert.equal(grokBotSlug(parent), '348c59d5');
  assert.equal(grokBotSlug(a), '25c32331');
  assert.equal(grokBotSlug(b), 'deadbeef');
  const slugs = [grokBotSlug(parent), grokBotSlug(a), grokBotSlug(b)];
  assert.equal(new Set(slugs).size, 3);
  assert.notEqual(grokBotSlug(a), 'sand-sub');
});

test('recordsToNormalized -- line-at-a-time with shared state matches batch assistant_turn count', () => {
  const batch = recordsToNormalized(GOLDEN);
  const batchTurns = batch.filter(r => r.kind === 'assistant_turn').length;
  assert.equal(batchTurns, 1, 'batch golden stays one assistant_turn');

  const state = {};
  const incremental = [];
  for (const rec of GOLDEN) {
    incremental.push(...recordsToNormalized([rec], state));
  }
  assert.equal(
    incremental.filter(r => r.kind === 'assistant_turn').length,
    batchTurns,
    'shared state must not explode assistant_turns across live tails',
  );

  const fresh = [];
  for (const rec of GOLDEN) {
    fresh.push(...recordsToNormalized([rec]));
  }
  assert.ok(
    fresh.filter(r => r.kind === 'assistant_turn').length > batchTurns,
    'fresh state per line still emits extra turns (documents why shared state is required)',
  );
});

test('assistant_turn content_length comes from triggering thinking/send_message text', () => {
  const nrs = recordsToNormalized(GOLDEN);
  const turn = nrs.find(r => r.kind === 'assistant_turn');
  assert.ok(turn.content_length > 0);
  assert.equal(turn.content_length, 'Looking at the harness layout first.'.length);
});

test('await and get_mcp_tools are skipped as noise; update_todos stays tool_use', () => {
  const nrs = recordsToNormalized([
    { role: 'assistant', message: { content: [
      { type: 'tool_use', name: 'await', input: { shell_id: '1' } },
      { type: 'tool_use', name: 'get_mcp_tools', input: {} },
      { type: 'tool_use', name: 'update_todos', input: { todos: [{ id: '1', content: 'x' }] } },
      { type: 'tool_use', name: 'send_message', input: { text: { content: 'Working.' } } },
    ] } },
    { role: 'tool', message: { content: [
      { type: 'tool_result', name: 'await', result: { success: {} } },
      { type: 'tool_result', name: 'get_mcp_tools', result: { success: {} } },
      { type: 'tool_result', name: 'update_todos', result: { success: {} } },
    ] } },
  ]);
  assert.ok(!nrs.some(r => r.tool === 'await'));
  assert.ok(!nrs.some(r => r.tool === 'get_mcp_tools'));
  const todo = nrs.find(r => r.kind === 'tool_use' && r.tool === 'update_todos');
  assert.ok(todo);
  assert.notEqual(toolNameToKey(todo.tool, todo.category), 'other');
  assert.ok(!nrs.some(r => r.kind === 'tool_use' && r.tool === 'send_message'));
});

test('categorizeGrokBotShell -- first mapped simpleCommand; git command; python3 fallback', () => {
  assert.equal(categorizeGrokBotShell({
    command: 'Get-ChildItem -Path D:/src',
    simpleCommands: ['Get-ChildItem', 'git'],
  }), 'fs');
  assert.equal(categorizeGrokBotShell({ command: 'git status' }), 'git');
  assert.equal(categorizeGrokBotShell({ command: "python3 - <<PY\nprint(1)\nPY" }), 'python');
  assert.equal(categorizeGrokBotShell({
    command: 'python3 -c pass',
    simpleCommands: ['python3'],
  }), 'python');
  assert.equal(categorizeGrokBotShell({
    command: 'rg foo',
    executableCommands: [{ name: 'rg' }],
  }), 'fs');
});

test('Get-ChildItem shell NR category is fs and reducer bash_categories.fs increments', () => {
  const nrs = recordsToNormalized([
    { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'shell', input: {
      command: 'Get-ChildItem -Path D:/src/kaaroSessions',
      simpleCommands: ['Get-ChildItem'],
    } }] } },
  ]);
  const shell = nrs.find(r => r.kind === 'tool_use' && r.tool === 'shell');
  assert.equal(shell.category, 'fs');
  const session = reduceSession(nrs, {
    session_id: 'x', project_id: 'grok-bot', project_label: 'Grok Bot',
    harness: 'grok-bot', capabilities: { size_proxy: 'tool_calls' },
  });
  assert.equal(session.bash_categories.fs, 1);
  assert.equal(session.bash_categories.other || 0, 0);
});

test('result.failure maps to tool_result.error; success is not error; rejected still works', () => {
  const nrs = recordsToNormalized([
    { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'shell', input: { command: 'git status' } }] } },
    { role: 'tool', message: { content: [{ type: 'tool_result', name: 'shell', result: {
      failure: { command: 'git status', exitCode: 1, stderr: 'boom', stdout: '', executionTime: 12 },
    } }] } },
    { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'read', input: { path: 'a.txt' } }] } },
    { role: 'tool', message: { content: [{ type: 'tool_result', name: 'read', result: { rejected: true } }] } },
    { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'shell', input: { command: 'git status' } }] } },
    { role: 'tool', message: { content: [{ type: 'tool_result', name: 'shell', result: {
      success: { command: 'git status', stdout: 'ok', executionTime: 1 },
    } }] } },
  ]);
  const results = nrs.filter(r => r.kind === 'tool_result');
  assert.equal(results[0].error, true);
  assert.equal(results[0].error_text, 'boom');
  assert.equal(results[1].error, true);
  assert.equal(results[2].error, false);
  for (const nr of nrs) {
    const { ok, errors } = validateNormalizedRecord(nr);
    assert.ok(ok, nr.kind + ': ' + errors.join('; '));
  }
});

test('result.failure without stderr uses exitCode or failure', () => {
  const nrs = recordsToNormalized([
    { role: 'tool', message: { content: [{ type: 'tool_result', name: 'shell', result: {
      failure: { exitCode: 2 },
    } }] } },
  ]);
  const tr = nrs.find(r => r.kind === 'tool_result');
  assert.equal(tr.error, true);
  assert.equal(tr.error_text, '2');
});

test('pulse transform of grok-bot tool_use with ts:null gets a ts; batch still uses send_message ISO', () => {
  const iso = new Date(Number('1787860893175')).toISOString();
  const batch = recordsToNormalized(GOLDEN);
  const withTs = batch.filter(r => r.ts);
  assert.ok(withTs.length >= 1);
  assert.ok(withTs.every(r => r.ts === iso));

  const [pulse] = normRecordsToPulses(
    [{ kind: 'tool_use', harness: 'grok-bot', ts: null, tool: 'shell', category: 'fs', input: { command: 'Get-ChildItem' } }],
    { session_id: 'sid', slug: '25c32331', project_label: 'Grok Bot', harness: 'grok-bot' },
  );
  assert.equal(pulse.event, 'tool_call');
  assert.ok(pulse.data.ts, 'live pulse must stamp ts when NR.ts is null');
  assert.notEqual(pulse.data.ts, iso);

  const stamped = stampPulse({ event: 'tool_result', data: { ts: null, tool: 'shell' } });
  assert.ok(stamped.data.ts);
});

test('client live sinks listen for thinking pulses', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const live = readFileSync(join(root, 'experience/client/13-live-updates.js'), 'utf8');
  const daw = readFileSync(join(root, 'experience/client/19-daw-builder.js'), 'utf8');
  assert.match(live, /['"]thinking['"]/);
  assert.match(daw, /addEventListener\(\s*['"]thinking['"]/);
});