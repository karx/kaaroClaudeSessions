/**
 * test/seat-surfaces.test.mjs — Seat City call-sites on the graph canvas.
 * Geometry lives in test/seat-city.test.mjs. These lock default layout,
 * stacked-tile rendering, satellite hiding, and files-as-scaffold copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function src(p) {
  return fs.readFileSync(p, 'utf8');
}

test('Seat City is the default canvas; projects render stacked session tiles', () => {
  const r = src('experience/client/04-rendering.js');
  assert.match(r, /let currentLayout = 'grid'/);
  assert.match(r, /d\.type === 'project' && currentLayout === 'grid'/);
  assert.match(r, /seatTileMarkup/);
  assert.match(r, /seatFootprintR/);
  assert.match(r, /seatSlabHeight/);
});

test('glyph-board builds seat stacks and boots Lattice unless hash is forensic', () => {
  const g = src('experience/client/20-glyph-board.js');
  assert.match(g, /function refreshSeatCity/);
  assert.match(g, /buildSeatCity/);
  assert.match(g, /forceEnter/);
  for (const layout of ['force', 'swimlane', 'arc', 'matrix', '3d']) {
    assert.ok(g.includes(`'${layout}'`), `boot hash must recognize #${layout}`);
  }
  assert.match(g, /projectGlyphFieldSvg/);
  assert.equal(g.includes('seatTileMarkup'), false, 'minimap stays flat glyphs, not stacks');
});

test('Force re-joins nodes; Lattice refreshes seat stacks', () => {
  const l = src('experience/client/11-layout-manager.js');
  const forceEnter = l.slice(l.indexOf('force:'), l.indexOf('grid:'));
  assert.match(forceEnter, /joinNodes/);
  const gridEnter = l.slice(l.indexOf('grid:'), l.indexOf('swimlane:'));
  assert.match(gridEnter, /refreshSeatCity/);
  assert.match(l, /forceEnter/);
});

test('seat force layout drops links and charge — no orbiting sessions', () => {
  const f = src('experience/client/06-force-layout.js');
  assert.match(f, /seatForceConfig/);
  assert.match(f, /currentLayout === 'grid'/);
  assert.match(f, /force\('link',\s*null\)/);
  assert.match(f, /force\('charge',\s*null\)/);
  assert.match(f, /seatFootprintR/);
});

test('filters hide session satellites on the seat canvas', () => {
  const c = src('experience/client/12-controls.js');
  assert.match(c, /seatLayoutHides/);
  assert.match(c, /currentLayout === 'grid'/);
});

test('layout bar marks Lattice active; tool plumbing files start on', () => {
  const html = src('experience/pages/template.html');
  const force = html.match(/<button class="lay-btn[^"]*" data-layout="force">/);
  const grid = html.match(/<button class="lay-btn[^"]*" data-layout="grid">/);
  assert.ok(force, 'Force button exists');
  assert.ok(grid, 'Lattice button exists');
  assert.equal(force[0].includes('active'), false, 'Force is not the default chrome');
  assert.equal(grid[0].includes('active'), true, 'Lattice is the default chrome');
  const box = html.match(/<input type="checkbox" id="cb-files"[^>]*>/);
  assert.ok(box, 'cb-files exists');
  assert.equal(/\bchecked\b/.test(box[0]), true, '#cb-files is on — tools are the plumbing');
  assert.match(html, /Tool plumbing/);
  assert.match(html, /Session depth/);
});

test('seat canvas retargets tool pipes off hidden sessions onto the project seat', () => {
  const r = src('experience/client/04-rendering.js');
  assert.match(r, /function edgeEndpoint/);
  assert.match(r, /n\.type === 'session'/);
  const c = src('experience/client/12-controls.js');
  assert.match(c, /scaffoldFileIds/);
  assert.match(c, /e\.type !== 'write'/);
  const f = src('experience/client/06-force-layout.js');
  assert.match(f, /seatPinScaffold/);
});

test('live update does not assume a link force (seats have none)', () => {
  const u = src('experience/client/13-live-updates.js');
  assert.match(u, /simulation\.force\('link'\)/);
  assert.match(u, /refreshSeatCity/);
});
