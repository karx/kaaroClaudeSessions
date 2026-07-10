import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../experience/graph-pipeline.mjs';

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
});

// ── session source field ──────────────────────────────────────────────────────
test('buildGraph — session source field', async t => {
  await t.test('defaults to "claude-code" when session has no source property', () => {
    const result = buildGraph(makeData(), { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').source, 'claude-code');
  });

  await t.test('preserves explicit source value set on the session', () => {
    const d = makeData();
    d.sessions[0].source = 'pi';
    const result = buildGraph(d, { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').source, 'pi');
  });
});

// ── project node fields ───────────────────────────────────────────────────────
test('buildGraph — project node fields', async t => {
  const REF = new Date('2026-05-11T00:00:00.000Z').getTime();
  const result = buildGraph(makeData(), { referenceMs: REF });
  const proj = result.nodes.find(n => n.type === 'project');

  await t.test('project color is a hex string', () => {
    assert.match(proj.color, /^#[0-9a-f]{6}$/i);
  });

  await t.test('project tokens_work = output + cache_create', () => {
    // makeData project: output=200, cache_create=50
    assert.equal(proj.tokens_work, 250);
  });

  await t.test('project session_count matches sessions array length', () => {
    assert.equal(proj.session_count, 2);
  });

  await t.test('project recency is 0 when last activity is older than MAX_AGE_MS', () => {
    // sessions are from 2026-05-01 and 05; ref is 2026-05-11 → > 2 days
    assert.equal(proj.recency, 0);
  });

  await t.test('project recencyLevel is 0 for stale data', () => {
    assert.equal(proj.recencyLevel, 0);
  });
});

// ── session node fields ───────────────────────────────────────────────────────
test('buildGraph — session sizeNorm', async t => {
  const result = buildGraph(makeData(), { referenceMs: Date.now() });

  await t.test('session with maximum tokens_work has sizeNorm 1.0', () => {
    // s2 has output=120, cache_create=30 → tokens_work=150 = MAX_WORK
    const s2 = result.nodes.find(n => n.id === 's2');
    assert.equal(s2.sizeNorm, 1.0);
  });

  await t.test('session with lower tokens_work has 0 < sizeNorm < 1', () => {
    // s1 has output=80, cache_create=20 → tokens_work=100 < 150
    const s1 = result.nodes.find(n => n.id === 's1');
    assert.ok(s1.sizeNorm > 0 && s1.sizeNorm < 1,
      `expected 0 < sizeNorm < 1, got ${s1.sizeNorm}`);
  });
});

test('buildGraph — session errorLevel', async t => {
  function withErrors(errorCount) {
    const d = makeData();
    d.sessions[0].tool_errors = errorCount;
    return buildGraph(d, { referenceMs: Date.now() }).nodes.find(node => node.id === 's1');
  }

  await t.test('errorLevel 0 when tool_errors is 0',  () => assert.equal(withErrors(0).errorLevel, 0));
  await t.test('errorLevel 0 when tool_errors is 2',  () => assert.equal(withErrors(2).errorLevel, 0));
  await t.test('errorLevel 1 at boundary of 3',       () => assert.equal(withErrors(3).errorLevel, 1));
  await t.test('errorLevel 1 when tool_errors is 7',  () => assert.equal(withErrors(7).errorLevel, 1));
  await t.test('errorLevel 2 at boundary of 8',       () => assert.equal(withErrors(8).errorLevel, 2));
  await t.test('errorLevel 2 when tool_errors is 20', () => assert.equal(withErrors(20).errorLevel, 2));
});

test('buildGraph — session thinking_count', async t => {
  await t.test('thinking_count is 0 when no content_blocks on session', () => {
    const result = buildGraph(makeData(), { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').thinking_count, 0);
  });

  await t.test('thinking_count reflects content_blocks.thinking', () => {
    const d = makeData();
    d.sessions[0].content_blocks = { thinking: 4, text: 2 };
    const result = buildGraph(d, { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').thinking_count, 4);
  });
});

test('buildGraph — session hit_max_tokens', async t => {
  await t.test('false when stop_reasons is absent', () => {
    const result = buildGraph(makeData(), { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').hit_max_tokens, false);
  });

  await t.test('true when stop_reasons.max_tokens > 0', () => {
    const d = makeData();
    d.sessions[0].stop_reasons = { max_tokens: 2 };
    const result = buildGraph(d, { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').hit_max_tokens, true);
  });

  await t.test('false when stop_reasons.max_tokens is 0', () => {
    const d = makeData();
    d.sessions[0].stop_reasons = { max_tokens: 0, end_turn: 3 };
    const result = buildGraph(d, { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').hit_max_tokens, false);
  });
});

test('buildGraph — session inFlight', async t => {
  // NOTE: buildGraph calls isSessionInFlight(sess, Date.now()) — it does NOT thread
  // referenceMs through to the inFlight check, so referenceMs has no effect on it.
  // isSessionInFlight itself is covered exhaustively in build-live.test.mjs.

  await t.test('inFlight is false for a session with an old last_timestamp', () => {
    // far-past timestamp → age >> 2 min threshold → always false
    const result = buildGraph(makeData(), { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').inFlight, false);
  });

  await t.test('inFlight is true for a session whose last_timestamp is right now', () => {
    const d = makeData();
    d.sessions[0].last_timestamp = new Date().toISOString(); // age ≈ 0ms < 2 min
    const result = buildGraph(d, { referenceMs: Date.now() });
    assert.equal(result.nodes.find(n => n.id === 's1').inFlight, true);
  });
});

// ── branch lineage ────────────────────────────────────────────────────────────
test('buildGraph — branch lineage', async t => {
  await t.test('sessions on different branches produce no branch edges between them', () => {
    const d = makeData();
    d.sessions[0].git_branch = 'main';
    d.sessions[1].git_branch = 'feature/xyz';
    const result = buildGraph(d, { referenceMs: Date.now() });
    assert.equal(result.edges.filter(e => e.type === 'branch').length, 0);
  });

  await t.test('branch edge carries the branch name', () => {
    // makeData has both sessions on 'main'
    const result = buildGraph(makeData(), { referenceMs: Date.now() });
    const edge = result.edges.find(e => e.type === 'branch');
    assert.equal(edge.branch, 'main');
  });

  await t.test('branch edge points from earlier to later session by timestamp', () => {
    // s1 first_timestamp < s2 first_timestamp
    const result = buildGraph(makeData(), { referenceMs: Date.now() });
    const edge = result.edges.find(e => e.type === 'branch');
    assert.equal(edge.source, 's1');
    assert.equal(edge.target, 's2');
  });

  await t.test('single session on a branch produces no branch edge', () => {
    const d = makeData();
    d.sessions[0].git_branch = 'main';
    d.sessions[1].git_branch = 'solo';
    const result = buildGraph(d, { referenceMs: Date.now() });
    // 'main' has only s1, 'solo' has only s2 → no branch edges
    assert.equal(result.edges.filter(e => e.type === 'branch').length, 0);
  });
});

// ── file nodes ────────────────────────────────────────────────────────────────
function makeDataWithFile() {
  const data = makeData({
    rollup: {
      files: [{
        path: 'src/index.js', sessions: ['s1', 's2'],
        read: 2, write: 1, edit: 3,
      }],
    },
  });
  data.sessions[0].file_ops = { 'src/index.js': { read: 1, write: 1, edit: 2 } };
  data.sessions[1].file_ops = { 'src/index.js': { read: 1, write: 0, edit: 1 } };
  return data;
}

test('buildGraph with file nodes', async t => {
  const result = buildGraph(makeDataWithFile(), { minSessions: 1, referenceMs: Date.now() });

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
    const r = buildGraph(makeDataWithFile(), { minSessions: 3, referenceMs: Date.now() });
    assert.equal(r.nodes.filter(n => n.type === 'file').length, 0);
  });
});

test('buildGraph with file nodes — edge stats', async t => {
  const result = buildGraph(makeDataWithFile(), { minSessions: 1, referenceMs: Date.now() });

  await t.test('stats.write counts sessions that performed writes', () => {
    // only s1 has write > 0
    assert.equal(result.stats.write, 1);
  });

  await t.test('stats.edit counts sessions that performed edits', () => {
    // both s1 and s2 have edit > 0
    assert.equal(result.stats.edit, 2);
  });

  await t.test('stats.read counts sessions that performed reads', () => {
    // both sessions have read > 0
    assert.equal(result.stats.read, 2);
  });
});

// ── cluster (bundle) nodes ────────────────────────────────────────────────────
function makeClusterData() {
  const mkSess = (id, ts, extra = {}) => ({
    session_id: id, project_id: 'proj-a', slug: `slug-${id}`,
    tokens: { input: 10, output: 80, cache_create: 20, cache_read: 10 },
    first_timestamp: `${ts}T10:00:00.000Z`, last_timestamp: `${ts}T11:00:00.000Z`,
    git_branch: 'main', date_str: ts, duration_min: 60,
    tool_calls: 10, tool_errors: 1, tool_diversity: 4, message_count: 8,
    user_turns: 4, assistant_turns: 4, cache_hit_rate: 20, skills: [],
    ...extra,
  });
  return makeData({
    projects: [{
      id: 'proj-a', label: 'Proj A', session_count: 4,
      tokens: { input: 100, output: 200, cache_create: 50, cache_read: 30 },
      skills: [],
    }],
    sessions: [
      mkSess('c1', '2026-05-01', {
        file_ops: { 'src/auth.js': { read: 1, write: 1, edit: 0 } },
        ai_title: 'auth rework', skills: ['review'],
      }),
      mkSess('c2', '2026-05-02', {
        file_ops: { 'src/auth.js': { read: 1, write: 0, edit: 1 } },
        ai_title: 'auth cleanup', harness: 'grok',
        tokens: { input: 10, output: 100, cache_create: 0, cache_read: 0 },
      }),
      mkSess('c3', '2026-05-03', {
        file_ops: { 'src/auth.js': { read: 2, write: 0, edit: 0 } },
        tokens: { input: 10, output: 50, cache_create: 50, cache_read: 0 },
      }),
      mkSess('s4', '2026-05-04', {
        file_ops: { 'docs/readme.md': { read: 1, write: 0, edit: 0 } },
        tokens: { input: 10, output: 10, cache_create: 0, cache_read: 0 },
      }),
    ],
  });
}

test('buildGraph — cluster nodes and bundle edges', async t => {
  const REF = new Date('2026-05-11T00:00:00.000Z').getTime();
  const result = buildGraph(makeClusterData(), { referenceMs: REF });
  const cluster = result.nodes.find(n => n.type === 'cluster');

  await t.test('emits one cluster node for the auth trio', () => {
    assert.equal(result.nodes.filter(n => n.type === 'cluster').length, 1);
    assert.equal(cluster.id, 'cluster:proj-a:c1');
    assert.deepEqual(cluster.member_ids, ['c1', 'c2', 'c3']);
    assert.equal(cluster.member_count, 3);
    assert.equal(cluster.project_id, 'proj-a');
    assert.equal(cluster.manual, false);
    assert.equal(cluster.label_overridden, false);
  });

  await t.test('cluster inherits the project color', () => {
    const proj = result.nodes.find(n => n.type === 'project');
    assert.equal(cluster.color, proj.color);
  });

  await t.test('cluster aggregates member telemetry', () => {
    assert.equal(cluster.tokens_work, 100 + 100 + 100);
    assert.equal(cluster.tool_calls, 30);
    assert.equal(cluster.tool_errors, 3);
    assert.equal(cluster.errorLevel, 1); // 3 errors → level 1
    assert.deepEqual([...cluster.skills].sort(), ['review']);
    assert.deepEqual([...cluster.harnesses].sort(), ['claude-code', 'grok']);
    assert.equal(cluster.date_first, '2026-05-01');
    assert.equal(cluster.date_last, '2026-05-03');
    assert.equal(cluster.inFlight, false);
  });

  await t.test('cluster sizeNorm normalizes on its own scale (single cluster → 1)', () => {
    assert.equal(cluster.sizeNorm, 1);
  });

  await t.test('emits membership edge cluster → project', () => {
    const e = result.edges.find(e => e.type === 'membership' && e.source === cluster.id);
    assert.ok(e);
    assert.equal(e.target, 'proj-a');
  });

  await t.test('emits bundle edges member → cluster', () => {
    const bundles = result.edges.filter(e => e.type === 'bundle');
    assert.equal(bundles.length, 3);
    assert.ok(bundles.every(e => e.target === cluster.id));
    assert.deepEqual(bundles.map(e => e.source).sort(), ['c1', 'c2', 'c3']);
  });

  await t.test('session nodes carry cluster_id; unclustered session has null', () => {
    assert.equal(result.nodes.find(n => n.id === 'c1').cluster_id, cluster.id);
    assert.equal(result.nodes.find(n => n.id === 'c3').cluster_id, cluster.id);
    assert.equal(result.nodes.find(n => n.id === 's4').cluster_id, null);
  });

  await t.test('session → project membership edges are kept, not rerouted', () => {
    const sessMem = result.edges.filter(e => e.type === 'membership' && e.source !== cluster.id);
    assert.equal(sessMem.length, 4);
    assert.ok(sessMem.every(e => e.target === 'proj-a'));
  });

  await t.test('stats include cluster and bundle counts', () => {
    assert.equal(result.stats.cluster, 1);
    assert.equal(result.stats.bundle, 3);
    assert.equal(result.stats.membership, 5); // 4 sessions + 1 cluster
  });

  await t.test('timeline has no cluster entries', () => {
    assert.equal(result.timeline.length, 4);
    assert.ok(result.timeline.every(e => !String(e.id).startsWith('cluster:')));
  });
});

test('buildGraph — clusterOverrides flow through', async t => {
  const REF = new Date('2026-05-11T00:00:00.000Z').getTime();

  await t.test('pin excludes a session from clustering', () => {
    const overrides = { version: 1, projects: { 'proj-a': { pin: ['c2'] } } };
    const result = buildGraph(makeClusterData(), { referenceMs: REF, clusterOverrides: overrides });
    const cluster = result.nodes.find(n => n.type === 'cluster');
    assert.deepEqual(cluster.member_ids, ['c1', 'c3']);
    assert.equal(result.nodes.find(n => n.id === 'c2').cluster_id, null);
  });

  await t.test('assign creates a manual cluster', () => {
    const overrides = { version: 1, projects: { 'proj-a': { assign: { s4: 'docs work' } } } };
    const result = buildGraph(makeClusterData(), { referenceMs: REF, clusterOverrides: overrides });
    const manual = result.nodes.find(n => n.type === 'cluster' && n.manual);
    assert.equal(manual.id, 'cluster:proj-a:manual:docs-work');
    assert.equal(manual.label, 'docs work');
    assert.deepEqual(manual.member_ids, ['s4']);
    assert.equal(result.nodes.find(n => n.id === 's4').cluster_id, manual.id);
  });

  await t.test('labels rename applies and sets label_overridden', () => {
    const overrides = { version: 1, projects: { 'proj-a': { labels: { 'cluster:proj-a:c1': 'Auth rework' } } } };
    const result = buildGraph(makeClusterData(), { referenceMs: REF, clusterOverrides: overrides });
    const cluster = result.nodes.find(n => n.type === 'cluster');
    assert.equal(cluster.label, 'Auth rework');
    assert.equal(cluster.label_overridden, true);
  });
});

test('buildGraph — no clusters when sessions share nothing', () => {
  const result = buildGraph(makeData(), { referenceMs: Date.now() });
  assert.equal(result.nodes.filter(n => n.type === 'cluster').length, 0);
  assert.equal(result.stats.cluster, 0);
  assert.equal(result.stats.bundle, 0);
  assert.ok(result.nodes.filter(n => n.type === 'session').every(n => n.cluster_id === null));
});

test('buildGraph — tokenless session sizes by tool_calls', async t => {
  const data = makeData({
    sessions: [
      {
        session_id: 'ag1', project_id: 'proj-a', slug: 'ag-sess',
        harness: 'antigravity',
        tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 },
        first_timestamp: '2026-05-01T10:00:00.000Z',
        last_timestamp:  '2026-05-01T10:30:00.000Z',
        date_str: '2026-05-01', tool_calls: 40, tool_errors: 0,
        tool_diversity: 3, message_count: 10, user_turns: 5, assistant_turns: 5,
        cache_hit_rate: 0, skills: [],
      },
      {
        session_id: 'ag2', project_id: 'proj-a', slug: 'ag-sess2',
        harness: 'antigravity',
        tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 },
        first_timestamp: '2026-05-02T10:00:00.000Z',
        last_timestamp:  '2026-05-02T10:30:00.000Z',
        date_str: '2026-05-02', tool_calls: 10, tool_errors: 0,
        tool_diversity: 2, message_count: 4, user_turns: 2, assistant_turns: 2,
        cache_hit_rate: 0, skills: [],
      },
    ],
  });
  const result = buildGraph(data, { referenceMs: new Date('2026-05-11T00:00:00.000Z').getTime() });

  await t.test('sizeNorm uses tool_calls when tokens_work is zero', () => {
    const big = result.nodes.find(n => n.id === 'ag1');
    const small = result.nodes.find(n => n.id === 'ag2');
    assert.ok(big.sizeNorm > small.sizeNorm);
    assert.equal(big.harness, 'antigravity');
  });

  await t.test('timeline tokens_work falls back to tool_calls', () => {
    const tl = result.timeline.find(e => e.id === 'ag1');
    assert.equal(tl.tokens_work, 40);
  });
});
