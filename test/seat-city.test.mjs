/**
 * test/seat-city.test.mjs → Seat City lattice tiles (force/canvas rework).
 *
 * Project seats live on the hex lattice. Sessions stack in depth (not a
 * top-down pancake). Tools are the scaffold: wall stripes + file pipes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GLYPH_GRAPH_R, glyphCellPitch, mergeGlyphPlacements, HARNESS_MARK, hexPath,
  TOOL_COLORS,
  seatFootprintR, seatSlabHeight, sliceSeatSlabs, buildSeatCity,
  seatTileMarkup, seatForceConfig, seatLayoutHides, isSeatLayout,
  seatOblique, seatSessionDepth, seatSlabHeights, seatScaffoldForProject,
  SEAT_SLAB_CAP, SEAT_HEX_MIN_FRAC, SEAT_HEX_MAX_FRAC, SEAT_SCAFFOLD_CAP,
} from '../experience/client-core.mjs';

test('isSeatLayout — lattice (grid) is the Seat City canvas; Force is forensic', () => {
  assert.equal(isSeatLayout('grid'), true);
  assert.equal(isSeatLayout('force'), false);
  assert.equal(isSeatLayout('swimlane'), false);
});

test('seatLayoutHides — satellites leave the seat canvas; files are visible scaffold', () => {
  assert.equal(seatLayoutHides('session'), true);
  assert.equal(seatLayoutHides('cluster'), true);
  assert.equal(seatLayoutHides('subagent'), true);
  assert.equal(seatLayoutHides('project'), false);
  assert.equal(seatLayoutHides('file'), false);
});

test('seatForceConfig — seats pin; files stay as plumbing; no orbiting sessions', () => {
  const cfg = seatForceConfig();
  assert.equal(cfg.pinProjects, true);
  assert.equal(cfg.link, false);
  assert.equal(cfg.charge, false);
  assert.equal(cfg.includeSessions, false);
  assert.equal(cfg.includeFiles, true);
  assert.equal(cfg.includeClusters, false);
  assert.equal(cfg.collide, true);
});

test('seatOblique — cabinet shear: z lifts toward -y and +x', () => {
  const p = seatOblique(10, 20, 8);
  assert.ok(p.x > 10);
  assert.equal(p.y, 12);
  const q = seatOblique(0, 0, 0);
  assert.equal(q.x, 0);
  assert.equal(q.y, 0);
});

test('seatSessionDepth — fat consumption and extra context floors read taller', () => {
  const thin = seatSessionDepth({ sizeNorm: 0.1, context_resets: 0 }, 1);
  const fat = seatSessionDepth({ sizeNorm: 1, context_resets: 0 }, 1);
  const deep = seatSessionDepth({ sizeNorm: 0.1, context_resets: 3 }, 1);
  assert.ok(fat > thin);
  assert.ok(deep > thin);
});

test('seatSlabHeights — two sessions with different depth do not share one pancake', () => {
  const slabs = [
    { sizeNorm: 0.1, context_resets: 0 },
    { sizeNorm: 1, context_resets: 2 },
  ];
  const { heights, rise } = seatSlabHeights(slabs, 4);
  assert.equal(heights.length, 2);
  assert.ok(heights[1] > heights[0], 'deeper session owns more of the stack');
  assert.ok(Math.abs(heights[0] + heights[1] - rise) < 1e-9);
});

test('seatFootprintR — empty 0.36 cell, full 0.50 cell; tokens not session count', () => {
  assert.equal(GLYPH_GRAPH_R, 68);
  assert.equal(seatFootprintR(68, 0), SEAT_HEX_MIN_FRAC * 68);
  assert.equal(seatFootprintR(68, 1), SEAT_HEX_MAX_FRAC * 68);
  assert.ok(seatFootprintR(68, 1) < 68, 'tile sits inside its lattice cell');
  assert.ok(seatFootprintR(68, 0.9) > seatFootprintR(68, 0.2));
});

test('seatSlabHeight — full cap stack stays under half the row pitch', () => {
  const { dy } = glyphCellPitch(68);
  const h = seatSlabHeight(68);
  assert.ok(h > 0);
  assert.ok(h * SEAT_SLAB_CAP <= dy * 0.5 + 1e-9);
});

test('sliceSeatSlabs — newest cap visible; overflow is older work under the window', () => {
  const slabs = Array.from({ length: 21 }, (_, i) => ({ i }));
  const { shown, overflow } = sliceSeatSlabs(slabs, 12);
  assert.equal(shown.length, 12);
  assert.equal(overflow, 9);
  assert.equal(shown[0].i, 9);
  assert.equal(shown[11].i, 20);
  const small = sliceSeatSlabs(slabs.slice(0, 4), 12);
  assert.equal(small.overflow, 0);
  assert.equal(small.shown.length, 4);
});

test('buildSeatCity — lattice seats, stacked sessions, harness colour, footprint = sizeNorm', () => {
  const projects = [
    { id: 'z', label: 'zeta', color: '#111', harnesses: ['pi'], sizeNorm: 0.2, tokens_total: 10, session_count: 1 },
    { id: 'a', label: 'viewer', color: '#222', harnesses: ['pi'], sizeNorm: 0.9, tokens_total: 1000, session_count: 5 },
    { id: 'm', label: 'mid', color: '#333', harnesses: ['grok', 'pi'], sizeNorm: 0.4, tokens_total: 100, session_count: 3 },
  ];
  const sessions = [
    { id: 'm1', project_id: 'm', harness: 'pi', first_timestamp: '2026-01-01', tool_calls: 2 },
    { id: 'm2', project_id: 'm', harness: 'pi', first_timestamp: '2026-01-02', tool_calls: 2 },
    { id: 'm3', project_id: 'm', harness: 'grok', first_timestamp: '2026-02-01', tool_calls: 1 },
    { id: 'z1', project_id: 'z', harness: 'pi', first_timestamp: '2026-01-01', tool_calls: 4 },
    { id: 'a1', project_id: 'a', harness: 'pi', first_timestamp: '2026-03-01', tokens_total: 800 },
  ];
  const city = buildSeatCity({
    projects, sessions,
    placements: { a: { col: 2, row: 1 } },
  });
  assert.equal(city.kind, 'seats');
  assert.deepEqual(city.buildings.map(b => b.id), ['a', 'm', 'z']);
  assert.deepEqual(city.placements.a, { col: 2, row: 1 });
  const radial = mergeGlyphPlacements(['a', 'm', 'z'], { a: { col: 2, row: 1 } });
  assert.deepEqual(city.placements.m, radial.m);
  assert.deepEqual(city.placements.z, radial.z);

  const viewer = city.buildings.find(b => b.id === 'a');
  const mid = city.buildings.find(b => b.id === 'm');
  assert.equal(viewer.footprint, viewer.sizeNorm);
  assert.ok(viewer.sizeNorm > mid.sizeNorm, 'footprint follows consumption, not session count');
  assert.equal(mid.weights.pi, 2);
  assert.equal(mid.weights.grok, 1);
  assert.equal(mid.slabs[0].harness, 'pi');
  assert.equal(mid.slabs[2].harness, 'grok');
  assert.equal(mid.slabs[2].color, HARNESS_MARK.grok);
  assert.equal(mid.tool_calls, 5);
  assert.ok(mid.slabs[2].depth > 0);
  assert.equal(typeof localStorage, 'undefined');
});

test('seatScaffoldForProject — write/edit/read pipes, cap, drop membership', () => {
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
  const files = [{ id: '/a.mjs', label: 'a.mjs', color: '#00cccc', sizeNorm: 0.4 }];
  const a = seatScaffoldForProject('pA', { sessions, files, edges, cap: 8 });
  const b = seatScaffoldForProject('pB', { sessions, files, edges, cap: 8 });
  assert.equal(a.find(f => f.path === '/a.mjs').write, 10);
  assert.equal(b.find(f => f.path === '/a.mjs').write, 1);
  assert.ok(a.some(f => f.path === '/only-read.ts'), 'read is a tool — keep it as plumbing');
  assert.ok(!a.some(f => f.path === '/glob-miss'));
  assert.equal(a.find(f => f.path === '/a.mjs').color, '#00cccc');
  const many = Array.from({ length: 12 }, (_, i) => ({
    source: 'sA', target: `/f${i}.js`, type: 'write', weight: 12 - i,
  }));
  const capped = seatScaffoldForProject('pA', { sessions, edges: many, cap: SEAT_SCAFFOLD_CAP });
  assert.equal(capped.length, SEAT_SCAFFOLD_CAP);
});

test('buildSeatCity — slabs carry tools_top and scaffold file ids', () => {
  const projects = [{ id: 'p', label: 'p', color: '#222', sizeNorm: 0.5, tokens_total: 9 }];
  const sessions = [{
    id: 's1', project_id: 'p', harness: 'pi', first_timestamp: '2026-01-01',
    tool_calls: 4, sizeNorm: 0.4, context_resets: 1,
    tools_top: [{ name: 'Write', calls: 3 }, { name: 'Read', calls: 1 }],
  }];
  const files = [{ id: '/x.mjs', label: 'x.mjs', color: '#00cccc', sizeNorm: 0.2 }];
  const edges = [{ source: 's1', target: '/x.mjs', type: 'write', weight: 3 }];
  const city = buildSeatCity({ projects, sessions, files, edges });
  assert.deepEqual(city.buildings[0].slabs[0].tools_top[0], { name: 'Write', calls: 3 });
  assert.equal(city.buildings[0].slabs[0].context_resets, 1);
  assert.ok(city.scaffoldFileIds.includes('/x.mjs'));
  assert.equal(city.buildings[0].scaffold[0].path, '/x.mjs');
});

test('seatTileMarkup — oblique walls, harness roof, tool stripe, no chrome', () => {
  const building = {
    id: 'x', color: '#cc4488',
    slabs: [
      {
        harness: 'pi', color: HARNESS_MARK.pi, sizeNorm: 0.2, context_resets: 0,
        tools_top: [{ name: 'Write', calls: 2 }],
      },
      {
        harness: 'grok', color: HARNESS_MARK.grok, sizeNorm: 1, context_resets: 2,
        tools_top: [{ name: 'Edit', calls: 1 }],
      },
    ],
  };
  const svg = seatTileMarkup(building, { r: 20, unit: 4 });
  assert.ok(!svg.includes('<rect'));
  assert.ok(!svg.includes('filter='));
  assert.ok(!svg.includes('rx='));
  assert.ok(!svg.includes('translate(0, 0.00)'), 'top-down pancakes are gone');
  assert.ok(svg.includes(HARNESS_MARK.pi));
  assert.ok(svg.includes(HARNESS_MARK.grok));
  assert.ok(svg.includes(TOOL_COLORS.Write));
  assert.ok(svg.includes(TOOL_COLORS.Edit));
  const empty = seatTileMarkup({ id: 'e', color: '#888', slabs: [] }, { r: 16, unit: 4, bg: '#000000' });
  assert.ok(empty.includes(hexPath(16)));
  assert.ok(empty.includes('#000000'));
});
