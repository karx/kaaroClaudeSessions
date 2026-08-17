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

test('TOOL_MIX_COLORS — derived from DAW_FAMILY_LANES, plus web fallback', async () => {
  const { TOOL_MIX_COLORS, DAW_FAMILY_LANES } = await import('../experience/client-core.mjs');
  assert.equal(TOOL_MIX_COLORS.write, DAW_FAMILY_LANES.find(l => l.id === 'file').toolColors.write);
  assert.equal(TOOL_MIX_COLORS.bash_git, DAW_FAMILY_LANES.find(l => l.id === 'system').toolColors.bash_git);
  assert.equal(TOOL_MIX_COLORS.agent, DAW_FAMILY_LANES.find(l => l.id === 'ai').toolColors.agent);
  assert.equal(TOOL_MIX_COLORS.web, '#336688'); // no DAW lane carries 'web'
});

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

// ── Ontology view ──────────────────────────────────────────────────────────────

test('assignHarnessColors — sorted, deterministic, cycles the palette', async () => {
  const { assignHarnessColors, HARNESS_PALETTE } = await import('../experience/client-core.mjs');
  const { HARNESS_COLORS } = assignHarnessColors(['grok', 'claude-code', 'pi']);
  assert.equal(HARNESS_COLORS['claude-code'], HARNESS_PALETTE[0]);
  assert.equal(HARNESS_COLORS['grok'], HARNESS_PALETTE[1]);
  assert.equal(HARNESS_COLORS['pi'], HARNESS_PALETTE[2]);
});

test('computeOntologyMetrics — per-session 0-1 axes, scale log-scaled (tokens_work, tool_calls fallback)', async () => {
  const { computeOntologyMetrics } = await import('../experience/client-core.mjs');
  const maxima = { diversity: 8, density: 5, scaleTokens: 1000, scaleCalls: 50 };

  const tokenful = {
    tokens_work: 1000, tool_calls: 10, tool_diversity: 8, ai_title: 'x', branches: ['main'],
    subagent_count: 1, context_resets: 1, skills: ['transcript'],
    message_count: 40, duration_min: 20,
  };
  const m = computeOntologyMetrics(tokenful, maxima);
  assert.equal(m.scale, 1); // at maxima.scaleTokens → log1p ratio hits 1
  assert.equal(m.diversity, 1);
  assert.equal(m.structure, 1);
  assert.equal(m.density, 2 / 5); // 40/20=2 msgs/min, maxima.density=5

  // tokenless session (tokens_work=0) falls back to the tool_calls domain, not the tokens domain
  const tokenless = { tokens_work: 0, tool_calls: 50, tool_diversity: 0, message_count: 0, duration_min: 0 };
  const m2 = computeOntologyMetrics(tokenless, maxima);
  assert.equal(m2.scale, 1); // at maxima.scaleCalls → full scale within its own domain
  assert.equal(m2.diversity, 0);

  const empty = { tokens_work: 0, tool_calls: 0 };
  assert.equal(computeOntologyMetrics(empty, maxima).scale, 0);

  assert.deepEqual(computeOntologyMetrics({}, {}), { scale: 0, diversity: 0, structure: 0, density: 0 });

  // log-scale must not crush modest-but-real values toward zero the way a linear/sqrt
  // ratio against a heavy-tailed maximum would (this was the bug: dots all piling up
  // near the origin regardless of real value differences)
  const modest = { tokens_work: 10 };
  const mModest = computeOntologyMetrics(modest, { scaleTokens: 1000 });
  assert.ok(mModest.scale > 10 / 1000, 'log scale should sit well above the raw linear ratio');
});

test('harnessSignature — shape averages + capability rates, tokenful from harnessCaps', async () => {
  const { harnessSignature } = await import('../experience/client-core.mjs');
  const nodes = [
    { harness: 'claude-code', tokens_work: 1000, tool_diversity: 4, ai_title: 'a', branches: ['main'], skills: ['x'], message_count: 10, duration_min: 5 },
    { harness: 'claude-code', tokens_work: 0, tool_calls: 0, tool_diversity: 0, message_count: 0, duration_min: 0 },
    { harness: 'grok', tokens_work: 0, tool_calls: 25, tool_diversity: 2, message_count: 5, duration_min: 5 },
  ];
  const maxima = { diversity: 4, density: 2, scaleTokens: 1000, scaleCalls: 50 };
  const caps = { 'claude-code': true, grok: false };

  const cc = harnessSignature(nodes, 'claude-code', maxima, caps);
  assert.equal(cc.shape.scale, 0.5); // (1 + 0) / 2
  assert.equal(cc.capability.branches, 0.5); // 1 of 2 sessions
  assert.equal(cc.capability.ai_title, 0.5);
  assert.equal(cc.capability.skills, 0.5);
  assert.equal(cc.capability.tokenful, 1);

  const grok = harnessSignature(nodes, 'grok', maxima, caps);
  assert.equal(grok.capability.tokenful, 0);
  assert.equal(grok.capability.branches, 0);

  const empty = harnessSignature(nodes, 'unknown-harness', maxima, caps);
  assert.deepEqual(empty.shape, { scale: 0, diversity: 0, structure: 0, density: 0 });
  assert.deepEqual(empty.capability, { branches: 0, tokenful: 0, skills: 0, ai_title: 0 });
});

test('harnessToolMix — ratio-of-sums across a harness\'s sessions, not average-of-ratios', async () => {
  const { harnessToolMix } = await import('../experience/client-core.mjs');
  const nodes = [
    { harness: 'grok', tool_mix: { read: 8, write: 0, bash_run: 2 } },  // 10 calls
    { harness: 'grok', tool_mix: { read: 0, write: 90, bash_run: 0 } }, // 90 calls — dominates
    { harness: 'pi',   tool_mix: { read: 1 } },
  ];
  const mix = harnessToolMix(nodes, 'grok');
  // totals: read=8, write=90, bash_run=2 → sum=100
  assert.equal(mix.read, 0.08);
  assert.equal(mix.write, 0.9);
  assert.equal(mix.bash_run, 0.02);

  assert.deepEqual(harnessToolMix(nodes, 'no-such-harness'), {});
});
