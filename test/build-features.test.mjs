import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMinSessions,
  buildFileNodesAndEdges,
  filterSessionsByDateRange,
  EXT_COLORS,
  filterVisibleGraph,
  EDGE_COLORS,
  GRAPH_BACKGROUND,
  FORCE_PARAMS_DEFAULTS,
  FORCE_PARAMS_BOUNDS,
  clampForceParam,
} from '../build.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

const REF_MS = new Date('2026-05-07T12:00:00Z').getTime();

const makeFile = (path, { read = 0, write = 0, edit = 0, sessions = [] } = {}) =>
  ({ path, read, write, edit, sessions });

const makeSess = (id, fileOps = {}, ts = '2026-05-06T10:00:00Z') => ({
  session_id: id,
  first_timestamp: ts,
  last_timestamp:  ts,
  file_ops: fileOps,
});

// ── parseMinSessions ──────────────────────────────────────────────────────────

test('parseMinSessions', async t => {
  await t.test('defaults to 1 (show all) when no --min-sessions arg', () => {
    assert.equal(parseMinSessions([]), 1);
  });
  await t.test('defaults to 1 with unrelated args', () => {
    assert.equal(parseMinSessions(['node', 'build.mjs', '--no-open']), 1);
  });
  await t.test('parses --min-sessions=3', () => {
    assert.equal(parseMinSessions(['--min-sessions=3']), 3);
  });
  await t.test('parses --min-sessions=1 explicitly', () => {
    assert.equal(parseMinSessions(['--min-sessions=1']), 1);
  });
  await t.test('uses first match when arg appears multiple times', () => {
    assert.equal(parseMinSessions(['--min-sessions=5', '--min-sessions=2']), 5);
  });
  await t.test('--min-sessions=0 parses to 0', () => {
    assert.equal(parseMinSessions(['--min-sessions=0']), 0);
  });
  await t.test('non-numeric value parses to NaN (all files pass the < NaN check)', () => {
    assert.ok(Number.isNaN(parseMinSessions(['--min-sessions=foo'])));
  });
});

// ── buildFileNodesAndEdges ────────────────────────────────────────────────────

test('buildFileNodesAndEdges — empty input', async t => {
  await t.test('returns empty nodes and edges for empty file list', () => {
    const { nodes, edges } = buildFileNodesAndEdges([], {}, { minSessions: 1, referenceMs: REF_MS });
    assert.deepEqual(nodes, []);
    assert.deepEqual(edges, []);
  });
});

test('buildFileNodesAndEdges — read-only file inclusion', async t => {
  const f = makeFile('src/foo.js', { read: 3, write: 0, edit: 0, sessions: ['s1'] });
  const sessById = { s1: makeSess('s1', { 'src/foo.js': { read: 3, write: 0, edit: 0 } }) };

  await t.test('includes read-only file node (write+edit=0)', () => {
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].id, 'src/foo.js');
    assert.equal(nodes[0].type, 'file');
  });

  await t.test('read-only file node carries correct read/write/edit counts', () => {
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].read,  3);
    assert.equal(nodes[0].write, 0);
    assert.equal(nodes[0].edit,  0);
  });

  await t.test('read-only file has sizeNorm 0 (no write/edit contribution)', () => {
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].sizeNorm, 0);
  });
});

test('buildFileNodesAndEdges — minSessions filter', async t => {
  await t.test('excludes file whose session count is below minSessions', () => {
    const f = makeFile('src/rare.js', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/rare.js': { read: 0, write: 1, edit: 0 } }) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 2, referenceMs: REF_MS });
    assert.equal(nodes.length, 0);
  });

  await t.test('includes file whose session count meets minSessions exactly', () => {
    const f = makeFile('src/common.js', { write: 2, sessions: ['s1', 's2'] });
    const sessById = {
      s1: makeSess('s1', { 'src/common.js': { read: 0, write: 1, edit: 0 } }),
      s2: makeSess('s2', { 'src/common.js': { read: 0, write: 1, edit: 0 } }),
    };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 2, referenceMs: REF_MS });
    assert.equal(nodes.length, 1);
  });

  await t.test('minSessions=1 includes single-session files (default behaviour)', () => {
    const f = makeFile('src/once.js', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/once.js': { read: 0, write: 1, edit: 0 } }) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes.length, 1);
  });
});

test('buildFileNodesAndEdges — sizeNorm', async t => {
  await t.test('file with maximum write+edit gets sizeNorm 1.0', () => {
    const f = makeFile('src/big.js', { write: 10, edit: 5, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/big.js': { read: 0, write: 10, edit: 5 } }) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].sizeNorm, 1.0);
  });

  await t.test('sizeNorm scales relative to max across all files', () => {
    const f1 = makeFile('src/big.js',   { write: 16, sessions: ['s1'] });
    const f2 = makeFile('src/small.js', { write: 4,  sessions: ['s1'] });
    const sessById = {
      s1: makeSess('s1', {
        'src/big.js':   { read: 0, write: 16, edit: 0 },
        'src/small.js': { read: 0, write: 4,  edit: 0 },
      }),
    };
    const { nodes } = buildFileNodesAndEdges([f1, f2], sessById, { minSessions: 1, referenceMs: REF_MS });
    const big   = nodes.find(n => n.id === 'src/big.js');
    const small = nodes.find(n => n.id === 'src/small.js');
    assert.equal(big.sizeNorm, 1.0);
    assert.ok(Math.abs(small.sizeNorm - 0.5) < 0.001, `expected ~0.5, got ${small.sizeNorm}`);
  });
});

test('buildFileNodesAndEdges — edge types', async t => {
  await t.test('write-only session emits exactly one write edge', () => {
    const f = makeFile('src/out.js', { write: 2, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/out.js': { read: 0, write: 2, edit: 0 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'write');
    assert.equal(edges[0].source, 's1');
    assert.equal(edges[0].target, 'src/out.js');
  });

  await t.test('edit-only session emits exactly one edit edge', () => {
    const f = makeFile('src/out.js', { edit: 3, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/out.js': { read: 0, write: 0, edit: 3 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'edit');
  });

  await t.test('read-only session emits exactly one read edge', () => {
    const f = makeFile('src/ro.js', { read: 2, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/ro.js': { read: 2, write: 0, edit: 0 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'read');
  });

  await t.test('each edge carries per-op weight, not total', () => {
    const f = makeFile('src/x.js', { read: 1, write: 2, edit: 3, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/x.js': { read: 1, write: 2, edit: 3 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    const byType = Object.fromEntries(edges.map(e => [e.type, e.weight]));
    assert.equal(byType.write, 2);
    assert.equal(byType.edit,  3);
    assert.equal(byType.read,  1);
  });

  await t.test('skips edge when session has no file_ops entry for this file', () => {
    const f = makeFile('src/x.js', { write: 1, sessions: ['s1', 's2'] });
    const sessById = {
      s1: makeSess('s1', { 'src/x.js': { read: 0, write: 1, edit: 0 } }),
      s2: makeSess('s2', {}),
    };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].source, 's1');
  });
});

test('buildFileNodesAndEdges — multi-op edges per session', async t => {
  await t.test('write+read session emits both a write and a read edge', () => {
    const f = makeFile('src/x.js', { read: 3, write: 2, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/x.js': { read: 3, write: 2, edit: 0 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 2);
    assert.deepEqual(edges.map(e => e.type).sort(), ['read', 'write']);
  });

  await t.test('edit+read session emits both an edit and a read edge', () => {
    const f = makeFile('src/x.js', { read: 2, edit: 4, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/x.js': { read: 2, write: 0, edit: 4 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 2);
    assert.deepEqual(edges.map(e => e.type).sort(), ['edit', 'read']);
  });

  await t.test('write+edit+read session emits three edges', () => {
    const f = makeFile('src/x.js', { read: 1, write: 2, edit: 3, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/x.js': { read: 1, write: 2, edit: 3 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 3);
    assert.deepEqual(edges.map(e => e.type).sort(), ['edit', 'read', 'write']);
  });

  // Shared fixture for the weight / source-target assertions below
  const triOpFile    = makeFile('src/x.js', { read: 1, write: 2, edit: 3, sessions: ['s1'] });
  const triOpSessById = { s1: makeSess('s1', { 'src/x.js': { read: 1, write: 2, edit: 3 } }) };
  const triOpEdges   = buildFileNodesAndEdges(
    [triOpFile], triOpSessById, { minSessions: 1, referenceMs: REF_MS }
  ).edges;

  await t.test('write edge weight equals write count only', () => {
    assert.equal(triOpEdges.find(e => e.type === 'write').weight, 2);
  });

  await t.test('edit edge weight equals edit count only', () => {
    assert.equal(triOpEdges.find(e => e.type === 'edit').weight, 3);
  });

  await t.test('read edge weight equals read count only', () => {
    assert.equal(triOpEdges.find(e => e.type === 'read').weight, 1);
  });

  await t.test('all edges share the same source and target', () => {
    assert.ok(triOpEdges.every(e => e.source === 's1' && e.target === 'src/x.js'));
  });
});

test('buildFileNodesAndEdges — node metadata', async t => {
  await t.test('label is the basename of the path', () => {
    const f = makeFile('src/deep/thing.ts', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/deep/thing.ts': { read: 0, write: 1, edit: 0 } }) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].label,     'thing.ts');
    assert.equal(nodes[0].full_path, 'src/deep/thing.ts');
  });

  await t.test('assigns EXT_COLORS color for known extension', () => {
    const f = makeFile('src/app.mjs', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/app.mjs': { read: 0, write: 1, edit: 0 } }) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].color, EXT_COLORS.mjs);
  });

  await t.test('uses fallback color #666666 for unknown extension', () => {
    const f = makeFile('src/file.xyz', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/file.xyz': { read: 0, write: 1, edit: 0 } }) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].color, '#666666');
  });

  await t.test('session_count matches the sessions array length', () => {
    const f = makeFile('src/shared.js', { write: 2, sessions: ['s1', 's2'] });
    const sessById = {
      s1: makeSess('s1', { 'src/shared.js': { read: 0, write: 1, edit: 0 } }),
      s2: makeSess('s2', { 'src/shared.js': { read: 0, write: 1, edit: 0 } }),
    };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].session_count, 2);
  });

  await t.test('node type is "file"', () => {
    const f = makeFile('src/app.js', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/app.js': { read: 0, write: 1, edit: 0 } }) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].type, 'file');
  });

  await t.test('ext field matches the file extension', () => {
    const f = makeFile('src/util.ts', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/util.ts': { read: 0, write: 1, edit: 0 } }) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].ext, 'ts');
  });
});

// ── recency fields ────────────────────────────────────────────────────────────

test('buildFileNodesAndEdges — recency fields', async t => {
  // REF_MS = 2026-05-07T12:00:00Z
  // session ts 5 min before ref → recencyLevel 2 (< 15 min, >= 5 min)
  const RECENT_TS = '2026-05-07T11:55:00Z';

  await t.test('last_activity is the max session timestamp linked to the file', () => {
    const f = makeFile('src/hot.js', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/hot.js': { read: 0, write: 1, edit: 0 } }, RECENT_TS) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].last_activity, RECENT_TS);
  });

  await t.test('recency is > 0 for a recently-touched file', () => {
    const f = makeFile('src/hot.js', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/hot.js': { read: 0, write: 1, edit: 0 } }, RECENT_TS) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.ok(nodes[0].recency > 0, `expected recency > 0, got ${nodes[0].recency}`);
  });

  await t.test('recencyLevel is 2 for a file touched 5 min before reference', () => {
    const f = makeFile('src/hot.js', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/hot.js': { read: 0, write: 1, edit: 0 } }, RECENT_TS) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].recencyLevel, 2);
  });

  await t.test('recency is 0 for a stale file (session timestamp far in the past)', () => {
    const OLD_TS = '2026-01-01T00:00:00Z';
    const f = makeFile('src/old.js', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/old.js': { read: 0, write: 1, edit: 0 } }, OLD_TS) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].recency, 0);
  });
  await t.test('recencyLevel is 0 for a stale file (session timestamp far in the past)', () => {
    const OLD_TS = '2026-01-01T00:00:00Z';
    const f = makeFile('src/old.js', { write: 1, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/old.js': { read: 0, write: 1, edit: 0 } }, OLD_TS) };
    const { nodes } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(nodes[0].recencyLevel, 0);
  });
});

// ── filterSessionsByDateRange ─────────────────────────────────────────────────

test('filterSessionsByDateRange', async t => {
  const sessions = [
    { session_id: 'jan', first_timestamp: '2026-01-01T00:00:00Z' },
    { session_id: 'mar', first_timestamp: '2026-03-15T12:00:00Z' },
    { session_id: 'may', first_timestamp: '2026-05-07T00:00:00Z' },
    { session_id: 'nil', first_timestamp: null },
  ];

  await t.test('returns all sessions when both bounds are null', () => {
    assert.equal(filterSessionsByDateRange(sessions, null, null).length, 4);
  });

  await t.test('returns all sessions when called with no bounds', () => {
    assert.equal(filterSessionsByDateRange(sessions).length, 4);
  });

  await t.test('excludes sessions before fromTs', () => {
    const result = filterSessionsByDateRange(sessions, '2026-03-01T00:00:00Z', null);
    const ids = result.map(s => s.session_id);
    assert.ok(!ids.includes('jan'), 'Jan should be excluded');
    assert.ok( ids.includes('mar'), 'Mar should be included');
    assert.ok( ids.includes('may'), 'May should be included');
  });

  await t.test('excludes sessions after toTs', () => {
    const result = filterSessionsByDateRange(sessions, null, '2026-04-01T00:00:00Z');
    const ids = result.map(s => s.session_id);
    assert.ok( ids.includes('jan'), 'Jan should be included');
    assert.ok( ids.includes('mar'), 'Mar should be included');
    assert.ok(!ids.includes('may'), 'May should be excluded');
  });

  await t.test('always keeps sessions with null timestamp regardless of bounds', () => {
    const result = filterSessionsByDateRange(sessions, '2026-04-01T00:00:00Z', '2026-04-30T00:00:00Z');
    assert.ok(result.map(s => s.session_id).includes('nil'));
  });

  await t.test('boundary: session exactly at fromTs is included', () => {
    const result = filterSessionsByDateRange(sessions, '2026-01-01T00:00:00Z', null);
    assert.ok(result.map(s => s.session_id).includes('jan'));
  });

  await t.test('boundary: session exactly at toTs is included', () => {
    const result = filterSessionsByDateRange(sessions, null, '2026-05-07T00:00:00Z');
    assert.ok(result.map(s => s.session_id).includes('may'));
  });

  await t.test('applies both bounds simultaneously', () => {
    const result = filterSessionsByDateRange(sessions, '2026-02-01T00:00:00Z', '2026-04-01T00:00:00Z');
    const ids = result.map(s => s.session_id);
    assert.ok(!ids.includes('jan'), 'Jan out');
    assert.ok( ids.includes('mar'), 'Mar in');
    assert.ok(!ids.includes('may'), 'May out');
    assert.ok( ids.includes('nil'), 'null-ts in');
  });

  await t.test('returns only null-ts sessions when range has no matches', () => {
    const result = filterSessionsByDateRange(sessions, '2027-01-01T00:00:00Z', null);
    assert.deepEqual(result.map(s => s.session_id), ['nil']);
  });

  await t.test('does not mutate the input array', () => {
    const copy = [...sessions];
    filterSessionsByDateRange(sessions, '2026-03-01T00:00:00Z', null);
    assert.equal(sessions.length, copy.length);
  });
});

// ── filterVisibleGraph ────────────────────────────────────────────────────────

test('filterVisibleGraph', async t => {
  const nodes = [
    { id: 'p1', type: 'project' },
    { id: 's1', type: 'session' },
    { id: 's2', type: 'session' },
    { id: 'f1', type: 'file'    },
  ];
  const edges = [
    { source: 's1', target: 'p1', type: 'membership' },
    { source: 's2', target: 'p1', type: 'membership' },
    { source: 's1', target: 'f1', type: 'write', weight: 2 },
    { source: 's2', target: 'f1', type: 'edit',  weight: 1 },
  ];

  await t.test('returns full graph when hidden set is empty', () => {
    const { nodes: n, edges: e } = filterVisibleGraph(nodes, edges, []);
    assert.equal(n.length, 4);
    assert.equal(e.length, 4);
  });

  await t.test('excludes the hidden node', () => {
    const { nodes: n } = filterVisibleGraph(nodes, edges, ['s1']);
    assert.equal(n.length, 3);
    assert.ok(!n.find(x => x.id === 's1'));
  });

  await t.test('preserves non-hidden nodes', () => {
    const { nodes: n } = filterVisibleGraph(nodes, edges, ['s1']);
    assert.ok(n.find(x => x.id === 's2'));
    assert.ok(n.find(x => x.id === 'p1'));
    assert.ok(n.find(x => x.id === 'f1'));
  });

  await t.test('removes edges connected to hidden node', () => {
    const { edges: e } = filterVisibleGraph(nodes, edges, ['s1']);
    assert.equal(e.length, 2);
    assert.ok(!e.find(x => (x.source?.id ?? x.source) === 's1' || (x.target?.id ?? x.target) === 's1'));
  });

  await t.test('keeps edges unconnected to hidden node', () => {
    const { edges: e } = filterVisibleGraph(nodes, edges, ['s1']);
    assert.ok(e.find(x => (x.source?.id ?? x.source) === 's2'));
  });

  await t.test('handles D3-mutated edges where source/target are node objects', () => {
    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
    const mutated = edges.map(e => ({ ...e, source: nodeMap[e.source], target: nodeMap[e.target] }));
    const { edges: e } = filterVisibleGraph(nodes, mutated, ['s1']);
    assert.equal(e.length, 2);
    assert.ok(!e.find(x => (x.source?.id ?? x.source) === 's1'));
  });

  await t.test('hiding a project removes its membership edges', () => {
    const { edges: e } = filterVisibleGraph(nodes, edges, ['p1']);
    assert.ok(!e.find(x => x.type === 'membership'));
    assert.equal(e.filter(x => x.type === 'write' || x.type === 'edit').length, 2);
  });

  await t.test('empty hidden set returns same node count', () => {
    const { nodes: n } = filterVisibleGraph(nodes, edges, []);
    assert.equal(n.length, nodes.length);
  });

  await t.test('does not mutate the input arrays', () => {
    filterVisibleGraph(nodes, edges, ['s1']);
    assert.equal(nodes.length, 4);
    assert.equal(edges.length, 4);
  });
});

// ── EDGE_COLORS contrast ──────────────────────────────────────────────────────

// WCAG relative luminance + contrast ratio helpers
function hexLum(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const lin = c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4;
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
}
function contrastRatio(a, b) {
  const l1 = hexLum(a), l2 = hexLum(b);
  return (Math.max(l1,l2)+0.05) / (Math.min(l1,l2)+0.05);
}

test('EDGE_COLORS', async t => {
  await t.test('exports an object with all five edge types', () => {
    assert.ok(typeof EDGE_COLORS === 'object');
    for (const k of ['membership','write','edit','read','branch'])
      assert.ok(k in EDGE_COLORS, `missing key: ${k}`);
  });

  await t.test('membership color meets minimum contrast (≥1.5) against GRAPH_BACKGROUND', () => {
    const ratio = contrastRatio(EDGE_COLORS.membership, GRAPH_BACKGROUND);
    assert.ok(ratio >= 1.5, `membership contrast ${ratio.toFixed(2)} < 1.5 — too close to background`);
  });

  await t.test('write color is clearly visible (contrast ≥5) against background', () => {
    const ratio = contrastRatio(EDGE_COLORS.write, GRAPH_BACKGROUND);
    assert.ok(ratio >= 5, `write contrast ${ratio.toFixed(2)} < 5`);
  });

  await t.test('edit color is clearly visible (contrast ≥5) against background', () => {
    const ratio = contrastRatio(EDGE_COLORS.edit, GRAPH_BACKGROUND);
    assert.ok(ratio >= 5, `edit contrast ${ratio.toFixed(2)} < 5`);
  });

  await t.test('GRAPH_BACKGROUND matches body background color', () => {
    assert.equal(GRAPH_BACKGROUND, '#080810');
  });
});

// ── FORCE_PARAMS ──────────────────────────────────────────────────────────────

test('FORCE_PARAMS_DEFAULTS', async t => {
  const REQUIRED = ['sessionCharge','fileCharge','projectCharge','membershipDist','branchDist','fileDist','velocityDecay'];

  await t.test('exports an object with all required keys', () => {
    assert.ok(typeof FORCE_PARAMS_DEFAULTS === 'object');
    for (const k of REQUIRED)
      assert.ok(k in FORCE_PARAMS_DEFAULTS, `missing key: ${k}`);
  });

  await t.test('all defaults are numbers', () => {
    for (const [k,v] of Object.entries(FORCE_PARAMS_DEFAULTS))
      assert.equal(typeof v, 'number', `${k} is not a number`);
  });

  await t.test('all defaults are within their stated bounds', () => {
    assert.ok(typeof FORCE_PARAMS_BOUNDS === 'object');
    for (const k of REQUIRED) {
      const v = FORCE_PARAMS_DEFAULTS[k];
      const b = FORCE_PARAMS_BOUNDS[k];
      assert.ok(b, `no bounds entry for ${k}`);
      assert.ok(v >= b.min && v <= b.max,
        `default ${k}=${v} outside bounds [${b.min}, ${b.max}]`);
    }
  });

  await t.test('charge values are negative (repulsive)', () => {
    assert.ok(FORCE_PARAMS_DEFAULTS.sessionCharge < 0);
    assert.ok(FORCE_PARAMS_DEFAULTS.fileCharge    < 0);
    assert.ok(FORCE_PARAMS_DEFAULTS.projectCharge < 0);
  });

  await t.test('distance values are positive', () => {
    assert.ok(FORCE_PARAMS_DEFAULTS.membershipDist > 0);
    assert.ok(FORCE_PARAMS_DEFAULTS.branchDist     > 0);
    assert.ok(FORCE_PARAMS_DEFAULTS.fileDist       > 0);
  });

  await t.test('velocityDecay is between 0 and 1', () => {
    const v = FORCE_PARAMS_DEFAULTS.velocityDecay;
    assert.ok(v > 0 && v < 1, `velocityDecay=${v} not in (0,1)`);
  });
});

test('clampForceParam', async t => {
  await t.test('returns value unchanged when within bounds', () => {
    assert.equal(clampForceParam('sessionCharge', -130), -130);
    assert.equal(clampForceParam('velocityDecay', 0.38), 0.38);
  });

  await t.test('clamps to min when below lower bound', () => {
    const min = FORCE_PARAMS_BOUNDS.sessionCharge.min;
    assert.equal(clampForceParam('sessionCharge', min - 100), min);
  });

  await t.test('clamps to max when above upper bound', () => {
    const max = FORCE_PARAMS_BOUNDS.membershipDist.max;
    assert.equal(clampForceParam('membershipDist', max + 50), max);
  });

  await t.test('returns value unchanged for unknown key', () => {
    assert.equal(clampForceParam('unknownKey', 42), 42);
  });

  await t.test('clamps velocityDecay to max', () => {
    const max = FORCE_PARAMS_BOUNDS.velocityDecay.max;
    assert.equal(clampForceParam('velocityDecay', 1.5), max);
  });
});
