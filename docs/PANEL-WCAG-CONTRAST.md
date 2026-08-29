# Session Details Panel — WCAG Contrast Pass

**Status:** Implemented · **Scope:** `#panel` only (the detail panel opened by clicking a
session/project/file/cluster/subagent node), not the app-wide `--k-dim` token.

## Intent

The detail panel is Register A's densest read surface — a stack of `.prow` label/value
pairs, section headers, buttons, and a subtitle, all rendered as plain-text passthrough
of the node object (see `experience/client/05-interaction.js:266` `showPanel`). Several
of its text colors were picked for the "dim terminal" mood without checking contrast
against the panel's near-black background, so parts of the panel are hard to read —
worse than intended, not by design. This pass measures every text color actually used
in `#panel` and brings the ones that fail WCAG 2.1 SC 1.4.3 (4.5:1 for normal text — all
panel text is 9–13px, so no large-text carve-out applies) up to a passing ratio, while
keeping the "dim = lower emphasis" grammar the panel already speaks (`kaaro-design`:
color is grammar, one meaning per hue).

## Approach

1. **Measure before touching anything.** Add a pure, tested WCAG contrast utility
   (`experience/wcag-contrast.mjs`) rather than eyeballing hexes. It's a general-purpose
   function (relative luminance + contrast ratio per the W3C formula), useful beyond
   this one panel, so it lives in `experience/` like the other pure transform modules
   (`graph-data.mjs`, `session-clusters.mjs`) and is unit-tested against the W3C spec's
   own worked examples.
2. **Audit every panel text/background pair**, computed against the panel's actual
   composited background (`rgba(8,8,16,.96)` over the `#000000` page ⇒ effectively
   `#08080f`, luminance ≈ 0.0026 — close enough to the `--k-panel` token that the two
   are interchangeable for this purpose):

   | Selector | Color | Role | Contrast vs panel bg | WCAG AA (4.5:1) |
   |---|---|---|---|---|
   | `.pv` | `#e0d3c0` | field values | 13.6:1 | pass |
   | `.pmsg` | `#aa8e66` | first-message / cluster-id text | 6.5:1 | pass |
   | `.ptag` | `#ccb088` on `#302e1a` | skill/branch chips | high | pass |
   | `.pk` | `var(--k-dim)` `#445544` | **every field label** (Date, Model, Consumption, …) | 2.4:1 | **fail** |
   | `.p-section-hd` | `#5a462a` | section headers (◆ HARNESSES, ◆ SUBAGENTS, …) | 2.2:1 | **fail** |
   | `.pai-title` | `#665133` | AI-title subtitle under the `<h3>` | 2.7:1 | **fail** |
   | `.paction` (base) | `#886c44` on `#1e1c0a` | button label (COPY RESUME PROMPT, SHARE CARD, …) | 3.5:1 | **fail** |
   | `#panel-x` | `#443d33` | close (✕) control | 1.9:1 | **fail** |

   Five of eight text roles in the panel fail — including `.pk`, which appears in
   nearly every row the panel renders, and the two buttons every session panel ends
   with.

3. **Fix by reusing existing colors, not inventing new ones.** Per `kaaro-design`
   ("no new abstractions unless ≥3 uses" / color is grammar), the fix pulls from colors
   already proven in this codebase rather than picking fresh hexes:
   - `.pk`, `.pai-title`, `.paction` (base), `#panel-x` → `#aa8e66` (the existing
     `.pmsg` color — already a vetted "readable but subordinate" tone at 6.5:1, now the
     single "secondary panel text" color instead of four different near-invisible
     ones).
   - `.p-section-hd` → `var(--k-label)` (`#ffaa00`, amber — the token the design system
     already assigns to "labels, identifiers, field names," which is exactly what a
     section header is; 10:1).

   This collapses five failing, mutually-inconsistent dim tones into two colors that
   already exist elsewhere on the page, both passing AA with margin.
4. **Do not touch `--k-dim` itself.** The token is used well beyond the panel (topbar
   nav links, `.k-btn` chrome, inactive states across every page) and also fails AA
   against the chrome backgrounds it's used on — but that's a separate, app-wide
   finding out of scope for a panel-focused pass. Fixing the token itself risks
   rippling into surfaces nobody asked to change today. Left as a follow-up (see
   below).
5. **Lock the result with a test, not just a screenshot.** `test/panel-contrast.test.mjs`
   parses the actual selectors out of `experience/pages/template.html`'s `<style>`
   block and asserts each one clears 4.5:1 against the panel background — so a future
   edit that reintroduces a low-contrast panel color fails CI the same way
   `test/design-lint.test.mjs` already catches blue-chrome regressions.

## Out of scope / follow-up

- **`--k-dim` (`#445544`) app-wide.** Fails AA against `--k-bg`/`--k-panel`/`--k-card`
  (2.3–2.6:1) everywhere it's used as text (topbar `a` links, etc.), not just the
  panel. A token-level fix touches every page and deserves its own pass + visual
  review, not a drive-by here.
- **`experience/wcag-contrast.mjs` is a general utility** — worth reusing for other
  registers (Register B / art-of-intent) or a repo-wide contrast lint if that's ever
  wanted, but this change only wires it into the one test that motivated writing it.
