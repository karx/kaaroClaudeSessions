/**
 * test/panel-contrast.test.mjs — the #panel WCAG guard (docs/PANEL-WCAG-CONTRAST.md).
 * Parses the actual selector colors out of the template's <style> block and asserts
 * every panel text role clears WCAG 2.1 AA (4.5:1) against the panel background —
 * all panel text is 9-13px, so no large-text 3:1 carve-out applies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contrastRatio } from '../experience/wcag-contrast.mjs';
import { TOKENS } from '../experience/design-tokens.mjs';

const AA_NORMAL_TEXT = 4.5;
// #panel background is rgba(8,8,16,.96) over the #000000 page — effectively #08080f,
// close enough to --k-panel that the two are interchangeable for this purpose.
const PANEL_BG = '#08080f';

const css = fs.readFileSync('experience/pages/template.html', 'utf8');

function colorOf(selector) {
  const re = new RegExp(selector.replace(/[.#]/g, '\\$&') + '\\s*\\{[^}]*?color:\\s*(var\\(--k-[a-z]+\\)|#[0-9a-fA-F]{3,6})', 's');
  const m = css.match(re);
  assert.ok(m, `no color: declaration found for ${selector}`);
  const raw = m[1];
  const tokenMatch = raw.match(/^var\(--k-([a-z]+)\)$/);
  return tokenMatch ? TOKENS[tokenMatch[1]] : raw;
}

const PANEL_TEXT_SELECTORS = ['.pk', '.pv', '.pmsg', '.pai-title', '.p-section-hd', '.paction', '#panel-x'];

for (const sel of PANEL_TEXT_SELECTORS) {
  test(`panel text ${sel} clears WCAG AA (4.5:1) against the panel background`, () => {
    const color = colorOf(sel);
    const ratio = contrastRatio(color, PANEL_BG);
    assert.ok(
      ratio >= AA_NORMAL_TEXT,
      `${sel} (${color}) is ${ratio.toFixed(2)}:1 against ${PANEL_BG}, needs >= ${AA_NORMAL_TEXT}:1`
    );
  });
}
