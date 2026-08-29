import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeLuminance, contrastRatio } from '../experience/wcag-contrast.mjs';

test('relativeLuminance — black is 0, white is 1', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
});

test('contrastRatio — black on white is 21:1 (W3C max)', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
});

test('contrastRatio — identical colors is 1:1', () => {
  assert.equal(contrastRatio('#445544', '#445544'), 1);
});

test('contrastRatio — order-independent (fg/bg swap gives same ratio)', () => {
  const a = contrastRatio('#e0d3c0', '#08080f');
  const b = contrastRatio('#08080f', '#e0d3c0');
  assert.equal(a, b);
});

test('contrastRatio — W3C worked example #767676 on #ffffff is ~4.54:1', () => {
  // https://www.w3.org/WAI/GL/wiki/Relative_luminance worked example
  assert.ok(Math.abs(contrastRatio('#767676', '#ffffff') - 4.54) < 0.05);
});

test('contrastRatio — accepts 3-digit and 6-digit hex, with or without #', () => {
  assert.equal(contrastRatio('#fff', '#000'), contrastRatio('#ffffff', '#000000'));
  assert.equal(contrastRatio('fff', '000'), contrastRatio('#ffffff', '#000000'));
});
