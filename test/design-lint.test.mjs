/**
 * test/design-lint.test.mjs — the Register A grammar guard.
 *
 * Keeps the experience layer on the kaaro terminal register:
 *  - page CSS may not reintroduce blue-family chrome (the old navy identity)
 *  - no box-shadow / gradients / radius > 2px / transitions > 250ms
 *  - the retired chrome hexes may not reappear in client JS (data palettes
 *    like BRANCH_PALETTE / EDGE_COLORS / DAW lanes are exempt by design —
 *    they encode data, not chrome)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PAGES = [
  'experience/pages/template.html',
  'experience/pages/daw-template.html',
  'experience/pages/now.html',
  'experience/pages/home.html',
];

function hue(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return { h: 0, s: 0 };
  const d = max - min;
  const l = (max + min) / 2;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s };
}

function styleBlock(html) {
  const start = html.indexOf('<style>');
  const end = html.indexOf('</style>');
  return start >= 0 && end > start ? html.slice(start, end) : '';
}

test('page CSS — no blue-family chrome (the navy identity stays retired)', () => {
  for (const p of PAGES) {
    const css = styleBlock(fs.readFileSync(p, 'utf8'));
    const offenders = [...new Set(
      [...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0].toLowerCase())
        .filter(hex => { const { h, s } = hue(hex); return s >= 0.06 && h >= 190 && h <= 268; })
    )];
    assert.deepEqual(offenders, [], `${p}: blue chrome hexes: ${offenders.join(', ')}`);
  }
});

test('page CSS — no shadows, gradients, large radii, or slow transitions', () => {
  for (const p of PAGES) {
    const css = styleBlock(fs.readFileSync(p, 'utf8'));
    assert.ok(!/box-shadow/.test(css), `${p}: box-shadow`);
    assert.ok(!/linear-gradient|radial-gradient/.test(css), `${p}: gradient`);
    const badRadii = [...css.matchAll(/border-radius:\s*([0-9.]+)px/g)]
      .filter(m => parseFloat(m[1]) > 2);
    assert.deepEqual(badRadii.map(m => m[0]), [], `${p}: radius > 2px`);
    const slow = [...css.matchAll(/transition:[^;]*?([0-9.]+)s/g)]
      .filter(m => parseFloat(m[1]) > 0.25);
    assert.deepEqual(slow.map(m => m[0]), [], `${p}: transition > 250ms`);
  }
});

test('home.html — ME then city field then the three view tiles', () => {
  const html = fs.readFileSync('experience/pages/home.html', 'utf8');
  const me = html.indexOf('id="me-hero"');
  const tiles = html.indexOf('id="tiles"');
  const field = html.indexOf('id="glyph-field"');
  assert.ok(me >= 0, 'me-hero mount exists');
  assert.ok(field > me, 'city field sits under ME');
  assert.ok(tiles > field, 'tiles sit under the city');
  const tag = html.slice(me, html.indexOf('>', me) + 1);
  assert.equal(/hidden/.test(tag), false, 'ME is visible on first paint, not hidden until fetch');
});

test('client JS — retired chrome hexes do not reappear', () => {
  const RETIRED = [
    '#4455cc', '#1c1c34', '#0e0e22', '#2a2a44', '#2a3050', '#8899cc',
    '#9aa0b8', '#aabbff', '#080810', '#080814', '#2a3a5a', '#2a3080',
  ];
  const dir = 'experience/client';
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase();
    const found = RETIRED.filter(hex => src.includes(hex));
    assert.deepEqual(found, [], `${f}: retired chrome hex(es): ${found.join(', ')}`);
  }
});
