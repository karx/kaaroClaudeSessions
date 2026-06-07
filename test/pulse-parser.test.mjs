import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePulse } from '../lib/pulse-parser.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TS  = '2026-06-07T09:00:00.000Z';
const CTX = { session_id: 'abc123def456', slug: 'abc123de', project_id: 'D--src-foo', project_label: 'foo' };

function ccAssistant(content = [], usage, ts = TS) {
  return {
    type: 'assistant',
    timestamp: ts,
    message: { model: 'claude-sonnet-4-6', ...(usage !== undefined && { usage }), content },
  };
}

function ccTool(name, input = {}) {
  return { type: 'tool_use', id: 'tu01', name, input };
}

function ccText(text) {
  return { type: 'text', text };
}

function ccThinking(thinking) {
  return { type: 'thinking', thinking };
}

function piAssistant(content = [], usage, ts = TS) {
  return {
    type: 'message',
    id: 'a01',
    timestamp: ts,
    message: {
      role: 'assistant',
      content,
      ...(usage !== undefined && { usage }),
    },
  };
}

function piTool(name, args = {}) {
  return { type: 'toolCall', id: 'tc01', name, arguments: args };
}

// ── CC: tool_use blocks → tool_call pulses ────────────────────────────────────

test('parsePulse CC — Read → tool_call with where=file_path', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Read', { file_path: 'src/foo.js' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.ok(tc, 'tool_call pulse expected');
  assert.equal(tc.data.tool, 'Read');
  assert.equal(tc.data.where, 'src/foo.js');
});

test('parsePulse CC — Write → tool_call with where=file_path', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Write', { file_path: 'out.js' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.tool, 'Write');
  assert.equal(tc.data.where, 'out.js');
});

test('parsePulse CC — Edit → tool_call with where=file_path', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Edit', { file_path: 'lib/x.mjs' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.tool, 'Edit');
  assert.equal(tc.data.where, 'lib/x.mjs');
});

test('parsePulse CC — Bash → tool_call with where=cmd (80 chars max)', () => {
  const cmd = 'node --test 2>&1';
  const pulses = parsePulse(ccAssistant([ccTool('Bash', { command: cmd })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.tool, 'Bash');
  assert.equal(tc.data.where, cmd);
});

test('parsePulse CC — Bash long command is truncated to 80 chars', () => {
  const cmd = 'x'.repeat(200);
  const pulses = parsePulse(ccAssistant([ccTool('Bash', { command: cmd })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.where, cmd.slice(0, 80));
});

test('parsePulse CC — PowerShell → tool_call with where=cmd', () => {
  const pulses = parsePulse(ccAssistant([ccTool('PowerShell', { command: 'Get-ChildItem' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.tool, 'PowerShell');
  assert.equal(tc.data.where, 'Get-ChildItem');
});

test('parsePulse CC — Grep → tool_call with where=pattern', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Grep', { pattern: 'function.*export' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.where, 'function.*export');
});

test('parsePulse CC — Glob → tool_call with where=pattern', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Glob', { pattern: '**/*.ts' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.where, '**/*.ts');
});

test('parsePulse CC — Agent with description → tool_call with why=description', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Agent', { description: 'explore codebase' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.tool, 'Agent');
  assert.equal(tc.data.why, 'explore codebase');
  assert.equal(tc.data.where, null);
});

test('parsePulse CC — unknown tool → tool_call with where=null, why=null', () => {
  const pulses = parsePulse(ccAssistant([ccTool('WebFetch', { url: 'https://example.com' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.ok(tc, 'tool_call expected');
  assert.equal(tc.data.where, null);
  assert.equal(tc.data.why, null);
});

test('parsePulse CC — two tool_use blocks → two tool_call pulses', () => {
  const pulses = parsePulse(ccAssistant([
    ccTool('Read',  { file_path: 'a.js' }),
    ccTool('Write', { file_path: 'b.js' }),
  ]), CTX);
  const tcs = pulses.filter(p => p.event === 'tool_call');
  assert.equal(tcs.length, 2);
  assert.equal(tcs[0].data.tool, 'Read');
  assert.equal(tcs[1].data.tool, 'Write');
});

test('parsePulse CC — Bash category included in tool_call data', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Bash', { command: 'git status' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.category, 'git');
});

test('parsePulse CC — non-Bash tool has category null', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Read', { file_path: 'x.js' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.category, null);
});

// ── CC: context fields on every pulse ────────────────────────────────────────

test('parsePulse CC — context slug and project on tool_call', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Read', { file_path: 'x.js' })]), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.slug,    CTX.slug);
  assert.equal(tc.data.project, CTX.project_label);
});

test('parsePulse CC — ts comes from record.timestamp', () => {
  const pulses = parsePulse(ccAssistant([ccTool('Read', { file_path: 'x.js' })], undefined, TS), CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.ts, TS);
});

test('parsePulse CC — missing timestamp → ts is null', () => {
  const rec = { type: 'assistant', message: { content: [ccTool('Read', { file_path: 'x.js' })] } };
  const pulses = parsePulse(rec, CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.ts, null);
});

// ── CC: tokens pulse ──────────────────────────────────────────────────────────

test('parsePulse CC — assistant with usage → tokens pulse', () => {
  const usage = { input_tokens: 500, output_tokens: 120, cache_creation_input_tokens: 200, cache_read_input_tokens: 80 };
  const pulses = parsePulse(ccAssistant([], usage), CTX);
  const tp = pulses.find(p => p.event === 'tokens');
  assert.ok(tp, 'tokens pulse expected');
  assert.equal(tp.data.input,        500);
  assert.equal(tp.data.output,       120);
  assert.equal(tp.data.cache_create, 200);
  assert.equal(tp.data.cache_read,   80);
});

test('parsePulse CC — missing usage sub-fields default to 0', () => {
  const pulses = parsePulse(ccAssistant([], {}), CTX);
  const tp = pulses.find(p => p.event === 'tokens');
  assert.ok(tp);
  assert.equal(tp.data.input,        0);
  assert.equal(tp.data.output,       0);
  assert.equal(tp.data.cache_create, 0);
  assert.equal(tp.data.cache_read,   0);
});

test('parsePulse CC — no usage key → no tokens pulse', () => {
  const pulses = parsePulse(ccAssistant([]), CTX);
  assert.ok(!pulses.find(p => p.event === 'tokens'), 'should be no tokens pulse');
});

// ── CC: words pulse ───────────────────────────────────────────────────────────

test('parsePulse CC — text block → words pulse with preview and word_count', () => {
  const pulses = parsePulse(ccAssistant([ccText('All 668 tests pass with zero failures.')]), CTX);
  const wp = pulses.find(p => p.event === 'words');
  assert.ok(wp, 'words pulse expected');
  assert.ok(wp.data.preview.length > 0);
  assert.ok(wp.data.word_count >= 7);
});

test('parsePulse CC — long text block preview is 120 chars max', () => {
  const text = 'word '.repeat(100);
  const pulses = parsePulse(ccAssistant([ccText(text)]), CTX);
  const wp = pulses.find(p => p.event === 'words');
  assert.ok(wp.data.preview.length <= 120);
});

test('parsePulse CC — empty string text block → no words pulse', () => {
  const pulses = parsePulse(ccAssistant([ccText('')]), CTX);
  assert.ok(!pulses.find(p => p.event === 'words'));
});

test('parsePulse CC — whitespace-only text block → no words pulse', () => {
  const pulses = parsePulse(ccAssistant([ccText('   \n  ')]), CTX);
  assert.ok(!pulses.find(p => p.event === 'words'));
});

test('parsePulse CC — short text (< 3 words) → no words pulse', () => {
  const pulses = parsePulse(ccAssistant([ccText('OK.')]), CTX);
  assert.ok(!pulses.find(p => p.event === 'words'));
});

test('parsePulse CC — thinking block → no pulse', () => {
  const pulses = parsePulse(ccAssistant([ccThinking('internal reasoning...')]), CTX);
  assert.equal(pulses.length, 0);
});

test('parsePulse CC — multiple text blocks → one words pulse per qualifying block', () => {
  const pulses = parsePulse(ccAssistant([
    ccText('First substantive response text here.'),
    ccText('Second response continues further with more words.'),
    ccText('ok'),
  ]), CTX);
  const wps = pulses.filter(p => p.event === 'words');
  assert.equal(wps.length, 2, 'two qualifying text blocks');
});

// ── CC: non-producing records ─────────────────────────────────────────────────

test('parsePulse CC — type:user → []', () => {
  const rec = { type: 'user', timestamp: TS, message: { content: 'hello' } };
  assert.deepEqual(parsePulse(rec, CTX), []);
});

test('parsePulse CC — type:system → []', () => {
  const rec = { type: 'system', subtype: 'turn_duration', timestamp: TS, durationMs: 5000 };
  assert.deepEqual(parsePulse(rec, CTX), []);
});

test('parsePulse CC — null record → []', () => {
  assert.deepEqual(parsePulse(null, CTX), []);
});

test('parsePulse CC — undefined record → []', () => {
  assert.deepEqual(parsePulse(undefined, CTX), []);
});

test('parsePulse CC — assistant with empty content and no usage → []', () => {
  assert.deepEqual(parsePulse(ccAssistant([]), CTX), []);
});

// ── Pi: assistant tool calls ──────────────────────────────────────────────────

const PI_CTX = { session_id: '019dca2b-f4f5-7609-96ae-fe883f7a03db', slug: '019dca2b', project_id: '--D--src-ebrain--', project_label: 'ebrain' };

test('parsePulse Pi — type:message role:assistant + toolCall → tool_call pulse', () => {
  const pulses = parsePulse(piAssistant([piTool('read', { path: 'src/index.js' })]), PI_CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.ok(tc, 'tool_call pulse expected');
  assert.equal(tc.data.tool, 'read');
});

test('parsePulse Pi — read → tool_call with where=arguments.path', () => {
  const pulses = parsePulse(piAssistant([piTool('read', { path: 'src/foo.js' })]), PI_CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.where, 'src/foo.js');
});

test('parsePulse Pi — write → tool_call with where=arguments.path', () => {
  const pulses = parsePulse(piAssistant([piTool('write', { path: 'out.md', content: '# hi' })]), PI_CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.tool, 'write');
  assert.equal(tc.data.where, 'out.md');
});

test('parsePulse Pi — edit → tool_call with where=arguments.path', () => {
  const pulses = parsePulse(piAssistant([piTool('edit', { path: 'lib/x.js' })]), PI_CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.where, 'lib/x.js');
});

test('parsePulse Pi — bash → tool_call with where=arguments.command (80 chars max)', () => {
  const pulses = parsePulse(piAssistant([piTool('bash', { command: 'git status' })]), PI_CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.tool, 'bash');
  assert.equal(tc.data.where, 'git status');
});

test('parsePulse Pi — bash category included', () => {
  const pulses = parsePulse(piAssistant([piTool('bash', { command: 'npm install' })]), PI_CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.category, 'npm');
});

test('parsePulse Pi — non-bash tool has category null', () => {
  const pulses = parsePulse(piAssistant([piTool('read', { path: 'x.js' })]), PI_CTX);
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.equal(tc.data.category, null);
});

// ── Pi: tokens (field name remapping) ────────────────────────────────────────

test('parsePulse Pi — usage.input → tokens.input', () => {
  const pulses = parsePulse(piAssistant([], { input: 500, output: 0, cacheRead: 0, cacheWrite: 0 }), PI_CTX);
  const tp = pulses.find(p => p.event === 'tokens');
  assert.ok(tp, 'tokens pulse expected');
  assert.equal(tp.data.input, 500);
});

test('parsePulse Pi — usage.output → tokens.output', () => {
  const pulses = parsePulse(piAssistant([], { input: 0, output: 120, cacheRead: 0, cacheWrite: 0 }), PI_CTX);
  const tp = pulses.find(p => p.event === 'tokens');
  assert.equal(tp.data.output, 120);
});

test('parsePulse Pi — usage.cacheRead → tokens.cache_read', () => {
  const pulses = parsePulse(piAssistant([], { input: 0, output: 0, cacheRead: 80, cacheWrite: 0 }), PI_CTX);
  const tp = pulses.find(p => p.event === 'tokens');
  assert.equal(tp.data.cache_read, 80);
});

test('parsePulse Pi — usage.cacheWrite → tokens.cache_create', () => {
  const pulses = parsePulse(piAssistant([], { input: 0, output: 0, cacheRead: 0, cacheWrite: 40 }), PI_CTX);
  const tp = pulses.find(p => p.event === 'tokens');
  assert.equal(tp.data.cache_create, 40);
});

test('parsePulse Pi — no usage key → no tokens pulse', () => {
  const pulses = parsePulse(piAssistant([]), PI_CTX);
  assert.ok(!pulses.find(p => p.event === 'tokens'));
});

// ── Pi: non-producing records ─────────────────────────────────────────────────

test('parsePulse Pi — type:message role:user → []', () => {
  const rec = { type: 'message', timestamp: TS, message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } };
  assert.deepEqual(parsePulse(rec, PI_CTX), []);
});

test('parsePulse Pi — type:session → []', () => {
  const rec = { type: 'session', id: 'x', cwd: '/src', timestamp: TS };
  assert.deepEqual(parsePulse(rec, PI_CTX), []);
});

test('parsePulse Pi — type:model_change → []', () => {
  const rec = { type: 'model_change', provider: 'openai', modelId: 'gpt-5', timestamp: TS };
  assert.deepEqual(parsePulse(rec, PI_CTX), []);
});

// ── Dispatch is by record shape, not by ctx field ─────────────────────────────

test('parsePulse — CC record dispatched correctly without harness in ctx', () => {
  const ctxNoHarness = { session_id: 'abc', slug: 'abc', project_id: 'p', project_label: 'p' };
  const pulses = parsePulse(ccAssistant([ccTool('Read', { file_path: 'x.js' })]), ctxNoHarness);
  assert.ok(pulses.find(p => p.event === 'tool_call'));
});

test('parsePulse — Pi record dispatched correctly without harness in ctx', () => {
  const ctxNoHarness = { session_id: 'abc', slug: 'abc', project_id: 'p', project_label: 'p' };
  const pulses = parsePulse(piAssistant([piTool('read', { path: 'x.js' })]), ctxNoHarness);
  assert.ok(pulses.find(p => p.event === 'tool_call'));
});

// ── Mixed: record with tools + usage + text in one turn ───────────────────────

test('parsePulse Antigravity — PLANNER_RESPONSE view_file → tool_call', () => {
  const record = {
    type: 'PLANNER_RESPONSE', source: 'MODEL', created_at: TS,
    content: 'I will read the file now.',
    tool_calls: [{
      name: 'view_file',
      args: { AbsolutePath: JSON.stringify('D:/src/foo.js'), toolSummary: '"Viewing"' },
    }],
  };
  const pulses = parsePulse(record, { ...CTX, harness: 'antigravity' });
  const tc = pulses.find(p => p.event === 'tool_call');
  assert.ok(tc);
  assert.equal(tc.data.tool, 'view_file');
  assert.equal(tc.data.where, 'D:/src/foo.js');
  assert.equal(tc.data.harness, 'antigravity');
  assert.equal(tc.data.session_id, CTX.session_id);
});

test('parsePulse Antigravity — no tokens pulse (tokenless harness)', () => {
  const record = {
    type: 'PLANNER_RESPONSE', source: 'MODEL', created_at: TS,
    content: 'Working on it now with several tools.',
    tool_calls: [],
  };
  const pulses = parsePulse(record, { harness: 'antigravity', ...CTX });
  assert.equal(pulses.find(p => p.event === 'tokens'), undefined);
  assert.ok(pulses.find(p => p.event === 'words'));
});

test('parsePulse CC — one record produces tool_call + tokens + words pulses', () => {
  const rec = ccAssistant(
    [ccTool('Read', { file_path: 'src/app.js' }), ccText('Reading the file now to understand structure.')],
    { input_tokens: 400, output_tokens: 60 },
  );
  const pulses = parsePulse(rec, CTX);
  assert.ok(pulses.find(p => p.event === 'tool_call'));
  assert.ok(pulses.find(p => p.event === 'tokens'));
  assert.ok(pulses.find(p => p.event === 'words'));
});
