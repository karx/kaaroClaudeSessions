/**
 * test/layout-dispatch.test.mjs — guards the LAYOUT_HANDLERS dispatch contract.
 *
 * experience/client/*.js is browser JS (DOM/d3-coupled, no jsdom in this
 * project — see CLAUDE.md's documented coverage gap), so this can't drive
 * applyFilters()/the resize listener directly. Instead it does the same kind
 * of source-text assertion test/design-lint.test.mjs already uses for CSS
 * grammar, aimed at the exact bug class a review caught: applyFilters()
 * (12-controls.js) and the window resize listener (13-live-updates.js) used
 * to each keep their own parallel `if (currentLayout === '...')` chain, and
 * two layouts (ontology, signatures) shipped wired into one chain but not
 * the other — filtering did nothing on the Signatures tab, and neither tab
 * repositioned on resize. Both now dispatch through a single registry
 * (LAYOUT_HANDLERS[name].onFilterChange / .onResize) instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const LAYOUT_MANAGER = fs.readFileSync('experience/client/11-layout-manager.js', 'utf8');
const CONTROLS       = fs.readFileSync('experience/client/12-controls.js', 'utf8');
const LIVE_UPDATES   = fs.readFileSync('experience/client/13-live-updates.js', 'utf8');
const THREE_D        = fs.readFileSync('experience/client/10-3d.js', 'utf8');

test('applyFilters() dispatches through LAYOUT_HANDLERS, not a per-layout if-chain', () => {
  const fnStart = CONTROLS.indexOf('function applyFilters()');
  const fnEnd = CONTROLS.indexOf('\n}', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart, 'applyFilters() not found');
  const body = CONTROLS.slice(fnStart, fnEnd);
  assert.match(body, /LAYOUT_HANDLERS\[currentLayout\]\?\.onFilterChange\?\.\(\)/);
  assert.doesNotMatch(body, /currentLayout\s*===/,
    'applyFilters() grew a currentLayout === check again — every layout must own its behavior via LAYOUT_HANDLERS instead');
});

test('resize listener dispatches through LAYOUT_HANDLERS, not a per-layout if-chain', () => {
  const start = LIVE_UPDATES.indexOf("window.addEventListener('resize'");
  const end = LIVE_UPDATES.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start, 'resize listener not found');
  const body = LIVE_UPDATES.slice(start, end);
  assert.match(body, /LAYOUT_HANDLERS\[currentLayout\]\?\.onResize\?\.\(\)/);
  assert.doesNotMatch(body, /currentLayout\s*===/,
    'resize listener grew a currentLayout === check again — every layout must own its behavior via LAYOUT_HANDLERS instead');
});

test('LAYOUT_HANDLERS — every layout wires onFilterChange (no implicit generic fallback)', () => {
  const wiring = [
    ['force',      /onFilterChange:\s*applyForceFilters/],
    ['swimlane',   /onFilterChange:\s*renderSwimlane/],
    ['arc',        /onFilterChange:\s*arcApplyFilters/],
    ['matrix',     /onFilterChange:\s*renderMatrix/],
    ['ontology',   /onFilterChange:\s*ontologyApplyFilters/],
    ['signatures', /onFilterChange:\s*signaturesApplyFilters/],
  ];
  for (const [name, re] of wiring) {
    assert.match(LAYOUT_MANAGER, re, `${name}: no onFilterChange wiring in LAYOUT_HANDLERS`);
  }
});

test('LAYOUT_HANDLERS — every resizable layout wires onResize (force is exempt: D3 force layout is not pixel-fixed)', () => {
  const wiring = [
    ['swimlane',   /onResize:\s*renderSwimlane/],
    ['arc',        /onResize:\s*arcResize/],
    ['matrix',     /onResize:\s*renderMatrix/],
    ['ontology',   /onResize:\s*refreshOntology/],
    ['signatures', /onResize:\s*signaturesResize/],
  ];
  for (const [name, re] of wiring) {
    assert.match(LAYOUT_MANAGER, re, `${name}: no onResize wiring in LAYOUT_HANDLERS`);
  }
  // force is the first key in LAYOUT_HANDLERS, so its block is bounded by
  // the start of the next key (swimlane) — slice narrowly rather than
  // scanning to the first "onResize" anywhere in the file (which would
  // always match, in a later layout's block).
  const forceStart = LAYOUT_MANAGER.indexOf('\n  force:');
  const swimlaneStart = LAYOUT_MANAGER.indexOf('\n  swimlane:');
  assert.ok(forceStart >= 0 && swimlaneStart > forceStart, 'could not locate force block');
  const forceBlock = LAYOUT_MANAGER.slice(forceStart, swimlaneStart);
  assert.doesNotMatch(forceBlock, /onResize/,
    "force gained an onResize — if that's intentional, update this test's exemption list");
});

test("'3d' hooks live on the shared layout3D object, not a LAYOUT_HANDLERS spread copy", () => {
  // '3d': layout3D must stay the SAME object reference — layout3D.enter/exit
  // read `this._g`. Spreading it into a wrapper object here (`{...layout3D,
  // onFilterChange(){...}}`) breaks that binding: enter() would set _g on the
  // wrapper while onResize's `layout3D._g` check keeps reading the untouched
  // original, silently making resize a no-op. Caught once during review —
  // this pins the fix so it can't quietly regress.
  assert.match(LAYOUT_MANAGER, /'3d':\s*layout3D,/);
  assert.doesNotMatch(LAYOUT_MANAGER, /\.\.\.layout3D/,
    'LAYOUT_HANDLERS spreads layout3D again — this breaks this._g binding, see comment above');
  assert.match(THREE_D, /onFilterChange\(\)\s*\{\s*this\.exit\(\);\s*this\.enter\(\);\s*\}/);
  assert.match(THREE_D, /onResize\(\)\s*\{\s*if\s*\(this\._g\)\s*this\._g\.width\(W\)\.height\(H\);\s*\}/);
});
