import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractToolTimeline,
  parseSessionFlag,
  mergeSessionIntoData,
} from '../analyze.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

const TS = '2026-05-07T10:00:00.000Z';
const T2 = '2026-05-07T10:01:00.000Z';

function makeAssistantRec(blocks, ts = TS) {
  return {
    type: 'assistant',
    timestamp: ts,
    message: { content: blocks, model: 'claude-sonnet-4-5', usage: {} },
  };
}

function toolBlock(name, input = {}) {
  return { type: 'tool_use', name, input };
}

// ── extractToolTimeline ───────────────────────────────────────────────────────

test('extractToolTimeline — empty / no tools', async t => {
  await t.test('returns empty array for empty records', () => {
    assert.deepEqual(extractToolTimeline([]), []);
  });

  await t.test('returns empty array when records have no tool_use blocks', () => {
    const records = [
      makeAssistantRec([{ type: 'text', text: 'hi' }]),
    ];
    assert.deepEqual(extractToolTimeline(records), []);
  });

  await t.test('ignores non-assistant record types', () => {
    const records = [
      { type: 'user', timestamp: TS, message: { content: [{ type: 'tool_result' }] } },
    ];
    assert.deepEqual(extractToolTimeline(records), []);
  });
});

test('extractToolTimeline — basic extraction', async t => {
  await t.test('extracts one tool call with correct name and turn', () => {
    const records = [
      makeAssistantRec([toolBlock('Read', { file_path: 'src/foo.js' })]),
    ];
    const timeline = extractToolTimeline(records);
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].name, 'Read');
    assert.equal(timeline[0].turn, 1);
  });

  await t.test('ts comes from the parent record timestamp', () => {
    const records = [
      makeAssistantRec([toolBlock('Read', { file_path: 'x.js' })], T2),
    ];
    const timeline = extractToolTimeline(records);
    assert.equal(timeline[0].ts, T2);
  });

  await t.test('turn increments per assistant record, not per tool call', () => {
    const records = [
      makeAssistantRec([toolBlock('Read', { file_path: 'a.js' }), toolBlock('Write', { file_path: 'b.js' })], TS),
      makeAssistantRec([toolBlock('Bash', { command: 'git status' })], T2),
    ];
    const timeline = extractToolTimeline(records);
    assert.equal(timeline[0].turn, 1);
    assert.equal(timeline[1].turn, 1);
    assert.equal(timeline[2].turn, 2);
  });
});

test('extractToolTimeline — where field', async t => {
  await t.test('where is file_path for Read', () => {
    const records = [makeAssistantRec([toolBlock('Read', { file_path: 'src/app.js' })])];
    assert.equal(extractToolTimeline(records)[0].where, 'src/app.js');
  });

  await t.test('where is file_path for Write', () => {
    const records = [makeAssistantRec([toolBlock('Write', { file_path: 'out.js' })])];
    assert.equal(extractToolTimeline(records)[0].where, 'out.js');
  });

  await t.test('where is file_path for Edit', () => {
    const records = [makeAssistantRec([toolBlock('Edit', { file_path: 'index.html' })])];
    assert.equal(extractToolTimeline(records)[0].where, 'index.html');
  });

  await t.test('where is command (truncated to 120 chars) for Bash', () => {
    const cmd = 'git log --oneline';
    const records = [makeAssistantRec([toolBlock('Bash', { command: cmd })])];
    assert.equal(extractToolTimeline(records)[0].where, cmd);
  });

  await t.test('Bash command truncated to 120 chars', () => {
    const cmd = 'x'.repeat(200);
    const records = [makeAssistantRec([toolBlock('Bash', { command: cmd })])];
    assert.equal(extractToolTimeline(records)[0].where, cmd.slice(0, 120));
  });

  await t.test('where is pattern for Grep', () => {
    const records = [makeAssistantRec([toolBlock('Grep', { pattern: 'function.*export' })])];
    assert.equal(extractToolTimeline(records)[0].where, 'function.*export');
  });

  await t.test('where is pattern for Glob', () => {
    const records = [makeAssistantRec([toolBlock('Glob', { pattern: '**/*.ts' })])];
    assert.equal(extractToolTimeline(records)[0].where, '**/*.ts');
  });

  await t.test('where is null for unknown tool with no relevant input', () => {
    const records = [makeAssistantRec([toolBlock('Agent', { description: 'explore' })])];
    assert.equal(extractToolTimeline(records)[0].where, null);
  });
});

test('extractToolTimeline — why field', async t => {
  await t.test('why is description when input.description is present', () => {
    const records = [makeAssistantRec([toolBlock('Bash', { command: 'npm test', description: 'run tests' })])];
    assert.equal(extractToolTimeline(records)[0].why, 'run tests');
  });

  await t.test('why is null when input.description is absent', () => {
    const records = [makeAssistantRec([toolBlock('Read', { file_path: 'x.js' })])];
    assert.equal(extractToolTimeline(records)[0].why, null);
  });
});

test('extractToolTimeline — multiple tools across turns', async t => {
  await t.test('collects all tool calls in order', () => {
    const records = [
      makeAssistantRec([
        toolBlock('Read',  { file_path: 'a.js' }),
        toolBlock('Write', { file_path: 'b.js' }),
      ], TS),
      makeAssistantRec([toolBlock('Bash', { command: 'node test.mjs' })], T2),
    ];
    const tl = extractToolTimeline(records);
    assert.equal(tl.length, 3);
    assert.equal(tl[0].name, 'Read');
    assert.equal(tl[1].name, 'Write');
    assert.equal(tl[2].name, 'Bash');
  });
});

// ── parseSessionFlag ──────────────────────────────────────────────────────────

test('parseSessionFlag', async t => {
  await t.test('returns null for empty argv', () => {
    assert.equal(parseSessionFlag([]), null);
  });
  await t.test('returns null when argv has unrelated args but no --session', () => {
    assert.equal(parseSessionFlag(['node', 'analyze.mjs']), null);
  });

  await t.test('parses --session=projectId/sessionId', () => {
    const result = parseSessionFlag(['--session=D--src-kaaroSessions/abc123']);
    assert.deepEqual(result, { projectId: 'D--src-kaaroSessions', sessionId: 'abc123' });
  });

  await t.test('strips .jsonl extension from sessionId', () => {
    const result = parseSessionFlag(['--session=D--src-foo/abc123.jsonl']);
    assert.equal(result.sessionId, 'abc123');
  });

  await t.test('projectId preserves all non-slash path components', () => {
    const result = parseSessionFlag(['--session=C--Users-karx0-proj/deadbeef']);
    assert.equal(result.projectId, 'C--Users-karx0-proj');
    assert.equal(result.sessionId, 'deadbeef');
  });

  await t.test('returns null if value has no slash', () => {
    assert.equal(parseSessionFlag(['--session=noseparator']), null);
  });
});

// ── mergeSessionIntoData ──────────────────────────────────────────────────────

function makeMinimalData(sessions = [], projects = []) {
  return {
    meta: { generated_at: TS, source_dir: '/fake', total_sessions: sessions.length, total_projects: projects.length, date_range: { first: null, last: null } },
    sessions,
    projects,
    rollup: { tools: [], skills: [], models: {}, tokens: { input: 0, cache_create: 0, cache_read: 0, output: 0 }, total_errors: 0, files: [] },
  };
}

function makeSession(id, projectId, opts = {}) {
  return {
    session_id: id,
    project_id: projectId,
    project_label: projectId.replace('proj-', ''),
    first_timestamp: opts.ts || TS,
    last_timestamp:  opts.ts || TS,
    tokens: { input: opts.input || 100, cache_create: 0, cache_read: 0, output: opts.output || 50 },
    tool_calls: opts.tool_calls || 0,
    tool_errors: 0,
    skills: [],
    builtin_commands: [],
    tools: {},
    file_ops: {},
    model: 'claude-sonnet-4-5',
    git_branch: 'main',
    file_size_bytes: 1000,
    duration_ms: null,
  };
}

test('mergeSessionIntoData — append new session', async t => {
  await t.test('adds session to sessions array when not present', () => {
    const data = makeMinimalData([], []);
    const sess = makeSession('new1', 'proj-A');
    const result = mergeSessionIntoData(data, sess);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].session_id, 'new1');
  });

  await t.test('does not mutate the original data object', () => {
    const data = makeMinimalData([], []);
    const sess = makeSession('new1', 'proj-A');
    mergeSessionIntoData(data, sess);
    assert.equal(data.sessions.length, 0);
  });
});

test('mergeSessionIntoData — replace existing session', async t => {
  await t.test('replaces session with same session_id', () => {
    const existing = makeSession('s1', 'proj-A', { input: 100, output: 50 });
    const data = makeMinimalData([existing], []);
    const updated = makeSession('s1', 'proj-A', { input: 200, output: 100 });
    const result = mergeSessionIntoData(data, updated);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].tokens.input, 200);
  });

  await t.test('keeps other sessions unchanged', () => {
    const s1 = makeSession('s1', 'proj-A');
    const s2 = makeSession('s2', 'proj-A');
    const data = makeMinimalData([s1, s2], []);
    const updated = makeSession('s1', 'proj-A', { input: 999 });
    const result = mergeSessionIntoData(data, updated);
    assert.equal(result.sessions.length, 2);
    assert.equal(result.sessions.find(s => s.session_id === 's2').tokens.input, 100);
  });
});

test('mergeSessionIntoData — project summary recomputed', async t => {
  await t.test('creates project summary for new project', () => {
    const data = makeMinimalData([], []);
    const sess = makeSession('s1', 'proj-A');
    const result = mergeSessionIntoData(data, sess);
    const proj = result.projects.find(p => p.id === 'proj-A');
    assert.ok(proj, 'project summary should exist');
    assert.equal(proj.session_count, 1);
  });

  await t.test('updates token totals in project summary after replace', () => {
    const s1 = makeSession('s1', 'proj-A', { input: 100, output: 50 });
    const s2 = makeSession('s2', 'proj-A', { input: 200, output: 80 });
    const data = makeMinimalData([s1, s2], []);
    const updated = makeSession('s1', 'proj-A', { input: 500, output: 200 });
    const result = mergeSessionIntoData(data, updated);
    const proj = result.projects.find(p => p.id === 'proj-A');
    assert.equal(proj.tokens.input, 700);  // 500 + 200
    assert.equal(proj.tokens.output, 280); // 200 + 80
  });
});

test('mergeSessionIntoData — meta updated', async t => {
  await t.test('updates total_sessions count', () => {
    const data = makeMinimalData([makeSession('s1', 'proj-A')], []);
    const result = mergeSessionIntoData(data, makeSession('s2', 'proj-A'));
    assert.equal(result.meta.total_sessions, 2);
  });

  await t.test('updates total_projects count when new project added', () => {
    const data = makeMinimalData([], []);
    const result = mergeSessionIntoData(data, makeSession('s1', 'proj-new'));
    assert.equal(result.meta.total_projects, 1);
  });
});

test('mergeSessionIntoData — rollup recomputed', async t => {
  await t.test('rollup tokens reflect the updated session values', () => {
    const old  = makeSession('s1', 'proj-A', { input: 100, output: 50 });
    const data = makeMinimalData([old], []);
    const updated = makeSession('s1', 'proj-A', { input: 300, output: 120 });
    const result = mergeSessionIntoData(data, updated);
    assert.equal(result.rollup.tokens.input,  300);
    assert.equal(result.rollup.tokens.output, 120);
  });

  await t.test('rollup total_errors updates when error count changes', () => {
    const old  = { ...makeSession('s1', 'proj-A'), tool_errors: 2 };
    const data = makeMinimalData([old], []);
    const updated = { ...makeSession('s1', 'proj-A'), tool_errors: 7 };
    const result = mergeSessionIntoData(data, updated);
    assert.equal(result.rollup.total_errors, 7);
  });

  await t.test('rollup includes tools from the merged session', () => {
    const old  = makeSession('s1', 'proj-A');
    const data = makeMinimalData([old], []);
    const updated = { ...makeSession('s1', 'proj-A'), tools: { Read: { calls: 5, errors: 0 } } };
    const result = mergeSessionIntoData(data, updated);
    const readEntry = result.rollup.tools.find(t => t.name === 'Read');
    assert.ok(readEntry, 'Read should appear in rollup.tools');
    assert.equal(readEntry.calls, 5);
  });
});

// ── mergeSessionIntoData — raw_ids / harnesses parity with buildSessionsOutput ──
//
// REQ-GRAPH-PERF-01 repro: the live-tail incremental path rebuilt a project
// summary without raw_ids/harnesses, so graph-pipeline's canon() couldn't map
// a Pi-dialect project_id (e.g. `--D--src-x--`) back to the canonical node,
// and d3-force threw "node not found" on the resulting dangling edge.

test('mergeSessionIntoData — raw_ids/harnesses parity', async t => {
  await t.test('sets raw_ids on a newly created project summary', () => {
    const data = makeMinimalData([], []);
    const sess = { ...makeSession('s1', 'proj-A'), harness: 'claude-code' };
    const result = mergeSessionIntoData(data, sess);
    const proj = result.projects.find(p => p.id === 'proj-A');
    assert.deepEqual(proj.raw_ids, ['proj-A']);
  });

  await t.test('sets harnesses on a newly created project summary', () => {
    const data = makeMinimalData([], []);
    const sess = { ...makeSession('s1', 'proj-A'), harness: 'claude-code' };
    const result = mergeSessionIntoData(data, sess);
    const proj = result.projects.find(p => p.id === 'proj-A');
    assert.deepEqual(proj.harnesses, ['claude-code']);
  });

  await t.test('merges a Pi-dialect project_id into the canonical bucket and records both raw_ids', () => {
    const cc = { ...makeSession('s1', 'D--src-x'), harness: 'claude-code' };
    const data = makeMinimalData([cc], []);
    const pi = { ...makeSession('s2', '--D--src-x--'), harness: 'pi' };
    const result = mergeSessionIntoData(data, pi);

    assert.equal(result.projects.length, 1, 'sessions across harness dialects merge into one project bucket');
    const proj = result.projects[0];
    assert.equal(proj.id, 'D--src-x');
    assert.deepEqual(proj.raw_ids, ['--D--src-x--', 'D--src-x']);
    assert.deepEqual(proj.harnesses, ['claude-code', 'pi']);
    assert.equal(proj.session_count, 2);
  });

  await t.test('preserves raw_ids/harnesses for untouched projects', () => {
    const a = { ...makeSession('s1', 'proj-A'), harness: 'claude-code' };
    const data = makeMinimalData([a], []);
    data.projects.push({ id: 'proj-A', raw_ids: ['proj-A'], harnesses: ['claude-code'], session_count: 1 });
    const b = { ...makeSession('s2', 'proj-B'), harness: 'grok' };
    const result = mergeSessionIntoData(data, b);
    const projA = result.projects.find(p => p.id === 'proj-A');
    assert.deepEqual(projA.raw_ids, ['proj-A']);
  });
});
