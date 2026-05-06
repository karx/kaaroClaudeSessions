import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMinSessions,
  buildFileNodesAndEdges,
  filterSessionsByDateRange,
  EXT_COLORS,
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
});

// ── buildFileNodesAndEdges ────────────────────────────────────────────────────

test('buildFileNodesAndEdges — empty input', async t => {
  await t.test('returns empty nodes and edges for empty file list', () => {
    const { nodes, edges } = buildFileNodesAndEdges([], {}, { minSessions: 1, referenceMs: REF_MS });
    assert.deepEqual(nodes, []);
    assert.deepEqual(edges, []);
  });
});

test('buildFileNodesAndEdges — read-only file inclusion (key new behaviour)', async t => {
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
  await t.test('emits write edge when session wrote the file', () => {
    const f = makeFile('src/out.js', { write: 2, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/out.js': { read: 0, write: 2, edit: 0 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, 'write');
    assert.equal(edges[0].source, 's1');
    assert.equal(edges[0].target, 'src/out.js');
  });

  await t.test('emits edit edge when session edited but did not write', () => {
    const f = makeFile('src/out.js', { edit: 3, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/out.js': { read: 0, write: 0, edit: 3 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges[0].type, 'edit');
  });

  await t.test('emits read edge for a read-only session interaction', () => {
    const f = makeFile('src/ro.js', { read: 2, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/ro.js': { read: 2, write: 0, edit: 0 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges[0].type, 'read');
  });

  await t.test('edge weight equals total ops (write+edit+read)', () => {
    const f = makeFile('src/x.js', { read: 1, write: 2, edit: 3, sessions: ['s1'] });
    const sessById = { s1: makeSess('s1', { 'src/x.js': { read: 1, write: 2, edit: 3 } }) };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges[0].weight, 6);
  });

  await t.test('skips edge when session has no file_ops entry for this file', () => {
    const f = makeFile('src/x.js', { write: 1, sessions: ['s1', 's2'] });
    const sessById = {
      s1: makeSess('s1', { 'src/x.js': { read: 0, write: 1, edit: 0 } }),
      s2: makeSess('s2', {}), // no entry for src/x.js
    };
    const { edges } = buildFileNodesAndEdges([f], sessById, { minSessions: 1, referenceMs: REF_MS });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].source, 's1');
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
