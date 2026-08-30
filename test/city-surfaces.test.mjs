/**
 * test/city-surfaces.test.mjs — call-site contracts for RFC-project-city PRs B–D.
 * Geometry lives in test/city.test.mjs; these lock Lattice default, landing IA,
 * and working-set copy by reading the source that build.mjs concatenates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function src(p) {
  return fs.readFileSync(p, 'utf8');
}

test('Lattice is the default layout; projects render 2D city buildings', () => {
  const r = src('experience/client/04-rendering.js');
  assert.match(r, /let currentLayout = 'grid'/);
  assert.match(r, /d\.type === 'project' && currentLayout === 'grid'/);
  assert.match(r, /cityBuildingMarkup/);
  assert.match(r, /iso:\s*false/);
  assert.match(r, /diamondFill:\s*'file'/);
  assert.match(r, /hexRFromCellR/);
  assert.match(r, /citySlabMetrics/);
});

test('glyph-board boots Lattice unless hash names a forensic layout', () => {
  const g = src('experience/client/20-glyph-board.js');
  assert.match(g, /function refreshCity/);
  assert.match(g, /buildCityData/);
  assert.match(g, /forceEnter/);
  for (const layout of ['force', 'swimlane', 'arc', 'matrix', '3d']) {
    assert.ok(g.includes(`'${layout}'`), `boot hash must recognize #${layout}`);
  }
  assert.match(g, /projectGlyphFieldSvg/);
  assert.match(g, /MINI_R = 7/);
  assert.equal(g.includes('cityBuildingMarkup'), false, 'minimap must not extrude buildings');
});

test('switching Force re-joins nodes so hexes replace leftover buildings', () => {
  const l = src('experience/client/11-layout-manager.js');
  const forceEnter = l.slice(l.indexOf('force:'), l.indexOf('grid:'));
  assert.match(forceEnter, /joinNodes/);
  const gridEnter = l.slice(l.indexOf('grid:'), l.indexOf('swimlane:'));
  assert.match(gridEnter, /refreshCity/);
  assert.match(l, /forceEnter/);
});

test('layout bar marks Lattice active by default', () => {
  const html = src('experience/pages/template.html');
  const force = html.match(/<button class="lay-btn[^"]*" data-layout="force">/);
  const grid = html.match(/<button class="lay-btn[^"]*" data-layout="grid">/);
  assert.ok(force, 'Force button exists');
  assert.ok(grid, 'Lattice button exists');
  assert.equal(force[0].includes('active'), false, 'Force is not the default chrome');
  assert.equal(grid[0].includes('active'), true, 'Lattice is the default chrome');
});
