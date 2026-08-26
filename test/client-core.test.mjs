/**
 * test/client-core.test.mjs → experience/client-core.mjs
 *
 * The shared browser core: formatters, colors, geometry, SSE wiring.
 * Node-tested ESM; build.mjs strips `export ` and injects it into every
 * page bundle as %%CLIENT_CORE%% (so the file is also valid plain script).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtTok, esc, fmtAgo, TOOL_COLORS, toolColor, blockGeom,
  nodeRadius, edgeOpacity, edgeWidth, EDGE_COLORS,
  connectEvents, resolveControlVisibility,
  hexPath, harnessWedges, harnessBreakdown, HARNESS_MARK, HARNESS_FILL_OPACITY,
  SIM_ALPHA_DECAY,
  isProjectGlyphActive, glyphGrid, glyphGridExtent,
  glyphCellPosition, glyphLatticeCells, snapToGlyphCell,
  mergeGlyphPlacements, moveGlyphPlacement, minimapViewportRect,
  glyphWorldExtent, glyphBoardConfig, glyphSpiralCell,
  firstAvailableRadial, glyphLatticeWindow, scaleGlyphPins,
  GLYPH_GRAPH_R, glyphGraphConfig, glyphGraphPins, graphRectToMinimap,
  NODE_RADII,
  projectGlyphMarkup, projectGlyphSvg, projectGlyphFieldSvg,
} from '../experience/client-core.mjs';

test('fmtTok — M/k/plain formatting', () => {
  assert.equal(fmtTok(2_400_000), '2.4M');
  assert.equal(fmtTok(42_000), '42k');
  assert.equal(fmtTok(999), '999');
  assert.equal(fmtTok(0), '0');
});

test('esc — escapes HTML-significant characters', () => {
  assert.equal(esc('<b a="x">&'), '&lt;b a=&quot;x&quot;&gt;&amp;');
  assert.equal(esc(null), 'null');
});

test('fmtAgo — seconds/minutes/hours', () => {
  assert.equal(fmtAgo(45), '45s');
  assert.equal(fmtAgo(125), '2m5s');
  assert.equal(fmtAgo(7320), '2h2m');
});

test('toolColor — case-insensitive canonical tool colors, aliases share hues', () => {
  assert.equal(toolColor('Write'), TOOL_COLORS.Write);
  assert.equal(toolColor('write'), TOOL_COLORS.Write);
  assert.equal(toolColor('Shell'), toolColor('Bash'), 'shell aliases bash');
  assert.equal(toolColor('Glob'), toolColor('Grep'));
  assert.equal(toolColor('NeverHeardOfIt'), null);
});

test('blockGeom — ambient floor strips vs top-anchored activity spikes', () => {
  const trackH = 62;
  assert.deepEqual(blockGeom({ type: 'tokens' }, trackH), { h: 4, yOff: 58 });
  assert.deepEqual(blockGeom({ type: 'words' }, trackH),  { h: 8, yOff: 49 });
  assert.deepEqual(blockGeom({ type: 'tool_call', tool: 'Write' }, trackH), { h: 52, yOff: 2 });
  assert.deepEqual(blockGeom({ type: 'tool_call', tool: 'grep' }, trackH),  { h: 14, yOff: 2 });
  assert.deepEqual(blockGeom({ type: 'tool_call', tool: 'Mystery' }, trackH), { h: 20, yOff: 2 });
});

test('nodeRadius — project scales by sizeNorm (PR_MIN..PR_MAX), session/file/cluster too', () => {
  assert.equal(nodeRadius({ type: 'project', sizeNorm: 0 }), 18);
  assert.equal(nodeRadius({ type: 'project', sizeNorm: 1 }), 34);
  assert.equal(nodeRadius({ type: 'project' }), 18, 'missing sizeNorm defaults to 0');
  assert.equal(nodeRadius({ type: 'session', sizeNorm: 0 }), 5);
  assert.equal(nodeRadius({ type: 'session', sizeNorm: 1 }), 20);
  assert.equal(nodeRadius({ type: 'file', sizeNorm: 0.5 }), 8);
});

test('hexPath — pointy-top regular hexagon, 6 vertices at radius r', async () => {
  const { hexPath } = await import('../experience/client-core.mjs');
  const d = hexPath(20);
  assert.ok(d.startsWith('M'));
  assert.ok(d.endsWith('Z'));
  const verts = d.slice(1, -1).split('L').map(p => p.split(',').map(Number));
  assert.equal(verts.length, 6);
  assert.ok(Math.abs(verts[0][0] - 0) < 1e-9, 'first vertex is pointy-top: x≈0');
  assert.ok(Math.abs(verts[0][1] - -20) < 1e-9, 'first vertex is pointy-top: y≈-r');
  for (const [x, y] of verts)
    assert.ok(Math.abs(Math.hypot(x, y) - 20) < 1e-9, 'every vertex sits at distance r from origin');
});

test('SIM_ALPHA_DECAY settles the force layout in a few seconds, not twenty', () => {
  assert.ok(SIM_ALPHA_DECAY >= 0.018 && SIM_ALPHA_DECAY <= 0.023);
});

test('HARNESS_FILL_OPACITY is solid — active project glyphs are opaque cells', () => {
  assert.equal(HARNESS_FILL_OPACITY, 1);
});

test('isProjectGlyphActive — recencyLevel >= 1 or inFlight', () => {
  assert.equal(isProjectGlyphActive(null), false);
  assert.equal(isProjectGlyphActive({}), false);
  assert.equal(isProjectGlyphActive({ recencyLevel: 0 }), false);
  assert.equal(isProjectGlyphActive({ recencyLevel: 1 }), true);
  assert.equal(isProjectGlyphActive({ recencyLevel: 3 }), true);
  assert.equal(isProjectGlyphActive({ recencyLevel: 0, inFlight: true }), true);
});

test('glyphGrid — pointy-top hex packing, odd rows offset, stable', () => {
  assert.deepEqual(glyphGrid(0), []);
  const r = 10;
  const one = glyphGrid(1, { r, cols: 3 });
  assert.equal(one.length, 1);
  assert.equal(one[0].col, 0);
  assert.equal(one[0].row, 0);
  assert.equal(one[0].x, r);
  assert.equal(one[0].y, r);

  const four = glyphGrid(4, { r, cols: 2 });
  assert.equal(four.length, 4);
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  assert.equal(four[1].col, 1);
  assert.equal(four[1].row, 0);
  assert.ok(Math.abs(four[1].x - (r + dx)) < 1e-9);
  assert.equal(four[2].row, 1);
  assert.ok(Math.abs(four[2].x - (r + dx / 2)) < 1e-9, 'odd row is offset by half a hex');
  assert.ok(Math.abs(four[2].y - (r + dy)) < 1e-9);
  assert.deepEqual(glyphGrid(4, { r, cols: 2 }), four, 'same inputs → same cells');

  const ext = glyphGridExtent(4, { r, cols: 2 });
  assert.ok(ext.width >= four[1].x + r);
  assert.ok(ext.height >= four[2].y + r);
});

test('projectGlyphMarkup — inactive is hollow; active is solid harness fill', () => {
  const idle = projectGlyphMarkup({ color: '#ff8800', harnesses: ['claude-code', 'pi'], recencyLevel: 0 }, { r: 16, bg: '#000000' });
  assert.ok(idle.includes(hexPath(16)));
  assert.ok(idle.includes('fill="#000000"'), 'idle hex sits on the canvas');
  assert.ok(!idle.includes(HARNESS_MARK['claude-code']), 'idle has no harness fill');

  const live = projectGlyphMarkup({ color: '#ff8800', harnesses: ['claude-code'], recencyLevel: 1 }, { r: 16, bg: '#000000' });
  assert.ok(live.includes(HARNESS_MARK['claude-code']));
  assert.ok(/fill-opacity="1"/.test(live), 'active fill is solid');

  const svg = projectGlyphSvg({ color: '#ff8800', recencyLevel: 0, id: 'p1' }, { r: 8 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox'));
});

test('glyphCellPosition / snapToGlyphCell — inverse on the hex lattice', () => {
  const opts = { r: 12, cols: 8, rows: 6 };
  for (const [col, row] of [[0, 0], [3, 0], [0, 1], [2, 3], [7, 5]]) {
    const pos = glyphCellPosition(col, row, opts);
    const snap = snapToGlyphCell(pos.x, pos.y, opts);
    assert.equal(snap.col, col, `col ${col},${row}`);
    assert.equal(snap.row, row, `row ${col},${row}`);
  }
  const clamped = snapToGlyphCell(-40, -40, { r: 12, cols: 8, rows: 6 });
  assert.equal(clamped.col, 0);
  assert.equal(clamped.row, 0);
  const hi = snapToGlyphCell(4000, 4000, { r: 12, cols: 8, rows: 6 });
  assert.equal(hi.col, 7);
  assert.equal(hi.row, 5);
  const west = snapToGlyphCell(-40, 0, { r: 12, originX: 0, originY: 0 });
  assert.ok(west.col < 0, 'unbounded snap goes negative (infinite in all directions)');
});

test('glyphLatticeCells — full configurable board, not just packed n', () => {
  const cells = glyphLatticeCells({ cols: 4, rows: 3, r: 10 });
  assert.equal(cells.length, 12);
  assert.equal(cells[0].col, 0);
  assert.equal(cells[0].row, 0);
  assert.equal(cells[11].col, 3);
  assert.equal(cells[11].row, 2);
  const world = glyphWorldExtent({ cols: 4, rows: 3, r: 10 });
  assert.ok(world.width > 10);
  assert.ok(world.height > 10);
});

test('glyphSpiralCell — origin then hex rings, first available is radial', () => {
  assert.deepEqual(glyphSpiralCell(0), { col: 0, row: 0 });
  const ring1 = new Set();
  for (let i = 1; i <= 6; i++) {
    const c = glyphSpiralCell(i);
    ring1.add(c.col + ',' + c.row);
    const pos = glyphCellPosition(c.col, c.row, { r: 10, originX: 0, originY: 0 });
    const origin = glyphCellPosition(0, 0, { r: 10, originX: 0, originY: 0 });
    const dist = Math.hypot(pos.x - origin.x, pos.y - origin.y);
    assert.ok(dist > 5 && dist < 25, 'ring 1 sits on the first hex neighbourhood');
  }
  assert.equal(ring1.size, 6, 'six unique neighbours');
  const seen = new Set();
  for (let i = 0; i < 19; i++) {
    const c = glyphSpiralCell(i);
    const k = c.col + ',' + c.row;
    assert.equal(seen.has(k), false, 'spiral never repeats');
    seen.add(k);
  }
  const occ = new Set(['0,0', ...[...ring1]]);
  const next = firstAvailableRadial(occ);
  assert.equal(glyphSpiralCell(7).col, next.col);
  assert.equal(glyphSpiralCell(7).row, next.row);
});

test('mergeGlyphPlacements — saved cells win, the rest pack radially', () => {
  const ids = ['a', 'b', 'c'];
  const packed = mergeGlyphPlacements(ids, null);
  assert.deepEqual(packed.a, glyphSpiralCell(0));
  assert.deepEqual(packed.b, glyphSpiralCell(1));
  assert.deepEqual(packed.c, glyphSpiralCell(2));

  const saved = { b: { col: 2, row: 1 } };
  const merged = mergeGlyphPlacements(ids, saved);
  assert.deepEqual(merged.b, { col: 2, row: 1 }, 'manual place is kept');
  assert.deepEqual(merged.a, { col: 0, row: 0 });
  assert.notDeepEqual(merged.c, { col: 2, row: 1 }, 'auto pack skips occupied');
});

test('moveGlyphPlacement — empty cell moves, occupied cell swaps', () => {
  const start = { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } };
  const moved = moveGlyphPlacement(start, 'a', 2, 1);
  assert.deepEqual(moved.a, { col: 2, row: 1 });
  assert.deepEqual(moved.b, { col: 1, row: 0 });
  const swapped = moveGlyphPlacement(start, 'a', 1, 0);
  assert.deepEqual(swapped.a, { col: 1, row: 0 });
  assert.deepEqual(swapped.b, { col: 0, row: 0 });
});

test('minimapViewportRect — world camera maps onto the mini field', () => {
  const rect = minimapViewportRect({
    worldX: 100, worldY: 50, worldW: 200, worldH: 100,
    boardW: 400, boardH: 200, miniW: 80, miniH: 40,
  });
  assert.equal(rect.x, 20);
  assert.equal(rect.y, 10);
  assert.equal(rect.w, 40);
  assert.equal(rect.h, 20);
  const empty = minimapViewportRect({ worldX: 0, worldY: 0, worldW: 10, worldH: 10, boardW: 0, boardH: 0, miniW: 80, miniH: 40 });
  assert.deepEqual(empty, { x: 0, y: 0, w: 0, h: 0 });
});

test('glyphBoardConfig — board radius only; lattice is unbounded', () => {
  const cfg = glyphBoardConfig(4);
  assert.ok(cfg.r > 0);
  assert.equal(cfg.cols, undefined);
  assert.equal(cfg.rows, undefined);
});

test('glyphLatticeWindow — cells covering a view, including negatives', () => {
  const cells = glyphLatticeWindow({ x0: -40, y0: -40, x1: 40, y1: 40, r: 10, originX: 0, originY: 0 });
  assert.ok(cells.some(c => c.col === 0 && c.row === 0));
  assert.ok(cells.some(c => c.col < 0 || c.row < 0), 'window extends west/north of origin');
});

test('scaleGlyphPins — hex relatives mapped into a force viewport, centroid at center', () => {
  const pins = scaleGlyphPins(
    { a: { col: 0, row: 0 }, b: { col: 2, row: 0 } },
    { width: 800, height: 600, r: 20 },
  );
  assert.ok(pins.a.x < pins.b.x, 'relative east-west preserved');
  assert.ok(Math.abs((pins.a.x + pins.b.x) / 2 - 400) < 1, 'centroid x → width/2');
  assert.ok(Math.abs((pins.a.y + pins.b.y) / 2 - 300) < 1, 'centroid y → height/2');
  const one = scaleGlyphPins({ a: { col: 0, row: 0 } }, { width: 800, height: 600, r: 20 });
  assert.ok(Math.abs(one.a.x - 400) < 1);
  assert.ok(Math.abs(one.a.y - 300) < 1);
});

test('glyphGraphPins — identity mapping, origin hex at canvas centre', () => {
  assert.equal(GLYPH_GRAPH_R, NODE_RADII.PR_MAX * 2);
  const cfg = glyphGraphConfig(800, 600);
  assert.equal(cfg.originX, 400);
  assert.equal(cfg.originY, 300);
  assert.equal(cfg.r, GLYPH_GRAPH_R);
  const pins = glyphGraphPins(
    { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } },
    { width: 800, height: 600 },
  );
  assert.equal(pins.a.x, 400);
  assert.equal(pins.a.y, 300);
  const east = glyphCellPosition(1, 0, cfg);
  assert.equal(pins.b.x, east.x);
  assert.equal(pins.b.y, east.y);
  const snap = snapToGlyphCell(pins.b.x, pins.b.y, cfg);
  assert.equal(snap.col, 1);
  assert.equal(snap.row, 0);
});

test('graphRectToMinimap — graph camera maps onto the dock field', () => {
  const vis = { worldX: 400, worldY: 300, worldW: 136, worldH: 136 };
  const rect = graphRectToMinimap(vis, { graphR: 68, miniR: 7, originX: 400, originY: 300 });
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 0);
  assert.ok(Math.abs(rect.w - 14) < 1e-9);
  assert.ok(Math.abs(rect.h - 14) < 1e-9);
});

test('projectGlyphFieldSvg — placements override default pack', () => {
  const projects = [
    { id: 'a', label: 'a', color: '#ff8800', harnesses: [], recencyLevel: 0 },
    { id: 'b', label: 'b', color: '#00ff88', harnesses: [], recencyLevel: 0 },
  ];
  const svg = projectGlyphFieldSvg(projects, {
    r: 10, cols: 4, rows: 3, bg: '#000000',
    placements: { b: { col: 3, row: 2 } },
  });
  assert.ok(svg.includes('data-pid="b"'));
  const pos = glyphCellPosition(3, 2, { r: 10, originX: 0, originY: 0 });
  assert.ok(svg.includes(`translate(${pos.x},${pos.y})`));
});

test('projectGlyphFieldSvg — one svg, glyphs at grid cells, data-pid for click', () => {
  const projects = [
    { id: 'D--src-a', label: 'a', color: '#ff8800', harnesses: ['pi'], recencyLevel: 1 },
    { id: 'D--src-b', label: 'b', color: '#00ff88', harnesses: ['grok'], recencyLevel: 0 },
  ];
  const svg = projectGlyphFieldSvg(projects, { r: 10, cols: 2, bg: '#000000' });
  assert.ok(svg.startsWith('<svg'));
  assert.equal((svg.match(/data-pid="/g) || []).length, 2);
  assert.ok(svg.includes('data-pid="D--src-a"'));
  assert.ok(svg.includes('data-pid="D--src-b"'));
  assert.ok(svg.includes(HARNESS_MARK.pi), 'active cell is solid');
  assert.ok(!svg.split('data-pid="D--src-b"')[1].split('</g>')[0].includes(HARNESS_MARK.grok),
    'idle cell stays hollow');
});

test('HARNESS_MARK has seven distinct non-blue data hues', () => {
  const ids = ['claude-code', 'pi', 'antigravity', 'grok', 'opencode', 'copilot', 'command-code'];
  const hexes = ids.map(id => HARNESS_MARK[id]);
  assert.equal(new Set(hexes).size, 7);
  for (const hex of hexes) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) continue;
    const d = max - min;
    const l = (max + min) / 2;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    h *= 360;
    assert.ok(!(s >= 0.06 && h >= 190 && h <= 268), `${hex} is blue-family chrome (h=${h.toFixed(0)})`);
  }
});

function pathPts(d) {
  return d.replace(/Z$/i, '').slice(1).split('L').map(p => p.split(',').map(Number));
}

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

test('harnessWedges — empty / one / two / three / four+', () => {
  assert.deepEqual(harnessWedges([], 20), []);
  assert.deepEqual(harnessWedges(null, 20), []);

  const solid = harnessWedges(['claude-code'], 20);
  assert.equal(solid.length, 1);
  assert.equal(solid[0].harness, 'claude-code');
  assert.equal(solid[0].d, hexPath(20), 'single harness is a solid hex, not a fan');

  const split = harnessWedges(['claude-code', 'pi'], 20);
  assert.equal(split.length, 2);
  assert.equal(split[0].harness, 'claude-code');
  assert.equal(split[1].harness, 'pi');
  const left = pathPts(split[0].d);
  const right = pathPts(split[1].d);
  assert.ok(left.length >= 3 && right.length >= 3);
  assert.ok(near(left[0][0], 0) && near(left[0][1], 0), 'n=2 wedges start at the center');
  // Vertical split through top and bottom vertices of a pointy-top hex.
  const hasTop = p => p.some(([x, y]) => near(x, 0) && near(y, -20));
  const hasBot = p => p.some(([x, y]) => near(x, 0) && near(y, 20));
  assert.ok(hasTop(left) && hasBot(left), 'first half includes the top–bottom diagonal');
  assert.ok(hasTop(right) && hasBot(right), 'second half shares the same diagonal');

  const tri = harnessWedges(['claude-code', 'pi', 'grok'], 20);
  assert.equal(tri.length, 3);
  // 120° rays hit vertices 0, 2, 4 (top, lower-right, lower-left).
  const tri0 = pathPts(tri[0].d);
  assert.ok(near(tri0[0][0], 0) && near(tri0[0][1], 0));
  assert.ok(tri0.some(([x, y]) => near(x, 0) && near(y, -20)), 'first 120° wedge includes the top vertex');

  const quad = harnessWedges(['claude-code', 'pi', 'grok', 'opencode'], 20);
  assert.equal(quad.length, 4);
  const q0 = pathPts(quad[0].d);
  assert.ok(near(q0[0][0], 0) && near(q0[0][1], 0), 'n=4 is a fan from the center');
  // 90° ray from top hits the right flat (side midpoint), not a vertex.
  const sideHit = q0.find(([x, y]) => near(x, 20 * Math.sqrt(3) / 2, 1e-4) && near(y, 0, 1e-4));
  assert.ok(sideHit, 'n=4 first wedge lands on a hex side, not only corners');

  const seven = harnessWedges(
    ['claude-code', 'pi', 'antigravity', 'grok', 'opencode', 'copilot', 'command-code'], 20);
  assert.equal(seven.length, 7);
  for (const w of seven) {
    const pts = pathPts(w.d);
    assert.ok(near(pts[0][0], 0) && near(pts[0][1], 0));
    assert.ok(pts.length >= 3);
  }
});

test('harnessWedges — weighted by session counts', () => {
  // No weights (or all-equal weights) is unchanged from the equal-angle default.
  const bare = harnessWedges(['claude-code', 'pi'], 20);
  assert.deepEqual(harnessWedges(['claude-code', 'pi'], 20, null), bare);
  assert.deepEqual(harnessWedges(['claude-code', 'pi'], 20, { 'claude-code': 1, pi: 1 }), bare);

  // claude-code: 3 sessions, pi: 1 session → 75%/25% split, boundary at 270°
  // (the left-side midpoint of a pointy-top hex, not a vertex).
  const w = harnessWedges(['claude-code', 'pi'], 20, { 'claude-code': 3, pi: 1 });
  assert.equal(w.length, 2);
  assert.equal(w[0].harness, 'claude-code');
  assert.equal(w[1].harness, 'pi');
  const majority = pathPts(w[0].d);
  const minority = pathPts(w[1].d);
  assert.ok(near(majority[0][0], 0) && near(majority[0][1], 0), 'wedges start at center');
  const hasLeftMid = p => p.some(([x, y]) => near(x, -20 * Math.sqrt(3) / 2, 1e-4) && near(y, 0, 1e-4));
  assert.ok(hasLeftMid(majority), 'majority wedge reaches the 270° boundary (left side midpoint)');
  assert.ok(hasLeftMid(minority), 'minority wedge shares the same boundary point');
});

test('harnessBreakdown — preserves glyph order, counts sessions, carries mark color', () => {
  assert.deepEqual(harnessBreakdown([]), []);
  const rows = harnessBreakdown(
    ['claude-code', 'pi'],
    [
      { harness: 'pi' },
      { harness: 'claude-code' },
      { harness: 'claude-code' },
      { source: 'pi' },
    ],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].harness, 'claude-code');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].color, HARNESS_MARK['claude-code']);
  assert.equal(rows[1].harness, 'pi');
  assert.equal(rows[1].count, 2);
});

test('edge opacity/width — weighted edges scale with sqrt(weight/max)', () => {
  assert.ok(EDGE_COLORS.write);
  const base = edgeOpacity({ type: 'read' }, 100);
  const heavy = edgeOpacity({ type: 'read', weight: 100 }, 100);
  assert.ok(heavy > base, 'weight raises opacity');
  assert.ok(edgeWidth({ type: 'write', weight: 100 }, 100) > edgeWidth({ type: 'write', weight: 1 }, 100));
});

test('connectEvents — wires handlers with JSON parsing and status callbacks', () => {
  const listeners = {};
  class FakeES {
    constructor(url) { this.url = url; FakeES.last = this; }
    addEventListener(ev, fn) { listeners[ev] = fn; }
  }
  const seen = [];
  const states = [];
  connectEvents({
    handlers: {
      tool_call: d => seen.push(d),
      updated:   (d, raw) => seen.push({ raw: raw.data }),
    },
    onStatus: s => states.push(s),
  }, FakeES);

  assert.equal(FakeES.last.url, '/events');
  listeners.tool_call({ data: '{"tool":"Read","slug":"abc"}' });
  assert.deepEqual(seen[0], { tool: 'Read', slug: 'abc' });

  listeners.updated({ data: '2026-06-12T00:00:00Z' }); // non-JSON → raw passthrough
  assert.equal(seen[1].raw, '2026-06-12T00:00:00Z');

  FakeES.last.onopen();
  FakeES.last.onerror();
  assert.deepEqual(states, ['open', 'reconnecting']);
});

test('resolveControlVisibility — only the active layout’s control panels show', () => {
  const handlers = {
    force:    { controls: ['force-options'] },
    swimlane: { controls: ['sl-options', 'sl-extra'] },
    matrix:   {},
    grid:     { controls: ['force-options'] },
  };
  assert.deepEqual(resolveControlVisibility(handlers, 'swimlane'), {
    'force-options': false, 'sl-options': true, 'sl-extra': true,
  });
  assert.deepEqual(resolveControlVisibility(handlers, 'matrix'), {
    'force-options': false, 'sl-options': false, 'sl-extra': false,
  });
  assert.deepEqual(resolveControlVisibility(handlers, 'force'), {
    'force-options': true, 'sl-options': false, 'sl-extra': false,
  });
  assert.deepEqual(resolveControlVisibility(handlers, 'grid'), {
    'force-options': true, 'sl-options': false, 'sl-extra': false,
  }, 'shared force-options stays visible on lattice');
});

// ── DAW lane geometry (extracted from 19-daw-builder) ─────────────────────────

test('DAW_FAMILY_LANES — four family lanes with portions summing to ~0.88', async () => {
  const { DAW_FAMILY_LANES } = await import('../experience/client-core.mjs');
  assert.deepEqual(DAW_FAMILY_LANES.map(l => l.id), ['file', 'system', 'ai', 'context']);
  const total = DAW_FAMILY_LANES.reduce((a, l) => a + l.portion, 0);
  assert.ok(Math.abs(total - 0.88) < 1e-9);
});

test('computeLaneLayout — stacks lanes under the ruler, 18px minimum', async () => {
  const { computeLaneLayout } = await import('../experience/client-core.mjs');
  const rows = computeLaneLayout(420);
  assert.equal(rows[0].y, 20, 'first lane starts under the 20px ruler');
  assert.equal(rows[1].y, rows[0].y + rows[0].h, 'lanes stack');
  assert.ok(rows.every(r => r.h >= 18));
  const tiny = computeLaneLayout(40);
  assert.ok(tiny.every(r => r.h === 18), 'minimum lane height enforced');
});

test('laneForEvent — routes by pulse family', async () => {
  const { laneForEvent } = await import('../experience/client-core.mjs');
  assert.equal(laneForEvent({ family: 'ai' }).id, 'ai');
  assert.equal(laneForEvent({ family: 'nope' }), null);
});

test('evTimeX — right-anchored time axis with scroll offset', async () => {
  const { evTimeX } = await import('../experience/client-core.mjs');
  const now = 100_000;
  // event now → right edge; 1s ago at 30px/s → 30px left of edge
  assert.equal(evTimeX({ ts: now }, now, 800, 30, 0), 800);
  assert.equal(evTimeX({ ts: now - 1000 }, now, 800, 30, 0), 770);
  assert.equal(evTimeX({ ts: now - 1000 }, now, 800, 30, 1000), 800, 'scrollMs shifts view back');
});

test('voicesSoundingAt — covers [at, at+dur) and drops expired voices', async () => {
  const { voicesSoundingAt } = await import('../experience/client-core.mjs');
  const voices = [
    { at: 1.0, dur: 0.4, instrument: 'harp' },
    { at: 1.2, dur: 0.2, instrument: 'bit' },
    { at: 2.0, dur: 0.5, instrument: 'bell' },
  ];
  assert.deepEqual(voicesSoundingAt(voices, 0.9).map(v => v.instrument), []);
  assert.deepEqual(voicesSoundingAt(voices, 1.1).map(v => v.instrument), ['harp']);
  assert.deepEqual(voicesSoundingAt(voices, 1.25).map(v => v.instrument), ['harp', 'bit']);
  assert.deepEqual(voicesSoundingAt(voices, 1.41).map(v => v.instrument), []);
  assert.deepEqual(voicesSoundingAt(voices, 2.1).map(v => v.instrument), ['bell']);
  assert.deepEqual(voicesSoundingAt([], 1), []);
});

test('fmtSoundingLine — instrument ×cluster, label, hz', async () => {
  const { fmtSoundingLine } = await import('../experience/client-core.mjs');
  assert.equal(fmtSoundingLine([]), '');
  assert.equal(fmtSoundingLine(null), '');
  assert.equal(
    fmtSoundingLine([{ instrument: 'harp', label: 'read_file', hz: 261.6, clusterN: 12, relMs: 12400 }]),
    '▶ t+12.4s  harp×12 read_file 262Hz',
  );
});

test('fmtSessionT — seconds then mmss', async () => {
  const { fmtSessionT } = await import('../experience/client-core.mjs');
  assert.equal(fmtSessionT(null), '');
  assert.equal(fmtSessionT(12400), 't+12.4s');
  assert.equal(fmtSessionT(65000), 't+1m05s');
  assert.equal(fmtSessionT(125000), 't+2m05s');
});

function v(over = {}) {
  const { sonic, ...rest } = over;
  return {
    name: 'harp', hz: 261.6, vol: 0.4,
    sonic: { key: 'read', fam: 'file', ...sonic },
    ...rest,
  };
}

test('coalesceVoices — under cap, unison C4 spreads into a chord', async () => {
  const { coalesceVoices } = await import('../experience/client-core.mjs');
  const { audible, ghosts } = coalesceVoices([v({}), v({}), v({})], { scale: [0, 4, 7] });
  assert.equal(audible.length, 3);
  assert.equal(ghosts.length, 0);
  const hzs = audible.map(a => +a.hz.toFixed(1));
  assert.notEqual(hzs[1], hzs[0], 'second tone leaves unison');
  assert.ok(hzs[2] > hzs[1]);
});

test('coalesceVoices — 12 reads collapse to a 3-tone file chord', async () => {
  const { coalesceVoices, VOICE_MAX_CHORD } = await import('../experience/client-core.mjs');
  const burst = Array.from({ length: 12 }, () => v({}));
  const { audible, ghosts } = coalesceVoices(burst, { scale: [0, 4, 7, 12] });
  assert.equal(audible.length, VOICE_MAX_CHORD);
  assert.equal(ghosts.length, 12);
  assert.equal(audible[0].clusterN, 12);
  assert.ok(audible.every(a => a.sonic.fam === 'file'));
});

test('coalesceVoices — write stays the root of a file-family chord', async () => {
  const { coalesceVoices } = await import('../experience/client-core.mjs');
  const burst = [
    v({ name: 'bass', hz: 130.8, sonic: { key: 'write', fam: 'file' } }),
    ...Array.from({ length: 10 }, () => v({})),
  ];
  const { audible } = coalesceVoices(burst, { scale: [0, 4, 7] });
  assert.equal(audible[0].sonic.key, 'write');
  assert.ok(audible.length <= 4);
  assert.equal(audible[0].clusterN, 11);
});

test('coalesceVoices — mixed families get one cluster each, never more than maxPoly', async () => {
  const { coalesceVoices, VOICE_MAX_POLYPHONY } = await import('../experience/client-core.mjs');
  const burst = [
    ...Array.from({ length: 6 }, () => v({})),
    ...Array.from({ length: 6 }, () => v({ name: 'bell', sonic: { key: 'other', fam: 'ai' } })),
    ...Array.from({ length: 6 }, () => v({ name: 'flute', sonic: { key: 'tokens', fam: 'context' } })),
  ];
  const { audible } = coalesceVoices(burst, { scale: [0, 4, 7] });
  assert.ok(audible.length <= VOICE_MAX_POLYPHONY);
  const fams = new Set(audible.map(a => a.sonic.fam));
  assert.ok(fams.size >= 2, 'varied burst keeps more than one family');
});

test('coalesceVoices — percussion pile is one hit, not a snare chord', async () => {
  const { coalesceVoices } = await import('../experience/client-core.mjs');
  const burst = Array.from({ length: 8 }, () => v({ name: 'snare', sonic: { key: 'bash_git', fam: 'system' } }));
  const { audible, ghosts } = coalesceVoices(burst);
  assert.equal(audible.length, 1);
  assert.equal(audible[0].name, 'snare');
  assert.equal(audible[0].clusterN, 8);
  assert.equal(ghosts.length, 7);
});

// ── History-view filters + free force profile (E3) ────────────────────────────

test('sessionMatchesFilters — date range, harness set, project set', async () => {
  const { sessionMatchesFilters } = await import('../experience/client-core.mjs');
  const node = { type: 'session', harness: 'grok', project_id: 'P1', date_str: '2026-06-10' };

  assert.equal(sessionMatchesFilters(node, {}), true, 'no filters → match');
  assert.equal(sessionMatchesFilters(node, { from: '2026-06-01' }), true);
  assert.equal(sessionMatchesFilters(node, { from: '2026-06-11' }), false);
  assert.equal(sessionMatchesFilters(node, { to: '2026-06-10' }), true, 'to is inclusive');
  assert.equal(sessionMatchesFilters(node, { to: '2026-06-09' }), false);
  assert.equal(sessionMatchesFilters(node, { harnesses: new Set(['grok']) }), true);
  assert.equal(sessionMatchesFilters(node, { harnesses: new Set(['pi']) }), false);
  assert.equal(sessionMatchesFilters(node, { harnesses: new Set() }), true, 'empty set → no constraint');
  assert.equal(sessionMatchesFilters(node, { projects: new Set(['P1']) }), true);
  assert.equal(sessionMatchesFilters(node, { projects: new Set(['P2']) }), false);
  assert.equal(sessionMatchesFilters({ ...node, date_str: undefined }, { from: '2026-06-11' }), true,
    'undated sessions are never date-filtered');
});

test('forceProfile — anchored vs free layouts', async () => {
  const { forceProfile } = await import('../experience/client-core.mjs');
  const anchored = forceProfile(false);
  assert.equal(anchored.projectPinned, true);
  assert.equal(anchored.membershipStrength, 0.65);
  assert.equal(anchored.center, false);

  const free = forceProfile(true);
  assert.equal(free.projectPinned, false, 'projects unpin');
  assert.ok(free.membershipStrength < 0.1, 'membership links nearly let go');
  assert.equal(free.center, true, 'a weak center keeps the free graph on screen');
  assert.ok(Math.abs(free.projectCharge) < Math.abs(anchored.projectCharge),
    'project repulsion de-weighted');
});

// ── E5: cognition pulse glyphs + ticker entries ───────────────────────────────

test('pulseTickerEntry — glyphs, text, and roles per cognition event', async () => {
  const { pulseTickerEntry } = await import('../experience/client-core.mjs');

  const human = pulseTickerEntry('human_turn', { slug: 'abc12345', text: 'fix the auth bug please' });
  assert.ok(human.text.startsWith('⌨'));
  assert.ok(human.text.includes('fix the auth bug'));
  assert.equal(human.role, 'human');

  const compact = pulseTickerEntry('compact', { slug: 'abc12345' });
  assert.ok(compact.text.startsWith('⟲'));
  assert.equal(compact.role, 'context');

  const perm = pulseTickerEntry('permission', { slug: 'abc12345', mode: 'acceptEdits' });
  assert.ok(perm.text.includes('acceptEdits'));

  const terr = pulseTickerEntry('tool_error', { slug: 'abc12345', tool: 'Bash' });
  assert.ok(terr.text.startsWith('✖'));
  assert.equal(terr.role, 'err');

  const aerr = pulseTickerEntry('api_error', { slug: 'abc12345', message: 'quota exceeded', code: 'rate_limit' });
  assert.ok(aerr.text.includes('quota exceeded'));
  assert.equal(aerr.role, 'err');

  assert.equal(pulseTickerEntry('chirp', {}), null, 'chirps stay out of the ticker');
});

test('blockGeom — cognition events get distinct canvas geometry', () => {
  const trackH = 62;
  assert.deepEqual(blockGeom({ type: 'compact' }, trackH),    { h: 58, yOff: 2 }, 'compact = full-height divider');
  assert.deepEqual(blockGeom({ type: 'tool_error' }, trackH), { h: 58, yOff: 2 });
  assert.deepEqual(blockGeom({ type: 'api_error' }, trackH),  { h: 58, yOff: 2 });
  assert.deepEqual(blockGeom({ type: 'human_turn' }, trackH), { h: 36, yOff: 2 });
  assert.deepEqual(blockGeom({ type: 'permission' }, trackH), { h: 12, yOff: 2 });
  assert.deepEqual(blockGeom({ type: 'mode_shift' }, trackH), { h: 12, yOff: 2 });
  assert.deepEqual(blockGeom({ type: 'chirp' }, trackH),      { h: 5,  yOff: 40 });
});

// ── E5: DAW session legend + context pressure ─────────────────────────────────

test('contextPressure — context tokens vs window, clamped 0..1', async () => {
  const { contextPressure } = await import('../experience/client-core.mjs');
  assert.equal(contextPressure(50_000, 50_000, 200_000), 0.5);
  assert.equal(contextPressure(0, 0), 0);
  assert.equal(contextPressure(300_000, 0, 200_000), 1, 'clamped');
});

test('sessionLegend — newest-first distinct sessions with latest context pressure', async () => {
  const { sessionLegend } = await import('../experience/client-core.mjs');
  const ring = [
    { type: 'tokens', ts: 1, slug: 'aaaa1111', project: 'pA', color: '#111111', input: 10_000, cache_read: 30_000 },
    { type: 'tool_call', ts: 2, slug: 'bbbb2222', project: 'pB', color: '#222222', tool: 'Read' },
    { type: 'tokens', ts: 3, slug: 'aaaa1111', project: 'pA', color: '#111111', input: 20_000, cache_read: 80_000 },
  ];
  const legend = sessionLegend(ring, 6, 200_000);
  assert.equal(legend.length, 2);
  assert.equal(legend[0].slug, 'aaaa1111', 'most recent first');
  assert.equal(legend[0].pressure, 0.5, 'latest tokens pulse wins (20k+80k of 200k)');
  assert.equal(legend[1].slug, 'bbbb2222');
  assert.equal(legend[1].pressure, null, 'no tokens seen → unknown pressure');
  assert.equal(sessionLegend(ring, 1, 200_000).length, 1, 'max cap');
});

// ── cluster geometry + visibility ─────────────────────────────────────────────

test('nodeRadius — cluster scales between CL_MIN and CL_MAX', async () => {
  const { NODE_RADII } = await import('../experience/client-core.mjs');
  assert.equal(NODE_RADII.CL_MIN, 12);
  assert.equal(NODE_RADII.CL_MAX, 24);
  assert.equal(nodeRadius({ type: 'cluster', sizeNorm: 0 }), 12);
  assert.equal(nodeRadius({ type: 'cluster', sizeNorm: 1 }), 24);
  assert.equal(nodeRadius({ type: 'cluster', sizeNorm: 0.5 }), 18);
  assert.equal(nodeRadius({ type: 'cluster' }), 12, 'missing sizeNorm defaults to 0');
});

test('EDGE styles — bundle entries present in the client-core copies', async () => {
  const { EDGE_OPACITY, EDGE_WIDTH } = await import('../experience/client-core.mjs');
  assert.equal(EDGE_COLORS.bundle, '#4a3a7a');
  assert.equal(typeof EDGE_OPACITY.bundle, 'number');
  assert.equal(typeof EDGE_WIDTH.bundle, 'number');
});

test('computeClusterHidden', async t => {
  const { computeClusterHidden } = await import('../experience/client-core.mjs');
  const nodes = [
    { id: 'proj-a', type: 'project' },
    { id: 's1', type: 'session', project_id: 'proj-a', date_str: '2026-05-01', cluster_id: 'cl1' },
    { id: 's2', type: 'session', project_id: 'proj-a', date_str: '2026-05-02', cluster_id: 'cl1' },
    { id: 's3', type: 'session', project_id: 'proj-a', date_str: '2026-05-03', cluster_id: null },
    { id: 'cl1', type: 'cluster', project_id: 'proj-a', member_ids: ['s1', 's2'] },
  ];

  await t.test('bundleOn false → hides all cluster nodes, nothing else', () => {
    const hidden = computeClusterHidden(nodes, { bundleOn: false, expanded: new Set(), filters: {} });
    assert.deepEqual([...hidden], ['cl1']);
  });

  await t.test('collapsed cluster → members hidden, cluster visible', () => {
    const hidden = computeClusterHidden(nodes, { bundleOn: true, expanded: new Set(), filters: {} });
    assert.ok(hidden.has('s1'));
    assert.ok(hidden.has('s2'));
    assert.ok(!hidden.has('cl1'));
    assert.ok(!hidden.has('s3'), 'unclustered session unaffected');
  });

  await t.test('expanded cluster → nothing hidden by the helper', () => {
    const hidden = computeClusterHidden(nodes, { bundleOn: true, expanded: new Set(['cl1']), filters: {} });
    assert.equal(hidden.size, 0);
  });

  await t.test('cluster with zero filter-passing members is hidden too', () => {
    const hidden = computeClusterHidden(nodes, {
      bundleOn: true, expanded: new Set(), filters: { from: '2026-06-01' },
    });
    assert.ok(hidden.has('cl1'));
  });

  await t.test('defaults are safe (no opts)', () => {
    const hidden = computeClusterHidden(nodes);
    assert.ok(hidden.has('s1') && hidden.has('s2') && !hidden.has('cl1'));
  });
});
