# RFC: Share Cards

**Project:** kaaroSessions
**Status:** Implemented (`d38c125`, `659b2d1` on `worktree-sharability`)
**Date:** 2026-08-28
**Relates to:** `/share-card` skill contract · Register A design tokens (`experience/design-tokens.mjs`) · project/ME hex glyphs ([RFC-project-glyphs.md](./RFC-project-glyphs.md), [RFC-project-glyph-grid.md](./RFC-project-glyph-grid.md)) · context-window trace (`hooks/trace-tree.mjs`, `/api/trace`, `experience/client/17-trace-panel.js`)
**Grounding:** live `sessions-data.json` on the authoring machine (2026-08-28) — 122 sessions, 25 projects, 7 harnesses

---

## 1. Problem

kaaroSessions is a private, local-only observability surface — nothing in it could leave the machine as an artifact. Three distinct things were worth sharing, each with its own answer to the `/share-card` skill's "name the artifact" question:

| Artifact | What it features |
|---|---|
| a single session run | context-window strip + token totals |
| a single project | harness breakdown |
| the whole multi-project canvas | "what does my AI usage even look like" |

Constraint that shapes the whole design: kaaroSessions has no backend and no hosting. Art of Intent's reference implementation carries a `#r=` result token in a shareable URL; kaaroSessions has nowhere to put one. The **card is the artifact**, not a link to one — `buildShareText()` never fabricates a public URL.

---

## 2. Goals

1. One assembler per artifact (`buildShareCardData` / `buildProjectShareCardData` / `buildUsageShareCardData`) — pure, Node-tested, the single source preview/share/download all call (skill contract step 3; "do not add a second assembler").
2. One renderer per artifact (`generateShareCardSVG` / `generateProjectShareCardSVG` / `generateUsageShareCardSVG`) — pure, 1200×630, Register A tokens only, `esc()` on every user string, fixed monospace font.
3. Raster + share glue (`svgToPNG`, `downloadCard`, `shareCard`) lives in the same file as the pure functions, matching the existing `experience/client-core.mjs` pattern (Node-tested where possible; the DOM/canvas paths themselves are exercised live in-browser, not unit-tested — see §8).
4. Reuse the existing Register A primitives instead of inventing new ones: `hexPath`, `harnessWedges`, `projectGlyphMarkup`, `meGlyph`/`meGlyphMarkup`, `glyphSpiralCell`/`glyphCellPosition` (all pre-existing, from the project-glyph RFCs).

Non-goals:
- A hosted/public result page or deep link.
- A second assembler per card kind.
- Session-level replacement of the existing Context Window Trace Panel (`17-trace-panel.js`) — the share card's strip is a smaller, independent read of the same `/api/trace` data (see §3.2).

---

## 3. Design

### 3.1 Shared chrome

All three cards are 1200×630 with identical header/divider/footer/stat-column geometry, factored once so a fourth card kind stays cheap:

```
_shareGeom()                     → { width, height, headerH, footerH, bodyTop, bodyBot, dividerX, leftPad, rightPad }
_shareHeader(g, {kicker, dateRight, subRight})
_shareDivider(g)
_shareFooter(g, {tagLine, footerRightLabel})
_shareStatRows(stats, g, startY?)
```

`SHARE_CARD_TOKENS` mirrors `experience/design-tokens.mjs` verbatim rather than importing it — `client-core.mjs` has no import graph (it is injected as plain script into every page bundle via `%%CLIENT_CORE%%`), so the palette is intentionally duplicated, same as `TOOL_COLORS` already is in that file.

### 3.2 Session card

`buildShareCardData(node, {projectLabel, traceSegments})` → `generateShareCardSVG`. Features the context-window strip: `contextStripSegments()` reduces `/api/trace/:id` segments into proportional-width, dominant-tool-colored strips — a smaller, independent read of the same data the Context Window Trace Panel already renders, not a shared component (that panel isn't Node-tested; the card needed a pure, testable version). `dominantTool()` (the "highest-count `tool_summary` entry" rule) is shared between the two — see §4.

Trace segments are optional: `window._traceCache` (shared with `17-trace-panel.js` / `18-thread-view.js`) is checked first; a cache miss fetches `/api/trace/:id` on demand. No segments → the card falls back to one placeholder strip sized by `tokens_work`.

### 3.3 Project card

`buildProjectShareCardData(node, {harnessRows})` → `generateProjectShareCardSVG`. Features a harness-breakdown bar chart (`harnessBreakdown(node.harnesses, sessions)`, computed by the caller from `neighbours(node.id)` — the same helper `showPanel()`'s project branch already uses).

### 3.4 Full-canvas card — three iterations

This one went through three shapes in one session, each driven by direct user feedback rather than upfront spec — worth recording because the final layout only makes sense in light of what it replaced.

**v1 — Project Constellation.** One hex per project (`projectGlyphMarkup`, wedge-filled by harness, sized by `sizeNorm`), spiral-packed (`glyphSpiralCell`/`glyphCellPosition`) around the ME glyph (`meGlyphMarkup`) at the true center. Chosen over two alternatives — an "Activity Trace" contribution-graph strip, and an "Encoded Fingerprint" hash-seeded abstract mosaic — via `AskUserQuestion` with rendered ASCII previews of all three; Project Constellation won because it's the truest read of "Full Usage Canvas": the graph *is* the canvas.

Bug found and fixed in v1: the ME hex, sized bigger than the project pitch to read as a hero, geometrically overlapped ring-1 neighbors and painted *underneath* them (document order = paint order in SVG) — a color collision, not a medallion. Fixed by painting ME last with a solid backing disc that clears whatever's behind it first.

**v2 — Session Mosaic.** User feedback: "the count of individual sessions is important intelligence report" — 25 project hexes couldn't show that 122 sessions happened. Swapped the field's unit from project to session: one small hex per session, colored by its project, sized by `tool_diversity`, and moved the ME glyph off-center into the right column as a hero portrait above the stats (introducing the `startY` parameter on `_shareStatRows` to push the stat rows down below it).

**v3 (final) — Project & Session Constellation.** User feedback: show *both* — hexes for projects, balls for sessions, layered on one field — and move ME to "the right half of right, vertically centered," bigger and more prominent. Final field layout:

- **Balls** (session texture, background): one per session (capped at 200), pitch and radius computed to *fill* the field rather than just avoid overlap (`_fillRadius(n, targetRadius, {minR, maxR})` picks a pitch so the minimal spiral ring count for `n` items reaches roughly `targetRadius`), sized by `tool_diversity` normalized against the shown set's max.
- **Hexes** (project landmarks, foreground, capped at 60): same `_fillRadius` idea at a bigger radius band, painted after the balls with a solid backing circle each so they read as clean landmarks instead of blending into the ball texture underneath.
- **ME hero**: `meCenterX = rightPad + (rightColW) * 0.72` (right half of the right column), `meCenterY = (bodyTop + bodyBot) / 2` (vertically centered in the body — independent of the stat column above it, which stays top-anchored at its original position now that ME no longer displaces it), `meR = 56` (up from 30 in v2) with a solid backing disc + accent ring, same medallion technique as the v1 fix.

Both project and session counts sort sessions by their project's `tokens_total` descending, so a project's session-balls conceptually rank near their own hex even though the two use independent spirals sharing one center (deliberate — an exact positional correspondence wasn't requested and would have meant coupling two different-density spirals).

Caption: `◆ hex = project · ball = session · size = activity`, with `+N projects` / `+N sessions` appended only past either cap.

### 3.5 A build-pipeline bug found along the way

`build.mjs`'s `stripExports()` — which turns `client-core.mjs`'s ES-module `export function`/`export const` into plain-script declarations for injection into every page — didn't recognize `export async function`. The first `async` export (`svgToPNG`) shipped a bare `export` token into the classic `<script>` tag, throwing `Uncaught SyntaxError` and silently breaking *the entire page*, not just the share-card feature (confirmed live: every global — `GRAPH`, `showPanel`, `nodeById` — came back `undefined`). Fixed the regex (`^export (async function|function|const)`) and added a regression test (`test/build-template.test.mjs`).

---

## 4. Post-hoc review fixes

A `/code-review medium` pass on the landed commit (`d38c125`) found two issues, fixed in `659b2d1`:

1. **Inconsistent escaping contract.** `_shareFooter()` interpolated `tagLine` raw while its sibling field `footerRightLabel` went through `esc()`. Not exploitable in the landed code (every caller happened to pre-escape its skill tags before passing them in), but the contract itself was wrong — the next caller to pass a raw string would inject unescaped markup into the generated SVG. Fixed by moving escaping into `_shareFooter` (the single point, matching `footerRightLabel`) and un-escaping at the call sites so nothing double-escapes.
2. **Duplicated dominant-tool logic.** `contextStripSegments()` re-implemented "highest-count `tool_summary` entry," already living as `_domTool()` in `17-trace-panel.js`. Extracted the shared rule as `dominantTool()` in `client-core.mjs`; the panel's `_domTool()` now delegates to it, so the panel and the share card can't quietly disagree on which tool colors a context window.

---

## 5. Alternatives rejected

| Option | Why not |
|---|---|
| Activity Trace (contribution-graph strip) for the full-canvas card | Less true to "Full Usage Canvas" than a spatial constellation; the graph view already *is* a canvas |
| Encoded Fingerprint (hash-seeded abstract mosaic) | Collectible, but throws away the actual project/harness/session structure the tool exists to show |
| A shared `<Component>` between the trace panel and the share-card strip | The panel (`17-trace-panel.js`) isn't Node-tested browser-DOM code; the card needed a pure function. Shared the *rule* (`dominantTool`), not the renderer |
| Exact positional correspondence between a project's hex and its session balls | Requires coupling two different-density spirals to one project-scoped sub-layout; not requested, adds real complexity for a cosmetic gain |
| A live deep-link (`#`-token result URL) | No backend/hosting for kaaroSessions; would be a fabricated link that reconstructs nothing |

---

## 6. Files

| File | Role |
|---|---|
| `experience/client-core.mjs` | all pure assemblers/renderers (`buildShareCardData`, `buildProjectShareCardData`, `buildUsageShareCardData`, `generate*ShareCardSVG`, `buildShareText`, `dominantTool`, `contextStripSegments`) + raster/share glue (`svgToPNG`, `downloadCard`, `shareCard`) |
| `experience/client/21-share-card.js` | browser wiring: three click triggers, trace-segment fetch/cache, preview overlay |
| `experience/client/05-interaction.js` | `data-share` / `data-share-project` buttons in the session/project panels |
| `experience/client/17-trace-panel.js` | `_domTool()` now delegates to the shared `dominantTool()` |
| `experience/pages/template.html` | `#me-share-btn` in the sidebar ME widget |
| `build.mjs` | `stripExports()` regex fix |
| `test/client-core.test.mjs` | all pure-function tests (24 new) |
| `test/build-template.test.mjs` | `stripExports` async-export regression test |

No `experience/` → `hooks/` imports; no new deps.

---

## 7. Key decisions

1. **The card is the artifact — no fabricated share URL.** kaaroSessions has no backend to back one.
2. **One assembler, one renderer, per artifact kind.** Preview, share, and download all call the same pair.
3. **Shared chrome, independent bodies.** `_shareGeom`/`_shareHeader`/`_shareDivider`/`_shareFooter`/`_shareStatRows` factor the frame; each card's field/body logic stays separate rather than forcing a common layout abstraction across three genuinely different artifacts.
4. **Share the rule, not the renderer, between the trace panel and the session card.** `dominantTool()` is shared; the strip-rendering itself isn't, because one side is Node-tested pure code and the other is untested browser DOM.
5. **Full-canvas card layers two independent spirals on one center** rather than one combined layout — simpler, and the visual result (landmarks over texture) doesn't need exact correspondence to read correctly.
6. **`export async function` support in `stripExports()`** is now part of the client-core build contract, not just an async-inspired one-off — the next async export won't repeat this outage.

---

## 8. Open questions

1. **`experience/client/21-share-card.js`'s DOM/canvas glue has no automated regression net.** It's covered by the documented `experience/client/*.js` coverage gap (CLAUDE.md) — verified live via browser smoke tests in this session (chrome-devtools MCP), not by `node --test`. Worth deciding whether this class of code stays permanently browser-only-verified or gets a jsdom-based test lane at some point.
2. **`CONSTELLATION_MAX_PROJECTS` (60) / `MOSAIC_MAX_SESSIONS` (200) caps** are untested against a real power-user history well past either cap — the overflow caption (`+N projects`/`+N sessions`) is unit-tested with synthetic data but not eyeballed at, say, 500 sessions.
3. **`git remote` for this repo points at `karx/kaaroClaudeSessions.git`; GitHub reports it moved to `karx/kaaroSessions.git`.** Push still succeeds via redirect but is worth fixing before that stops working. Unrelated to share cards, surfaced during this work.
4. **A fourth "reference image" for the full-canvas layout was mentioned by the user but never actually attached** — the final v3 layout (right-half, vertically-centered, more-prominent ME hex) was built from the text description alone and confirmed against a live screenshot, not against the intended reference image.

---

## 9. Success

- `node --test`: 1676/1676 passing.
- All three card kinds render correctly against live `sessions-data.json` in a real browser (chrome-devtools MCP), including the Share/Save → raster → download path completing without a console error.
- The trace panel (`17-trace-panel.js`) still colors context-window strips correctly after delegating to the shared `dominantTool()`.
- No page-wide `SyntaxError` from `stripExports()` on any `export async function` in `client-core.mjs`.
