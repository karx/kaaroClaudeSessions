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

test('nodeRadius — project scales by sizeNorm (PR_MIN..PR_MAX), session/file/cluster too', () => {
  assert.equal(nodeRadius({ type: 'project', sizeNorm: 0 }), 18);
  assert.equal(nodeRadius({ type: 'project', sizeNorm: 1 }), 34);
  assert.equal(nodeRadius({ type: 'project' }), 18, 'missing sizeNorm defaults to 0');
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
