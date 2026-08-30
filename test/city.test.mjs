/**
 * test/city.test.mjs → city helper + isometric geometry (RFC-project-city.md)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isoProject, isoHexPts, hexRFromCellR, citySlabMetrics, citySlabSlice,
  roofNeighbourClearance, CITY_VISIBLE_FACES, CITY_SLAB_CAP,
  CITY_HEX_R_MIN_FRAC, CITY_HEX_R_MAX_FRAC, CITY_FIT_CELL_R_MAX,
  GLYPH_GRAPH_R, glyphCellPitch, HARNESS_MARK, harnessWedges,
  fileBaseName, workingSetForProject, buildCityData, mergeGlyphPlacements,
} from '../experience/client-core.mjs';

const COS30 = Math.sqrt(3) / 2;
const atol = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('isoProject — 30° isometric fixtures (RFC G.3)', () => {
  const a = isoProject(1, 0, 0);
  assert.ok(atol(a.x, COS30));
  assert.ok(atol(a.y, 0.5));
  const b = isoProject(0, 1, 0);
  assert.ok(atol(b.x, -COS30));
  assert.ok(atol(b.y, 0.5));
  const c = isoProject(0, 0, 1);
  assert.equal(c.x, 0);
  assert.equal(c.y, -1);
});

test('isoProject — worked E wall [1,2] at r=20 slabH=4', () => {
  const p = [
    isoProject(17.320508, -10, 0),
    isoProject(17.320508, 10, 0),
    isoProject(17.320508, 10, 4),
    isoProject(17.320508, -10, 4),
  ];
  const round3 = n => Math.round(n * 1000) / 1000;
  assert.deepEqual(p.map(q => [round3(q.x), round3(q.y)]), [
    [23.66, 3.66],
    [6.34, 13.66],
    [6.34, 9.66],
    [23.66, -0.34],
  ]);
});

test('CITY_VISIBLE_FACES centroid iso y is non-decreasing (SW, E, SE)', () => {
  const r = 20, zMid = 2;
  const verts = [];
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3;
    verts.push([r * Math.sin(a), -r * Math.cos(a)]);
  }
  const ys = CITY_VISIBLE_FACES.map(([i, j]) => {
    const mx = (verts[i][0] + verts[j][0]) / 2;
    const my = (verts[i][1] + verts[j][1]) / 2;
    return isoProject(mx, my, zMid).y;
  });
  assert.deepEqual(CITY_VISIBLE_FACES, [[3, 4], [1, 2], [2, 3]]);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1], `y[${i}] >= y[${i - 1}]`);
});

test('hexRFromCellR — 0.42 empty, 0.55 full, cellR=68', () => {
  assert.equal(hexRFromCellR(68, 0), 0.42 * 68);
  assert.equal(hexRFromCellR(68, 1), 0.55 * 68);
  assert.equal(CITY_HEX_R_MIN_FRAC, 0.42);
  assert.equal(CITY_HEX_R_MAX_FRAC, 0.55);
  assert.equal(GLYPH_GRAPH_R, 68);
});

test('citySlabMetrics — stack locks to dy; roofNeighbourClearance at 68', () => {
  const m102 = citySlabMetrics(102);
  assert.ok(m102.stack <= 51);
  assert.equal(m102.slabH, m102.stack / CITY_SLAB_CAP);
  const m16 = citySlabMetrics(16);
  assert.ok(m16.stack <= 8);
  const { dx, dy } = glyphCellPitch(68);
  assert.equal(dy, 102);
  const clr = roofNeighbourClearance(68);
  assert.equal(clr.ok, true);
  assert.ok(clr.dist >= 2 * hexRFromCellR(68, 1));
  assert.ok(dx > 0);
});

test('citySlabSlice — 21 sessions, cap 12 → 11 oldest + newest + overflow 9', () => {
  const slabs = Array.from({ length: 21 }, (_, i) => ({ i }));
  const { shown, overflow, seam } = citySlabSlice(slabs, 12);
  assert.equal(shown.length, 12);
  assert.equal(overflow, 9);
  assert.equal(seam, true);
  assert.equal(shown[0].i, 0);
  assert.equal(shown[11].i, 20);
  const small = citySlabSlice(slabs.slice(0, 5), 12);
  assert.equal(small.overflow, 0);
  assert.equal(small.seam, false);
  assert.equal(small.shown.length, 5);
});

test('isoHexPts length 6', () => {
  assert.equal(isoHexPts(20, 0).length, 6);
  assert.ok(HARNESS_MARK.pi);
  assert.equal(CITY_FIT_CELL_R_MAX, 36);
});

test('fileBaseName — Windows and POSIX', () => {
  assert.equal(fileBaseName('C:\\foo\\bar.mjs'), 'bar.mjs');
  assert.equal(fileBaseName('/src/kaaro/x.js'), 'x.js');
  assert.equal(fileBaseName(''), '');
});

test('workingSetForProject — e.weight, D3 unwrap, drop read-only, cap 6', () => {
  const sessions = [
    { id: 'sA', project_id: 'pA' },
    { id: 'sB', project_id: 'pB' },
  ];
  const edges = [
    { source: 'sA', target: '/a.mjs', type: 'write', weight: 10 },
    { source: { id: 'sB' }, target: { id: '/a.mjs' }, type: 'write', weight: 1 },
    { source: 'sA', target: '/only-read.ts', type: 'read', weight: 9 },
    { source: 'sA', target: '/b.js', type: 'edit', weight: 3 },
    { source: 'sA', target: '/glob-miss', type: 'membership', weight: 99 },
  ];
  const files = [{ id: '/a.mjs', label: 'a.mjs', color: '#00cccc' }];
  const a = workingSetForProject('pA', { sessions, files, edges, cap: 6 });
  const b = workingSetForProject('pB', { sessions, files, edges, cap: 6 });
  assert.equal(a.find(f => f.path === '/a.mjs').write, 10);
  assert.equal(b.find(f => f.path === '/a.mjs').write, 1);
  assert.ok(!a.some(f => f.path === '/only-read.ts'));
  assert.ok(!a.some(f => f.path === '/glob-miss'));
  assert.equal(a.find(f => f.path === '/a.mjs').color, '#00cccc');
  assert.equal(a.find(f => f.path === '/b.js').name, 'b.js');
  const many = Array.from({ length: 8 }, (_, i) => ({
    source: 'sA', target: `/f${i}.js`, type: 'write', weight: 8 - i,
  }));
  const capped = workingSetForProject('pA', {
    sessions, edges: many, cap: 6,
  });
  assert.equal(capped.length, 6);
  const maxWe = Math.max(...capped.map(f => f.write + f.edit));
  assert.equal(maxWe, 8);
});

test('buildCityData — seats id-asc, uncapped, weights, oldest slabs, no localStorage', () => {
  const projects = [
    { id: 'z', label: 'zeta', color: '#111', harnesses: ['pi'], sizeNorm: 0.2, tokens_total: 10, tokens_work: 3, session_count: 1 },
    { id: 'a', label: 'Users-arshigoyal-kaaro-src-kaaroViewer', color: '#222', harnesses: ['pi'], sizeNorm: 0.9, tokens_total: 1000, tokens_work: 50, session_count: 21 },
    { id: 'm', label: 'mid', color: '#333', harnesses: ['grok', 'pi'], sizeNorm: 0.4, tokens_total: 100, tokens_work: 9, session_count: 11 },
  ];
  const sessions = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: 'mb' + i, project_id: 'm', harness: 'pi', first_timestamp: `2026-01-${String(i + 1).padStart(2, '0')}`,
    })),
    { id: 'mg', project_id: 'm', harness: 'grok', first_timestamp: '2026-02-01' },
    { id: 'z1', project_id: 'z', harness: 'pi', first_timestamp: '2026-01-01', tool_calls: 2 },
    ...Array.from({ length: 21 }, (_, i) => ({
      id: 'v' + i, project_id: 'a', harness: 'pi', first_timestamp: `2026-03-${String(i + 1).padStart(2, '0')}`,
    })),
  ];
  const city = buildCityData({
    projects, sessions,
    placements: { a: { col: 2, row: 1 } },
  });
  assert.equal(city.kind, 'city');
  assert.equal(city.buildings.length, 3);
  assert.deepEqual(city.buildings.map(b => b.id), ['a', 'm', 'z']);
  assert.deepEqual(city.placements.a, { col: 2, row: 1 });
  const radial = mergeGlyphPlacements(['a', 'm', 'z'], { a: { col: 2, row: 1 } });
  assert.deepEqual(city.placements.m, radial.m);
  assert.deepEqual(city.placements.z, radial.z);

  const unsorted = buildCityData({ projects: [projects[0], projects[1], projects[2]], sessions, placements: null });
  const sortedSeats = mergeGlyphPlacements(['a', 'm', 'z'], null);
  assert.deepEqual(unsorted.placements, sortedSeats);

  const many = Array.from({ length: 61 }, (_, i) => ({
    id: 'p' + String(i).padStart(2, '0'), label: 'p' + i, sizeNorm: 0.1, tokens_total: i, session_count: 1,
  }));
  assert.equal(buildCityData({ projects: many }).buildings.length, 61);

  const viewer = city.buildings.find(b => b.id === 'a');
  const mid = city.buildings.find(b => b.id === 'm');
  assert.equal(viewer.footprint, viewer.sizeNorm);
  assert.ok(viewer.sizeNorm > mid.sizeNorm, 'fat tokens, not session count, drive footprint');
  assert.equal(viewer.tokens_work, 50);
  assert.equal(viewer.shortLabel, 'kaaroViewer');
  assert.equal(mid.weights.pi, 10);
  assert.equal(mid.weights.grok, 1);
  assert.equal(mid.slabs[0].harness, 'pi');
  assert.equal(mid.slabs[10].harness, 'grok');
  assert.equal(viewer.slabs.length, 21);
  assert.equal(viewer.overflowSlabs, 9);
  assert.equal(city.labeledIds[0], 'a');
  assert.equal(typeof localStorage, 'undefined');
});

test('harnessWedges — weighted grok wedge is 2π/11 not π (kaaroBrain shape)', () => {
  const eq = harnessWedges(['grok', 'pi'], 20);
  const wt = harnessWedges(['grok', 'pi'], 20, { pi: 10, grok: 1 });
  assert.notEqual(wt[0].d, eq[0].d);
  assert.ok(wt[0].d.startsWith('M'));
});

