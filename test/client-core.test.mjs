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
