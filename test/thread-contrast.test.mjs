/**
 * test/thread-contrast.test.mjs — the Thread View WCAG guard
 * (docs/THREAD-VIEW-ACCESSIBILITY.md).
 *
 * Thread View (#thread-view, experience/client/18-thread-view.js) renders
 * turns inside a segment block whose background is one of four permission-mode
 * colors (_MODE_BG in 18-thread-view.js), plus a handful of own-background
 * chips (actor badges, branch chip, subagent roster/tree, chrome bar). This
 * parses each selector's declared color out of template.html and asserts it
 * clears WCAG 2.1 AA (4.5:1) against every background it can actually render
 * on — all thread-view text is 8-11px, so no large-text 3:1 carve-out applies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contrastRatio } from '../experience/wcag-contrast.mjs';

const AA = 4.5;
const css = fs.readFileSync('experience/pages/template.html', 'utf8');

// _MODE_BG from experience/client/18-thread-view.js — every .thr-seg (and
// everything inside it) renders on one of these four.
const SEG_BGS = ['#050810', '#06050e', '#0b0700', '#0b0404'];
const OVERLAY = '#0a0902';   // #thread-view background (legend, compact divider, loading/err)
const CHROME  = '#100f03';   // #thr-chrome background
const BRANCH_CHIP = '#181605';
const ROSTER  = '#0a0408';
const SUBAGENT = '#08040a';
const ACTOR_USER_CHIP = '#2a2000';
const ACTOR_ASST_CHIP = '#04160c';
const PACTION_BASE = '#1e1c0a'; // .paction background (experience/pages/template.html)

function colorOf(selector) {
  const esc = selector.replace(/[.#]/g, '\\$&');
  const re = new RegExp(esc + '(?:\\s*,[^{]*)?\\s*\\{[^}]*?\\bcolor:\\s*(#[0-9a-fA-F]{3,6})', 's');
  const m = css.match(re);
  assert.ok(m, `no color: declaration found for ${selector}`);
  return m[1];
}

const CASES = [
  ['.thr-mode', [SEG_BGS]],
  ['.thr-meta', [SEG_BGS]],
  ['.thr-badges', [SEG_BGS]],
  ['.thr-turn-ts', [SEG_BGS]],
  ['.thr-thinking', [SEG_BGS]],
  ['.thr-dur', [SEG_BGS]],
  ['.thr-maxtok', [SEG_BGS]],
  ['.thr-turn-text', [SEG_BGS]],
  ['.thr-truncated', [SEG_BGS]],
  ['.thr-tc-arg', [SEG_BGS]],
  ['.thr-tc-contline', [SEG_BGS]],
  ['.thr-tc-errtxt', [SEG_BGS]],
  ['.thr-tc-del', [SEG_BGS]],
  ['.thr-tc-add', [SEG_BGS]],
  ['.thr-tc-name', [SEG_BGS]],
  ['.thr-legend-lbl', [[OVERLAY]]],
  ['.thr-loading', [[OVERLAY]]],
  ['.thr-clbl', [[OVERLAY]]],
  ['#thr-chrome-ait', [[CHROME]]],
  ['#thr-close-btn', [[CHROME]]],
  ['.thr-branch', [[BRANCH_CHIP]]],
  ['.thr-actor-user', [[ACTOR_USER_CHIP]]],
  ['.thr-actor-asst', [[ACTOR_ASST_CHIP]]],
  ['.thr-roster-hd', [[ROSTER]]],
  ['.thr-sub-type', [[SUBAGENT]]],
  ['.thr-sub-mark', [[SUBAGENT]]],
  ['.thr-sub-id', [[SUBAGENT]]],
  ['.thr-sub-tools', [[SUBAGENT]]],
  ['.thr-sub-unlinked', [[SUBAGENT]]],
  ['.thr-sub-empty', [[SUBAGENT]]],
  ['.paction-thread', [[PACTION_BASE]]],
];

for (const [sel, [bgs]] of CASES) {
  test(`thread-view ${sel} clears WCAG AA (4.5:1) against every background it renders on`, () => {
    const color = colorOf(sel);
    const worst = Math.min(...bgs.map(bg => contrastRatio(color, bg)));
    assert.ok(
      worst >= AA,
      `${sel} (${color}) is ${worst.toFixed(2)}:1 in its worst case, needs >= ${AA}:1`
    );
  });
}

test('.thr-tc-err does not dim its row with opacity (would drag fixed colors back under AA)', () => {
  const m = css.match(/\.thr-tc-err\s*\{([^}]*)\}/s);
  if (!m) return; // no rule at all — nothing to dim with
  assert.ok(!/opacity\s*:/.test(m[1]), '.thr-tc-err must not set opacity — it composites text colors below AA');
});

test('.thr-turn-text does not have a separate lower-contrast assistant override', () => {
  assert.ok(
    !/\.thr-turn-asst\s+\.thr-turn-text\s*\{/.test(css),
    'a per-role .thr-turn-text color override reintroduces a two-tier (one likely non-AA) turn-text color',
  );
});
