import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../lib/graph-pipeline.mjs';

// ── fixture ───────────────────────────────────────────────────────────────────
function makeData(overrides = {}) {
  return {
    meta: { generated_at: '2026-05-11T00:00:00.000Z', date_range: { first: '2026-05-01T00:00:00.000Z', last: '2026-05-11T00:00:00.000Z' } },
    projects: [{
      id: 'proj-a', label: 'Proj A', session_count: 2,
      tokens: { input: 100, output: 200, cache_create: 50, cache_read: 30 },
      skills: ['review'],
    }],
    sessions: [
      {
        session_id: 's1', project_id: 'proj-a', slug: 'alpha',
        tokens: { input: 50, output: 80, cache_create: 20, cache_read: 10 },
        first_timestamp: '2026-05-01T10:00:00.000Z',
        last_timestamp:  '2026-05-01T10:30:00.000Z',
        git_branch: 'main', date_str: '2026-05-01', duration_min: 30,
        tool_calls: 10, tool_errors: 1, tool_diversity: 5, message_count: 8,
        user_turns: 4, assistant_turns: 4, cache_hit_rate: 20, skills: [],
      },
      {
        session_id: 's2', project_id: 'proj-a', slug: 'beta',
        tokens: { input: 50, output: 120, cache_create: 30, cache_read: 20 },
        first_timestamp: '2026-05-05T14:00:00.000Z',
        last_timestamp:  '2026-05-05T14:45:00.000Z',
        git_branch: 'main', date_str: '2026-05-05', duration_min: 45,
        tool_calls: 15, tool_errors: 0, tool_diversity: 4, message_count: 12,
        user_turns: 6, assistant_turns: 6, cache_hit_rate: 30, skills: ['review'],
      },
    ],
    rollup: { files: [] },
    ...overrides,
  };
}

// ── buildGraph ────────────────────────────────────────────────────────────────
test('buildGraph', async t => {
  const data = makeData();
  const result = buildGraph(data, { referenceMs: new Date('2026-05-11T00:00:00.000Z').getTime() });

  await t.test('returns nodes, edges, timeline, stats', () => {
    assert.ok(Array.isArray(result.nodes));
    assert.ok(Array.isArray(result.edges));
    assert.ok(Array.isArray(result.timeline));
    assert.ok(typeof result.stats === 'object');
  });

  await t.test('creates one project node', () => {
    const proj = result.nodes.filter(n => n.type === 'project');
    assert.equal(proj.length, 1);
    assert.equal(proj[0].id, 'proj-a');
    assert.equal(proj[0].label, 'Proj A');
  });

  await t.test('creates two session nodes', () => {
    const sess = result.nodes.filter(n => n.type === 'session');
    assert.equal(sess.length, 2);
  });

  await t.test('session node has expected fields', () => {
    const s = result.nodes.find(n => n.id === 's1');
    assert.ok(s);
    assert.equal(s.type, 'session');
    assert.equal(s.label, 'alpha');
    assert.equal(s.git_branch, 'main');
    assert.equal(s.tokens_work, 80 + 20);  // output + cache_create
    assert.equal(typeof s.sizeNorm, 'number');
    assert.equal(typeof s.recency, 'number');
    assert.equal(typeof s.errorLevel, 'number');
    assert.equal(s.source, 'claude-code');
  });

  await t.test('creates membership edges', () => {
    const mem = result.edges.filter(e => e.type === 'membership');
    assert.equal(mem.length, 2);
    assert.ok(mem.every(e => e.target === 'proj-a'));
  });

  await t.test('creates branch lineage edge between same-branch sessions', () => {
    const branch = result.edges.filter(e => e.type === 'branch');
    assert.equal(branch.length, 1);
    assert.equal(branch[0].source, 's1');
    assert.equal(branch[0].target, 's2');
  });

  await t.test('stats match node/edge counts', () => {
    assert.equal(result.stats.project, 1);
    assert.equal(result.stats.session, 2);
    assert.equal(result.stats.membership, 2);
    assert.equal(result.stats.branch, 1);
  });

  await t.test('timeline contains only sessions with date_str', () => {
    assert.equal(result.timeline.length, 2);
    assert.ok(result.timeline.every(t => t.date_str));
  });

  await t.test('timeline sorted by first_timestamp ascending', () => {
    assert.ok(result.timeline[0].ts < result.timeline[1].ts);
  });

  await t.test('session source defaults to claude-code', () => {
    const s = result.nodes.find(n => n.id === 's1');
    assert.equal(s.source, 'claude-code');
  });

  await t.test('session with explicit source preserves it', () => {
    const data2 = makeData();
    data2.sessions[0].source = 'pi';
    const r = buildGraph(data2, { referenceMs: Date.now() });
    assert.equal(r.nodes.find(n => n.id === 's1').source, 'pi');
  });
});

// ── file nodes ────────────────────────────────────────────────────────────────
test('buildGraph with file nodes', async t => {
  const data = makeData({
    rollup: {
      files: [{
        path: 'src/index.js', sessions: ['s1', 's2'],
        read: 2, write: 1, edit: 3,
      }],
    },
  });
  // sessions need file_ops
  data.sessions[0].file_ops = { 'src/index.js': { read: 1, write: 1, edit: 2 } };
  data.sessions[1].file_ops = { 'src/index.js': { read: 1, write: 0, edit: 1 } };

  const result = buildGraph(data, { minSessions: 1, referenceMs: Date.now() });

  await t.test('creates one file node', () => {
    const files = result.nodes.filter(n => n.type === 'file');
    assert.equal(files.length, 1);
    assert.equal(files[0].id, 'src/index.js');
  });

  await t.test('file node has correct op counts', () => {
    const f = result.nodes.find(n => n.type === 'file');
    assert.equal(f.write, 1);
    assert.equal(f.edit, 3);
    assert.equal(f.read, 2);
  });

  await t.test('minSessions filter excludes files below threshold', () => {
    const r = buildGraph(data, { minSessions: 3, referenceMs: Date.now() });
    assert.equal(r.nodes.filter(n => n.type === 'file').length, 0);
  });
});
