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

test('nodeRadius — project fixed, session/file scale by sizeNorm', () => {
  assert.equal(nodeRadius({ type: 'project' }), 26);
  assert.equal(nodeRadius({ type: 'session', sizeNorm: 0 }), 5);
  assert.equal(nodeRadius({ type: 'session', sizeNorm: 1 }), 20);
  assert.equal(nodeRadius({ type: 'file', sizeNorm: 0.5 }), 8);
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
  };
  assert.deepEqual(resolveControlVisibility(handlers, 'swimlane'), {
    'force-options': false, 'sl-options': true, 'sl-extra': true,
  });
  assert.deepEqual(resolveControlVisibility(handlers, 'matrix'), {
    'force-options': false, 'sl-options': false, 'sl-extra': false,
  });
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
