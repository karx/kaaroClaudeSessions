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
  fileBaseName, workingSetForProject,
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

test('harnessWedges — weighted grok wedge is 2π/11 not π (kaaroBrain shape)', () => {
  const eq = harnessWedges(['grok', 'pi'], 20);
  const wt = harnessWedges(['grok', 'pi'], 20, { pi: 10, grok: 1 });
  assert.notEqual(wt[0].d, eq[0].d);
  assert.ok(wt[0].d.startsWith('M'));
});

