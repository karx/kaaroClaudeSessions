# Thread View — Accessibility, Readability, Searchability

**Status:** Implemented · **Scope:** `#thread-view` (`experience/client/18-thread-view.js`,
its CSS in `experience/pages/template.html`) — the full-screen conversation-replay
overlay opened via "VIEW THREAD". Continues [docs/PANEL-WCAG-CONTRAST.md](./PANEL-WCAG-CONTRAST.md)'s
audit-then-fix approach, extended to the larger, three-part ask for this view: top
marks on **accessibility** (can everyone read it), **readability** (is the important
thing visually the most prominent thing), and **searchability** (can you find a thing
you remember was said).

## Intent

Thread View is where a session's actual conversation lives — user turns, assistant
turns, tool calls, subagent trees, all replayed in full. Unlike the summary panel
(numbers and labels), most of what's on screen here **is** the content the user opened
this view to read. That raises the bar: if the panel's field labels being too dim was
an annoyance, dim *turn text* in the thread view means the feature doesn't work.

## Approach

### 1. Audit first, same discipline as the panel pass

Every `.thr-*`/`#thr-*` text color was checked against every background it can
actually render on — `.thr-seg` cycles through four permission-mode background colors
(`_MODE_BG` in `18-thread-view.js`: default/plan/acceptEdits/bypassPermissions), so a
color living inside a segment had to clear AA against all four, not just one. The
result: **36 of 44 text/background pairs measured failed WCAG 2.1 AA (4.5:1)** — this
wasn't a few stray colors, the view's entire dim-brown palette was built below the
threshold, including the turn text itself (3.06:1) and the tool-call argument lines
(2.39:1) — exactly the content someone opens this view to read.

### 2. Fix by tier, not by selector

Rather than hand-picking 30+ individual replacement colors, the fix establishes a
small, reused hierarchy (same "color is grammar" instinct as the panel fix):

| Tier | Color | Used for |
|---|---|---|
| Primary content | `#ccccaa` | turn text (user *and* assistant — see below), tool-call args, diff continuation lines |
| Secondary/meta | `#aa8e66` | mode, branch chip, timestamps, durations, badges, tool-call name, subagent id/tools, chrome subtitle/close button |
| Warning/error | `#ff5555` | max-tokens badge, tool error text, diff removals |
| Positive/add | `#00bb55` | diff additions (already `TOOL_COLORS.Write`, reused rather than inventing a new green) |
| Spawn/subagent text | `#ff7799` | roster header, subagent type/mark — a lighter tint of the existing `--k-spawn` crimson, which itself stays on borders/marks (decorative, not text, so it's fine at its original saturation) |

Every one of these was computed against the *worst-case* background it renders on
(script-verified during the pass, not eyeballed) with a comfortable margin (≥5.4:1 in
every case) rather than skimming just over 4.5.

### 3. User/assistant turn text is unified, not tiered

The old CSS gave assistant turn text an even *lower*-contrast override
(`.thr-turn-asst .thr-turn-text { color:#5a462a }`, 2.24:1) than the already-failing
user color. Turn text is the primary content of this view — de-emphasizing either
role's text fights the "readability" ask directly. The actor badge above each turn
(`USER`/`ASST`, now amber/green, own high-contrast chip) already carries the role
distinction; the message body itself is one bright, equally-readable color for both.
`test/thread-contrast.test.mjs` asserts there's no reintroduced per-role override.

### 4. Tool identity moves from text color to a swatch dot

`.thr-tc-name` (the tool name — "Bash", "Grep", …) was colored per-tool
(`TOOL_COLORS`), directly as text on a near-black background. Several of those hues
(purple, dark blue, dark red) can't reach 4.5:1 no matter how the background is tuned
— they're saturated *fills*, not text-safe tones, and were never meant to be read as
text color. Fixed by decoupling identity from legibility: a small `.thr-tc-dot`
swatch (still the tool's real color) sits before the name, and the name text itself
is the fixed, always-readable secondary tone. This is also a straight WCAG 1.4.1 (use
of color) improvement — tool identity no longer depends on a reader distinguishing
saturated hues at 8px.

The one place color *is* the text (the composition bar's `.thr-bar-lbl`, white text
directly on a saturated tool-color fill) got a different fix: `readableTextOn(hex)`
(new in `experience/client-core.mjs`) picks full-opacity black or white per swatch,
replacing a fixed `rgba(255,255,255,.75)` that was unreadable on brighter fills
(Edit's yellow: 1.86:1) and merely adequate on darker ones.

### 5. Two small readability fixes worth calling out

- `.thr-tc-err` set `opacity:0.8` on the whole error-flagged row. Verified
  numerically: that composites the fixed tier colors back down to 4.35–4.43:1 —
  *under* AA again, silently, for every error row. Removed; the row is already
  visually flagged by its own red `.thr-tc-errtxt`.
- `.thr-clbl` (the "⟲ context reset" divider label) was the one 7px text in the view.
  Bumped to 8px to match every other meta label — WCAG doesn't mandate a minimum
  size, but 7px was an outlier for no reason tied to the design.

### 6. Searchability — find-in-thread

Thread View had no way to search. Added one, wired through the existing render
pipeline rather than bolting on a second one:

- **`experience/client-core.mjs`**: `escapeRegExp`, `highlightMatches(text, query,
  escapeFn)`, `countMatches` — pure, unit-tested (case-insensitive literal match,
  query treated as text not regex, wraps hits in `<mark class="thr-hit">`). Lives here
  because it's the established home for pure logic shared into the browser bundle
  (same pattern as `TOOL_COLORS`, `blockGeom`, etc. — tested via Node, injected via
  `%%CLIENT_CORE%%`).
- **`18-thread-view.js`**: every place that already escapes searchable text (turn
  text, tool-call name/args/continuation lines, subagent type/description) now routes
  through a local `_hl(text)` wrapper instead of calling `esc()` directly. When no
  query is active `_hl` is `esc()` with extra steps (verified: empty-query path
  returns identical output). When a query is active, the *entire thread re-renders*
  through the same `_render()` used for the initial load — reusing `_lastData`/
  `_lastNode` cached from the fetch, no network round-trip — so highlighting is exact
  and doesn't need a second, DOM-walking implementation. Typing is debounced 120ms.
- A search bar sits in `#thr-chrome`: an input (`/` focuses it while the overlay is
  open), a live match counter (`N / total`), and prev/next buttons. Enter / Shift+Enter
  step between matches with `scrollIntoView({block:'center'})`; the current match gets
  a second, brighter mark style (`.thr-hit-current`, solid amber) so it's findable at a
  glance against the plain highlight color.
- Escape is now two-stage: with the search box focused and non-empty it clears the
  search first (matching the "Escape backs out one step" convention most find-in-page
  UIs use); a second Escape (or Escape when search is already empty) closes the
  overlay, same as before.

### 7. Accessibility semantics beyond color

- `#thread-view` gained `role="dialog"`, `aria-modal="true"`, `aria-label="Session
  thread"`, and `tabindex="-1"` so it's an announced, focusable landmark rather than
  an anonymous full-screen `<div>`.
- Opening the thread moves focus into the dialog (`ov.focus()`) and remembers the
  triggering "VIEW THREAD ▸" button; closing restores focus there — without this, a
  keyboard/screen-reader user who opens a thread has no way back to their place in the
  panel.
- The close button, search input, and prev/next buttons all carry explicit
  `aria-label`s; the match counter is `aria-live="polite"` so a screen reader
  announces "3 / 27" as the user navigates matches, without needing to re-read the
  whole bar.

## Verification

- `test/thread-contrast.test.mjs` — parses every selector above out of the live
  `template.html` CSS and asserts ≥4.5:1 against every background it can render on
  (33 cases derived directly from the audit), plus two structural guards (no
  opacity-dimmed error rows, no reintroduced per-role turn-text override).
- `test/client-core.test.mjs` — unit tests for `highlightMatches`/`countMatches`/
  `escapeRegExp` and `relativeLuminance`/`readableTextOn`, including a cross-check
  that the duplicated luminance formula agrees with `experience/wcag-contrast.mjs`.
- `test/build-template.test.mjs` gained a guard discovered *while building this
  feature*: a documentation comment in `18-thread-view.js` happened to contain the
  literal text `%%CLIENT_CORE%%`, which `build.mjs`'s single-pass substitution matched
  and replaced with a second full copy of `client-core.mjs`, corrupting the bundle
  (a redeclared-`const` syntax error, caught by extracting and `node --check`-ing the
  built page). Fixed, and a new test scans `experience/client/*.js` for any
  `%%WORD%%`-shaped text that isn't one of the keys `build.mjs` actually substitutes
  there — so a future comment can't silently do the same thing again.
- Full suite green (1822 tests) after every change in this pass.

## Out of scope / follow-up

- **Session/project accent colors** (`.thr-wn`, `.thr-seg` border-left — the "W1",
  "W2" window-number label and segment border use the session's own accent color,
  drawn from the same project-color system used across the whole app). Not audited
  here — it's a shared identity-color system, not thread-view-specific, and a fix
  belongs with its own pass across every surface that uses it (same reasoning as
  leaving `--k-dim` untouched in the panel pass).
- **Browser verification**: this pass was verified by contrast math (script-checked
  against the real formula) and the full test suite, not a live screenshot — the
  devtools browser connection was unavailable for the second half of this session.
  Worth a visual pass (search bar layout, `<mark>` legibility in context, focus ring
  visibility) before calling this fully closed.
