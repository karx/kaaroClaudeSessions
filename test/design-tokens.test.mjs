/**
 * test/design-tokens.test.mjs → experience/design-tokens.mjs
 *
 * Register A (kaaro financial-terminal) design tokens: the single color/type
 * source for every page. tokensToCss() renders the :root custom-property
 * block + base chrome; KAARO_TOKENS reaches canvas JS via build injection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKENS, tokensToCss } from '../experience/design-tokens.mjs';

test('TOKENS — Register A semantic roles present, valid hex', () => {
  const required = [
    'bg', 'panel', 'card', 'border', 'accent', 'label', 'data',
    'select', 'geo', 'dim', 'body', 'err',
  ];
  for (const k of required) {
    assert.ok(TOKENS[k], `missing token: ${k}`);
    assert.match(TOKENS[k], /^#[0-9a-f]{6}$/i, `${k} must be 6-digit hex`);
  }
});

test('TOKENS — Register A anchor values', () => {
  assert.equal(TOKENS.bg, '#000000', 'pure black canvas');
  assert.equal(TOKENS.accent, '#ff6600', 'orange primary');
  assert.equal(TOKENS.label, '#ffaa00', 'amber labels');
  assert.equal(TOKENS.select, '#00cccc', 'cyan selection');
  assert.equal(TOKENS.geo, '#00ff88', 'green positive/live');
});

test('tokensToCss — :root custom properties for every token', () => {
  const css = tokensToCss();
  assert.ok(css.includes(':root'));
  for (const [k, v] of Object.entries(TOKENS)) {
    assert.ok(css.includes(`--k-${k}: ${v}`), `--k-${k} missing`);
  }
});

test('tokensToCss — monospace type, no banned constructs', () => {
  const css = tokensToCss();
  assert.ok(/IBM Plex Mono/.test(css), 'IBM Plex Mono stack');
  assert.ok(!/box-shadow/.test(css), 'no box-shadow');
  assert.ok(!/linear-gradient/.test(css), 'no gradients');
  assert.ok(!/border-radius:\s*(?!0|1px|2px)/.test(css), 'radius ≤ 2px');
});
