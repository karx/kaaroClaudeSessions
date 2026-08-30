# RFC: ME Share Card v2 — truthful encoding, personal identity, delight

**Project:** kaaroSessions
**Status:** Proposed
**Date:** 2026-08-30
**Relates to:** [RFC-share-cards.md](./RFC-share-cards.md) (v1–v3 constellation, constraints still in force) · [RFC-project-glyphs.md](./RFC-project-glyphs.md) · [RFC-project-glyph-grid.md](./RFC-project-glyph-grid.md) (idle = hollow, active = solid wedges) · Register A (`experience/design-tokens.mjs`, `SHARE_CARD_TOKENS`) · `/share-card` skill contract
**Grounding:** live `sessions-data.json` snapshot on the authoring machine (2026-08-30) via `buildGraph` + `buildUsageShareCardData` — 90 sessions, 20 projects, 144,820,101 tokens, 2025-03-01 → 2026-08-30 (17 elapsed months). Census **drifts** as new JSONL lands (a later pass the same day was 93 / 145.1M / 4,425 tool calls / grok 7). §3 is a snapshot, not a success assertion.

---

## 1. Problem

The Full Usage Canvas ("ME") share card is a **census of the canvas, not a portrait of the person**. Three independent encoding bugs, plus unused-but-assembled identity, make the PNG that leaves the machine lie about the dump it was built from.

On this machine, 2026-08-30 snapshot:

| What the card shows | What the data is |
|---|---|
| Caption `size = activity` | Hex radius = `sizeNorm` (consumption / `tokens_total`); ball radius = `tool_diversity`. Two axes, one word. |
| 19 of 20 project hexes **hollow** | `generateUsageShareCardSVG` calls `projectGlyphMarkup(p, …)` which gates fill on `isProjectGlyphActive` — `recencyLevel ≥ 1` within 48h (`MAX_AGE_MS` in `experience/graph-data.mjs`) or `inFlight`. Idle-hollow is live-dock grammar ([RFC-project-glyph-grid.md](./RFC-project-glyph-grid.md) §4). An all-time card is not a live dock. Only `kaaroSessions` is recency 3. |
| ME wedges: Pi 57% / command-code 27% / claude-code 6% | `meGlyph()` pies **session count**, not consumption. Claude harness is 5 sessions / 42.1M tokens — 6% of the face, ~29% of consumption. A token pie would **zero out command-code and copilot** (tokenless; 27% + 6% of sessions) and **enlarge Pi** (already ~70% of tokens). |
| Footer `ALL PROJECTS · ALL TIME`; share text `My kaaroSessions canvas` + three counts | `topProject` is assembled (`Users-arshigoyal-kaaro-src-kaaroViewer`) and never drawn. Stat `AVG TOOL TYPES` = 3 — weakest of the four numbers. `deriveLabel` does not strip Pi `Users-<user>-kaaro-src-` slugs. |

The user asked for a specific increment: force the hexes solid, print the heaviest world as a human name, tell the truth about size, swap the weak stat, and sign the card with a deterministic epithet plus an opt-in display name. Stay inside one assembler / one renderer. Do not reopen the constraints in RFC-share-cards §2 / §7.

---

## 2. Goals

v1 (this RFC, PRs 1–2) stays inside `buildUsageShareCardData` + `generateUsageShareCardSVG`. Node-tested. Register A grammar (no shadows, gradients, radius > 2px, blue chrome). Preview / share / download still call the same pair.

1. **Force project hexes solid on this card.** Idle-hollow stays the live dock (`04-rendering.js`, `projectGlyphFieldSvg`, landing `/`). Highest-leverage one-line fix.
2. **Print the center.** Humanize `topProject` (`kaaroViewer`, not `Users-arshigoyal-kaaro-src-kaaroViewer`) and draw it. Spiral index 0 = heaviest becomes a sentence.
3. **Honest size caption** that **fits the 575px field with overflow** (exact string in §4.4). Swap `AVG TOOL TYPES` for **`TOOL CALLS`** (exact sum of session `tool_calls`; see §10).
4. **Footer epithet + opt-in display name.** Deterministic, no LLM. Name lives in `localStorage` (no existing identity config — searched). Assembler stays pure: name in via `opts`. Overlay Share must raster the **signed** SVG (§4.8).
5. **Name the ME pie axis on-card.** Caption `WEDGES = SESSIONS` under the medallion so the session-count pie is not mistaken for usage.

Non-goals (v1):

- A second assembler or renderer.
- Exact hex↔ball docking, hash-seeded mosaic, contribution-graph replacement of the constellation (already rejected, RFC-share-cards §5).
- Changing `deriveLabel` globally (`hooks/helpers/analyze-helpers.mjs`) — a different RFC; this card gets a local helper.
- Inner consumption ring on the 56px ME hex (second axis on a small mark).
- 3 `ai_title` chips, ME-as-clock, recency halo in `--k-geo`, minting ritual, animated PNG/GIF, fabricated public URL.
- Encoding `first_user_message`, file paths, absolute home paths, prompts, error rings, or branch names on the PNG.
- Feature-flag infra (none exists).
- jsdom tests for `experience/client/21-share-card.js` (documented coverage gap).

v1-if-cheap, decided in §10 rather than left open: ME `WEDGES = SESSIONS` caption (yes); share text carries epithet + heaviest + range (yes); harness-legend collapse to top 4 + `+N` (no — the fifth stat row plus a 412 `legendY0` clear the medallion). Monthly pulse strip is **PR 3**, not v1.

---

## 3. Live grounding (authoring machine, 2026-08-30 snapshot)

From `sessions-data.json` → `buildGraph` → `buildUsageShareCardData(meGlyph(sessions), { projects, sessions, … })`. **Snapshot, not an assertion** — a headed smoke after PR 1 will not pin these integers.

| Field | Snapshot value |
|---|---|
| Sessions | 90 (later the same day: 93) |
| Projects | 20 |
| Tokens | 144,820,101 (`fmtTok` → `144.8M`; later 145.1M) |
| Date range | 2025-03-01 → 2026-08-30 |
| Elapsed months (epithet) | `(2026-2025)*12 + (8-3) = 17` |
| Inclusive months (PR 3 strip) | 2025-03 … 2026-08 = **18** calendar months |
| Populated months | **six**: `2025-03`, `2025-12`, `2026-05`, `2026-06`, `2026-07`, `2026-08` |
| ME wedges (`meGlyph` session-count share) | pi 51 (57%), command-code 24 (27%), claude-code 5 (6%), copilot 5 (6%), grok 4 (4%), codex 1 (1%) |
| Harness tokens (same dump; Pi is **not** tokenless) | pi 102.1M / claude-code 42.1M / grok 0.7M / codex 0.17M / command-code **0** / copilot **0** |
| `topProject` | `Users-arshigoyal-kaaro-src-kaaroViewer` — 21 sessions, 57.8M tokens. Label is a home-directory slug, not `kaaroViewer`. |
| Next by tokens | alfred-buildathon 42.1M / 5 claude-code sessions (label on the node is `-Users-arshigoyal-kaaro-src-alfred-buildathon`, leading hyphen) |
| Hollow hexes | 19 of 20 — `recencyLevel === 0`. Only `kaaroSessions` is recency 3. |
| Unused-but-assembled | `topProject`, per-project `label` / `session_count` / `recencyLevel` / `inFlight` |
| Available on session nodes, unused by this card | `tool_calls` (4,253 in the snapshot; later 4,425), `user_turns` (729), `duration_min` (351), `ai_title` (29 titles), `model`, `tools_top`, `skills` (almost empty), `cache_hit_rate` (avg 81%), `tool_errors` (60), `context_resets` (3), `subagent_count` (1), `first_user_message`, `branches` |
| Caption today | `◆ hex = project · ball = session · size = activity` |
| Footer today | hardcoded `ALL PROJECTS · ALL TIME` |
| Kicker today | `FULL USAGE CANVAS · INTELLIGENCE TRACE` |
| Share text today | `My kaaroSessions canvas` + three counts |
| Weakest stat | `AVG TOOL TYPES` = 3 |

Project nodes from `buildGraph` (`experience/graph-pipeline.mjs`) do **not** set `inFlight` (sessions and clusters do). `isProjectGlyphActive` on a project is therefore recency-only. The assembler still copies `inFlight: !!p.inFlight` (always false for projects). Not a v1 graph-pipeline change — `forceSolid` makes it irrelevant on this card.

`deriveLabel` (`hooks/helpers/analyze-helpers.mjs`):

```
.replace(/^[A-Za-z]--src-/, '')
.replace(/^[A-Za-z]--Users-[^-]+-/, '')
```

Does not strip Pi `Users-<user>-kaaro-src-` or Codex `Users--<path>` slugs. Out of scope to fix globally.

Pi `capabilities.tokens` is `true` (`size_proxy: 'tokens_work'` in `hooks/registry.mjs`). The heaviest world is a **Pi** project. Command Code / Copilot are the tokenless faces on this dump.

---

## 4. Design

Stay at one assembler + one renderer. New pure helpers live in `experience/client-core.mjs` next to the existing share-card block (no import graph; injected as `%%CLIENT_CORE%%`). `experience/` still never imports `hooks/`.

```
GRAPH.nodes (session + project)
        │
        ▼
 meGlyph(sessions)          ── session-count pie (unchanged axis)
        │
        ▼
 buildUsageShareCardData(me, opts)     ── ONE assembler
   opts.projects / sessions / tokensTotal / dateFrom / dateTo
   opts.displayName                    ── optional, pre-read from localStorage
        │
        ├── humanizeProjectLabel(top.label) → topProjectShort
        ├── sum session.tool_calls          → tool_calls
        ├── usageEpithet(data)              → epithet
        └── usageShareFilename(displayName, dateTo) → shareFilename
        │
        ▼
 generateUsageShareCardSVG(data)       ── ONE renderer
   projectGlyphMarkup(p, { forceSolid: true })
   _shareHeader({ wordmark, kicker, dateRight })
   _shareFooter({ tagLine: epithet })
        │
        ▼
 svgToPNG → shareCard / downloadCard   ── card is the artifact
              ▲
              │  overlay commit (PR 2): applyDisplayName → generateUsageShareCardSVG
              └── Share reads a let box { svg, cardData }, not the original args
```

### 4.1 Inherited constraints (do not reopen)

From RFC-share-cards §2 / §7, still in force:

- One assembler (`buildUsageShareCardData`) + one renderer (`generateUsageShareCardSVG`). Preview / share / download all call the same pair.
- The card is the artifact — `buildShareText()` never fabricates a public URL.
- 1200×630, Register A tokens only (`SHARE_CARD_TOKENS` mirrors `experience/design-tokens.mjs` verbatim), `esc()` on every user string, IBM Plex Mono.
- Reuse existing primitives (`hexPath`, `harnessWedges`, `projectGlyphMarkup`, `meGlyph` / `meGlyphMarkup`, `glyphSpiralCell` / `glyphCellPosition`, `_fillRadius`) — do not invent new mark types.
- Two independent spirals sharing one center (no exact hex↔ball docking).
- Caps unchanged: `MOSAIC_MAX_SESSIONS = 200`, `CONSTELLATION_MAX_PROJECTS = 60`.
- Experience layer never imports `hooks/`.
- `client-core.mjs` has no import graph; palette duplication is intentional.

What **does** change: reusing `projectGlyphMarkup` *unchanged* is a bug on a historical card. Idle-hollow is live-dock grammar. The fix is an option on the existing function, not a fork.

### 4.2 Encoding bugs, named

**Bug 1 — `size = activity` is two axes.**

Hex radius in `generateUsageShareCardSVG` (no `clamp` helper in this file):

```
const hexR = Math.max(hexPitch * 0.6, Math.min(hexPitch * 0.92, hexPitch * (0.6 + 0.32 * p.sizeNorm)));
```

`sizeNorm` on a project node is `√(consumption / MAX_CONSUMPTION)` where `consumption = tokens_total || tool_calls` (`experience/graph-pipeline.mjs`). Token-bearing hexes scale by overall consumption. Caption shorthand "hex size = consumption" means that `sizeNorm`, not a retarget.

Ball radius:

```
const ballR = Math.max(ballPitch * 0.25, ballPitch * (0.3 + 0.35 * norm));
```

`diversity` is `s.tool_diversity` — distinct tool types, not tokens, not duration, not calls. Caption `size = activity` collapses both. Fix: name both axes. Do not retarget either scale in v1 (constellation ranking and visual weight stay).

**Bug 2 — almost every project hex is hollow on an all-time card.**

`projectGlyphMarkup` today (`experience/client-core.mjs`) accepts only `{ r = 16, bg = '#000000' }` — extra opts are ignored:

```
if (!isProjectGlyphActive(d)) {
  return hollow hex, canvas fill + project-colour stroke;
}
```

`isProjectGlyphActive`: `d.inFlight || (d.recencyLevel || 0) >= 1`. Recency level 1 is last 48h (`calcRecencyLevel`, `MAX_AGE_MS = 2 * 24 * 3600 * 1000`). Callers that must stay idle-hollow:

| Surface | Call |
|---|---|
| Force / Lattice graph | `04-rendering.js` — own `isProjectGlyphActive` + `harnessWedges` path, **not** `projectGlyphMarkup` |
| Landing field | `projectGlyphFieldSvg` → `projectGlyphMarkup(p, { r, bg })` only (does **not** forward other opts) |
| Panel / `projectGlyphSvg` | `projectGlyphMarkup(d, opts)` — forwards `opts`; we do **not** pass `forceSolid` from any live caller |
| Dock minimap live count | `20-glyph-board.js` `st.list.filter(isProjectGlyphActive)` |

Only `generateUsageShareCardSVG` must pass `{ forceSolid: true }`. Adding `forceSolid = false` is backward compatible.

**Bug 3 — ME hero is a session-count pie, not a usage pie.**

`meGlyph(sessions)` documents this on purpose: "Usage is session count so tokenless harnesses still count." On this dump that means **command-code (24 sessions, 0 tokens) and copilot (5 sessions, 0 tokens)** stay on the face. Pi is **not** tokenless here: 51 sessions and **102.1M tokens** (~70% of consumption). Retargeting wedges to `tokens_total` would **enlarge Pi**, raise Claude from 6% to ~29%, and **zero out command-code and copilot**. v1 **does not retarget the pie**. v1 **names the axis** (`WEDGES = SESSIONS`). An inner consumption ring is later: two axes on a 56px hex is a readability bet, not a one-line fix.

### 4.3 Assembler contract

`buildUsageShareCardData(me, opts)` return shape. Existing fields stay; additions marked **new**.

```
{
  kind:            'usage',                          // existing
  total_sessions:  number,                           // me.total
  project_count:   number,                           // opts.projectCount || projects.length
  tokens_total:    number,                           // opts.tokensTotal
  dateFrom:        string,                           // 'YYYY-MM-DD' or ''
  dateTo:          string,
  rows:            { harness, count, pct, color }[], // me.rows
  topProject:      string,                           // raw label of projects[0] (kept for tests)
  topProjectShort: string,                           // NEW — humanizeProjectLabel(topProject)
  tool_calls:      number,                           // NEW — sum, see reduce below
  avg_diversity:   number,                           // NEW — round(mean tool_diversity); caption only
  displayName:     string,                           // NEW — sanitizeDisplayName(opts.displayName) or ''
  epithet:         string,                           // NEW — usageEpithet(...)
  shareFilename:   string,                           // NEW — usageShareFilename(...)
  projects:        { id, label, color, harnesses, recencyLevel, inFlight, sizeNorm, session_count, tokens_total }[],
  sessions:        { color, diversity }[],           // constellation balls; ranking unchanged
  me:              meGlyph result | null,
}
```

Derivation notes:

- Projects still sort by `tokens_total` descending. `topProject` remains `projects[0]?.label || ''` so the existing constellation test (`data.topProject === 'big'`) stays green. Renderer prints **only** `topProjectShort`.
- `tool_calls` is summed from `opts.sessions` **before** the map that drops everything except `{ color, diversity }`. Do not add `tool_calls` onto ball records — they are a texture. Graph-pipeline copies `sess.tool_calls` without a default, so missing fields must not `NaN` the PNG:

```
tool_calls: (opts.sessions || []).reduce((n, s) => n + (s.tool_calls || 0), 0)
```

- `avg_diversity` is the mean over the full session list, not the 200-cap `shownSess` slice, so the caption does not quietly change at the cap. `(opts.sessions || []).length ? Math.round(sum / length) : 0`.
- `displayName` is sanitized inside the assembler so dirty `opts` cannot leak into SVG. The assembler does not read `localStorage`.
- `epithet` is stored on the payload so `generateUsageShareCardSVG` and `buildShareText` cannot drift.
- `shareFilename` is stored on the payload; computed by exported `usageShareFilename` (same helper the overlay uses after a rename).

`opts` additions (all optional):

| Key | Type | Default |
|---|---|---|
| `displayName` | string | `''` |
| (existing) `projectCount`, `tokensTotal`, `dateFrom`, `dateTo`, `projects`, `sessions` | — | unchanged |

Caller in `experience/client/21-share-card.js` (`#me-share-btn`), initial build:

```
const displayName = sanitizeDisplayName(localStorage.getItem('kaaro-display-name') || '');
const cardData = buildUsageShareCardData(meGlyph(sessions), {
  projectCount, tokensTotal, dateFrom, dateTo,
  projects, sessions, displayName,
});
```

Overlay rename does **not** re-call this with `me` / `projects` (those are not in `_showPreview`). It uses `applyDisplayName` (§4.8).

### 4.4 Renderer layout

`_shareGeom()` is unchanged:

```
width 1200  height 630
headerH 80  footerH 70
bodyTop 80  bodyBot 560
dividerX 660  leftPad 55  rightPad 700
```

```
          0                         660                        1200
        0 ┌─────────────────────────────────────────────────────────┐
          │ wordmark (20px accent, letter-spacing 3px)   date range │  y=34
          │ kicker   (9px dim)                                      │  y=58
       80 ├──────────────────────────────┬──────────────────────────┤
          │ LEFT FIELD                   │ STATS @ rightPad=700     │
          │ fieldX0=55  fieldX1=630      │  SESSIONS / PROJECTS /   │
          │ fieldY0=100 fieldY1=514      │  CONSUMPTION / TOOL CALLS│
          │ center (342.5, 307)          │  HEAVIEST                │
          │ balls then hexes             │                          │
          │                              │  legendY0 = 412          │
          │                              │  ME (1020.4, 320) r=56   │
          │ caption y=536  (no l-spacing)│  WEDGES = SESSIONS y=402 │
      560 ├──────────────────────────────┴──────────────────────────┤
          │ epithet (select)                          ◆ KAAROSESSIONS│
          │ an observability surface for coding agents              │
      630 └─────────────────────────────────────────────────────────┘
```

**Header.** `_shareHeader` today hardcodes unescaped `KAAROSESSIONS`. It gains optional `wordmark`. Session and project cards omit it — product wordmark unchanged. **Must** `esc()` and `toUpperCase()` in the renderer; `data.displayName` stays typed-case on the payload for share text. Letter-spacing stays `3px`:

```
function _shareHeader(g, { kicker, dateRight, subRight, wordmark }) {
  const c = SHARE_CARD_TOKENS;
  const mark = esc(String(wordmark || 'KAAROSESSIONS').toUpperCase());
  return `<rect width="${g.width}" height="${g.headerH}" fill="${c.panel}"/>
  <line x1="0" y1="${g.headerH}" x2="${g.width}" y2="${g.headerH}" stroke="${c.border}" stroke-width="1"/>
  <text x="${g.leftPad}" y="34" style="font-size:20px;font-weight:bold;fill:${c.accent};letter-spacing:3px;">${mark}</text>
  <text x="${g.leftPad}" y="58" style="font-size:9px;fill:${c.dim};letter-spacing:2px;">${esc(kicker || '')}</text>
  <text x="${g.width - g.leftPad}" y="34" style="font-size:12px;fill:${c.dim};text-anchor:end;">${esc(dateRight || '')}</text>
  <text x="${g.width - g.leftPad}" y="58" style="font-size:12px;fill:${c.label};text-anchor:end;">${esc(subRight || '')}</text>`;
}
```

Usage card passes `wordmark: data.displayName || undefined` so an empty name keeps the default.

| `displayName` | y=34 wordmark | y=58 kicker |
|---|---|---|
| unset | `KAAROSESSIONS` | `FULL USAGE CANVAS · INTELLIGENCE TRACE` |
| `Arshi` | `ARSHI` | `FULL USAGE CANVAS · INTELLIGENCE TRACE` |

Product identity stays in the footer right label `◆ KAAROSESSIONS`. **Decided (2026-08-30):** replace the 20px wordmark with the uppercase display name. Do not prefix the 9px kicker instead.

**Left field.** Unchanged packing (`_fillRadius`, two spirals, ME not in this field).

Field width `fieldX1 - fieldX0 = 575px`. IBM Plex Mono at 9px is ~5.4px/glyph. Today's caption uses `letter-spacing:1px`, which adds ~(n−1) px and is why a long honesty string will paint through the divider (SVG `<text>` does not wrap).

**Exact caption string** (one line, `letter-spacing` omitted — do not copy the 1px from today's caption):

```
◆ hex size = consumption · ball size = tool types (avg {avg_diversity})
```

Overflow suffix unchanged: if either cap is hit, append ` · ${overflowBits.join(', ')} more` (`+N projects` / `+N sessions`).

Worked width (letter-spacing 0, 5.4px/glyph):

| String | chars | px |
|---|---|---|
| `◆ hex size = consumption · ball size = tool types (avg 3)` | 59 | 319 |
| plus ` · +5 projects, +5 sessions more` | +32 = 91 | 491 |
| plus ` · +99 projects, +99 sessions more` | +34 = 93 | 502 |

502 < 575. Shape (`hex` vs `ball`) is the mark itself; the honesty bug was `size = activity`. Dropping `hex = project · ball = session` is what makes the suffix fit.

Renderer:

```
<text x="${fieldX0}" y="${fieldY1 + 22}"
      style="font-size:9px;fill:${c.dim};">${esc(caption)}</text>
```

No `letter-spacing` on this element. Test: `caption.length * 5.4 < 575` on a fixture that includes both overflow bits; SVG contains `hex size = consumption` and `ball size = tool types` and does not contain `size = activity`; overflow still appends.

Heaviest is a stat, not a second caption line. The 46px gutter under `fieldY1` holds this one 9px line (y = 536; footer at 560).

**Right column — five stats**, 50px pitch, `_shareStatRows` startY default (`bodyTop + 44 = 124`):

| Label | Snapshot example | Source |
|---|---|---|
| `SESSIONS` | `90` | `data.total_sessions` |
| `PROJECTS` | `20` | `data.project_count` |
| `CONSUMPTION` | `144.8M` | `fmtTok(data.tokens_total)` |
| `TOOL CALLS` | `4253` (example) | `String(data.tool_calls)` — match session card line 1303, **not** `fmtTok` (`fmtTok(4253) === '4k'`) |
| `HEAVIEST` | `kaaroViewer` | `_shareTrunc(data.topProjectShort, 18)` |

Five rows × 50px = 250. Last value y = 124 + 200 + 22 = 346. ME medallion occupies x ∈ [954.4, 1086.4], y ∈ [254, 386] (backing r = 66). `HEAVIEST` text at x=700, ≤18 glyphs × 12px ends ≤916 — ≥38px gap to the medallion. No collision.

**ME medallion.** Position unchanged (`meCenterX = rightPad + (width - leftPad - rightPad) * 0.72 = 1020.4`, `meCenterY = 320`, `meR = 56`). Caption sits **below the accent ring**, not on the legend baseline:

```
<text x="1020.4" y="402" text-anchor="middle"
      style="font-size:8px;fill:${c.dim};letter-spacing:1.5px;">WEDGES = SESSIONS</text>
```

`y = meCenterY + (meR + 10) + 16 = 320 + 66 + 16 = 402`. ~110px wide centered on 1020.4 → x ∈ ~[965, 1076].

**Legend.** `legendY0 = 412` (not 394). First swatch rect at y = 403, text at 412, x = `g.rightPad` (700). That is 17px below the ME backing bottom (386) — today's 394 would put the swatch at 385, 1px **inside** the backing. Six rows end at 412 + 5×18 = 502; eight would end at 538. Footer is 560. **Do not collapse** the legend in v1.

WEDGES (y=402, x~1020) and legend[0] (y=412, x=700) are adjacent in y and **separated in x by ~150px**. That is the intended two-column right side, not a collision. Tests: WEDGES `text-anchor="middle"` at `translate` sibling / `x="1020.4"`; legend swatches stay at `x="700"`.

**Hex paint.** The only call-site change in the renderer:

```
projectGlyphMarkup(p, { r: hexR, bg: c.bg, forceSolid: true })
```

**Footer.** `tagLine` is `data.epithet` (raw — `_shareFooter` is the single escaping point, RFC-share-cards §4). Empty canvas → `empty canvas`. Right label stays `◆ KAAROSESSIONS`. Sub-line `an observability surface for coding agents` unchanged.

### 4.5 `projectGlyphMarkup` — `forceSolid`, not a fork

```
export function projectGlyphMarkup(d, { r = 16, bg = '#000000', forceSolid = false } = {}) {
  const color = d?.color || '#888888';
  const stroke = `<path d="${hexPath(r)}" fill="none" stroke="${esc(color)}" stroke-width="2"/>`;
  if (!forceSolid && !isProjectGlyphActive(d)) {
    return `<path d="${hexPath(r)}" fill="${bg}" stroke="${esc(color)}" stroke-width="2"/>`;
  }
  const wedges = harnessWedges(d.harnesses, r);
  if (!wedges.length) {
    return `<path d="${hexPath(r)}" fill="${bg}" stroke="${esc(color)}" stroke-width="2"/>`;
  }
  // solid harness fills + stroke, unchanged
}
```

`projectGlyphSvg` already forwards `opts` and will honour `forceSolid` if a caller passes it — live callers must not. `projectGlyphFieldSvg` passes `{ r, bg }` only. Dock / graph / landing stay idle-hollow. Tests must prove:

1. Existing: idle (`recencyLevel: 0`) without the flag → no `HARNESS_MARK` fill.
2. Existing: active (`recencyLevel ≥ 1` or `inFlight`) → solid fill.
3. New: idle + `{ forceSolid: true }` + harnesses → solid fill (same path as active).
4. New: idle + `{ forceSolid: true }` + empty harnesses → still hollow (no wedges to paint — same as active-with-no-harnesses today).
5. `generateUsageShareCardSVG` of a `recencyLevel: 0` project with harnesses **contains** that harness's `HARNESS_MARK` colour.

`isProjectGlyphActive` itself is not changed.

### 4.6 `humanizeProjectLabel`

Pure helper in `experience/client-core.mjs`. Does **not** import `hooks/`. Does **not** change `deriveLabel`. Node-tested. Never prints a raw home-directory slug on the PNG.

More-specific prefixes run **first**. After a user-prefix strip, a leftover `^kaaro-src-` (Command Code, post-`deriveCCProjectLabel`) is stripped too. Repeating the list until a pass is a no-op handles `users-arshi-D--src-ebrain` (user prefix, then drive-src). Cap 6 passes.

```
const HUMANIZE_PREFIXES = [
  /^[A-Za-z]--src-/,
  /^[A-Za-z]--Users-[^-]+-/,
  /^Users-[^-]+-kaaro-src-/i,   // more specific than general Users-<user>-
  /^Users--+/,                   // Codex: Users--kaaro-bleisure
  /^users-[^-]+-/i,              // Command Code users-<user>- (if still present)
  /^Users-[^-]+-/i,              // general Pi Users-<user>-
  /^kaaro-src-/i,                // CC leftover: kaaro-src-kaaro-sessions
];

export function humanizeProjectLabel(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('/') || s.includes('\\')) {
    s = s.replace(/\\/g, '/').split('/').filter(Boolean).pop() || s;
  }
  s = s.replace(/^-+/, '').replace(/-+$/, '');
  for (let i = 0; i < 6; i++) {
    const next = HUMANIZE_PREFIXES.reduce((acc, re) => acc.replace(re, ''), s);
    if (next === s) break;
    s = next;
  }
  if (!s || /^Users-/i.test(s)) return 'home';
  return s;
}
```

Prefix-stripping, **not** "last hyphen segment" — that would turn `kaaro-cad-civil` into `civil`. The general `users-[^-]+-` rule must **not** run before `Users-<user>-kaaro-src-`, or `Users-arshigoyal-kaaro-src-kaaroViewer` becomes `kaaro-src-kaaroViewer` and the specific rule is dead.

Required fixtures (live dump labels + dialects). Tests must assert the **exact** output, not merely “does not match `/^Users-/i`”:

| Input | Output | Why |
|---|---|---|
| `Users-arshigoyal-kaaro-src-kaaroViewer` | `kaaroViewer` | live heaviest; **this equality is the lock** |
| `--Users-arshigoyal-kaaro-src-kaaroViewer--` | `kaaroViewer` | Pi wrapping dashes |
| `-Users-arshigoyal-kaaro-src-alfred-buildathon` | `alfred-buildathon` | live Claude label, **leading hyphen** |
| `kaaro-src-kaaro-sessions` | `kaaro-sessions` | live Command Code, after `deriveCCProjectLabel` |
| `kaaro-src-alfred-buildathon` | `alfred-buildathon` | live CC sibling |
| `Users-arshigoyal-kaaro-src` | `kaaro-src` | live cwd-as-project; **not** `home` (`kaaro-src` has no trailing `-` for the specific rule, general user-prefix leaves this remainder, leftover `^kaaro-src-` needs a hyphen) |
| `Users-arshigoyal` | `home` | live home-dir project; still matches `/^Users-/i` after no extra segment |
| `Users-arshigoyal-kaaro-cad-civil` | `kaaro-cad-civil` | must not become `civil` |
| `D--src-kaaroSessions` | `kaaroSessions` | CC/Grok drive-src |
| `--D--src-ebrain--` | `ebrain` | Pi-wrapped drive-src |
| `Users--kaaro-bleisure` | `kaaro-bleisure` | Codex id form (`Users--+`) |
| `bleisure` | `bleisure` | already last-segment (live Codex/Copilot labels) |
| `art-of-intent` | `art-of-intent` | same |
| `users-arshi-D--src-ebrain` | `ebrain` | user prefix then drive-src (loop) |
| `''` | `''` | empty in, empty out — not `home` |

Invariant: a non-empty output never matches `/^Users-/i`. Renderer uses `_shareTrunc(topProjectShort, 18)` and `esc()`.

### 4.7 `usageEpithet`

Pure, deterministic, no LLM. Exported and unit-tested; assembler stores the result.

```
export function usageEpithet({ rows, dateFrom, dateTo, topProjectShort, total_sessions })
```

**Guard first:** if `!total_sessions` **or** `!(rows && rows.length)` return `'empty canvas'` — **before** reading `rows[0].pct`.

Clause order, joined with ` · `, omitted when empty:

1. **Harness count** — if `rows.length >= 2`: `{n}-harness operator`. Single-harness skips this (`1-harness operator` is noise; clause 2 covers it).
2. **Majority native** — if `rows[0].pct >= 50`: `{HARNESS_EPITHET_LABEL[id] || id}-native`.

   `HARNESS_EPITHET_LABEL` lives next to `HARNESS_MARK` in `client-core.mjs`. It is **not** `hooks/registry.mjs` `label` (`Claude Code`, `Google Antigravity`, `Grok Build`, `opencode`, `GitHub Copilot`):

```
export const HARNESS_EPITHET_LABEL = {
  'claude-code': 'Claude',
  'codex': 'Codex',
  'pi': 'Pi',
  'antigravity': 'Antigravity',
  'grok': 'Grok',
  'opencode': 'OpenCode',
  'copilot': 'Copilot',
  'command-code': 'Command Code',
};
```

   No harness ≥ 50% → omit. Ties at 50/50 take `rows[0]` (already count-desc, then id, from `meGlyph`).

3. **Span** — omit the clause if **either** `dateFrom` or `dateTo` is missing. Else elapsed calendar months `(y2 − y1) * 12 + (m2 − m1)` from the `YYYY-MM-DD` prefixes. If that is `0`, day delta (UTC, exclusive of the end-day-as-duration):

```
Math.round((Date.parse(dateTo + 'T00:00:00Z') - Date.parse(dateFrom + 'T00:00:00Z')) / 86400000)
```

   `2026-08-01` → `2026-08-30` = **29**. If day delta ≥ 1 → `{n} days`; else omit. Elapsed `1` → `1 month`. Elapsed `≥ 2` → `{n} months`.

4. **Heaviest** — if `topProjectShort`: `heaviest world: ${_shareTrunc(topProjectShort, 18)}`. Same 18 as the HEAVIEST stat so a 40-char remainder cannot collide with `◆ KAAROSESSIONS` in the 70px footer.

This dump: `6-harness operator · Pi-native · 17 months · heaviest world: kaaroViewer`.

Edge cases (must be tests):

| Mix | Epithet |
|---|---|
| This dump (6 harnesses, Pi 57%, 17 months, kaaroViewer) | `6-harness operator · Pi-native · 17 months · heaviest world: kaaroViewer` |
| Empty (`total_sessions === 0`, no rows) | `empty canvas` |
| Empty rows even if `total_sessions` is stale | `empty canvas` (guard before `rows[0]`) |
| One harness Claude, 5 sessions, no dates, top `ebrain` | `Claude-native · heaviest world: ebrain` |
| Two harnesses 40/60, 3 months, no top | `2-harness operator · Pi-native · 3 months` (if Pi is 60%) |
| Two harnesses 50/50 | `{n}-harness operator · {rows[0]}-native · …` (rows[0] wins) |
| **Synthetic** tokenless-only Pi (`tokens_total` 0, rows still have Pi) — **not this dump** | still works — epithet reads `rows` (session counts), not tokens |
| Same-month range 2026-08-01 → 2026-08-30 | `29 days`, no `0 months` |
| Either date missing | no span clause |
| `topProjectShort` 40 chars | heaviest clause uses 18-char trunc + `…` |

### 4.8 Display name

No existing user-display-name config. Searched `experience/`, `hooks/`, `surface/`, templates, `localStorage` keys. Current `kaaro-*` keys: `kaaro-audio-settings`, `kaaro-audio-profile`, `kaaro-chrome-collapsed`, `kaaro-shortcuts`, `kaaro-ticker-sticky`, `kaaro-daw-profiles`, `kaaro-glyph-board`, `kaaro-expanded-clusters`. None is an identity.

**Storage:** `localStorage['kaaro-display-name']` only. Not a file under `~/.agents/` or the repo. The experience layer does not write files except the PNG download; a sidecar would need `serve.mjs` I/O the card path does not have, and would not travel with a file:// or hosted-static copy of `graph.html`.

**Key:** `kaaro-display-name` (string, not JSON).

**Sanitize** (`sanitizeDisplayName`, exported, used by assembler **and** the writer). Order is idempotent:

```
export function sanitizeDisplayName(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9 ._\-]/g, '')
    .replace(/ +/g, ' ')
    .slice(0, 24)
    .trim();
}
```

IBM Plex Mono + SVG `esc()`: ASCII-only is the right charset. No emoji, no quotes, no `<`. After the allow-list the only whitespace left is ASCII space, so collapse is `/ +/g`, not `\s`.

**Filename helper** (exported, unit-tested; assembler and overlay both call it — not an untested closure):

```
export function usageShareFilename(displayName, dateTo) {
  const slug = String(displayName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return 'kaaro-usage-card.png';
  const ym = (dateTo && /^\d{4}-\d{2}/.test(dateTo)) ? dateTo.slice(0, 7) : '';
  return ym ? `kaaro-${slug}-${ym}.png` : `kaaro-${slug}.png`;
}
```

Empty slug after sanitization falls back to `kaaro-usage-card.png`. Display name `"..."` survives the charset allow-list (`.`) and slugs to `""` (dots are not `[a-z0-9]`), so the file is anonymous. `".."` / `"---"` / `"   "` same. Missing `dateTo` → `kaaro-arshi.png` (no date fragment).

| Name | `dateTo` | File |
|---|---|---|
| unset / `''` | any | `kaaro-usage-card.png` |
| `Arshi` | `2026-08-30` | `kaaro-arshi-2026-08.png` |
| `Arshi` | `''` | `kaaro-arshi.png` |
| `...` | `2026-08-30` | `kaaro-usage-card.png` |

**Apply-name helper** (exported; overlay has no `me` / `projects` / `sessions` to rebuild the assembler):

```
export function applyDisplayName(data, name) {
  const displayName = sanitizeDisplayName(name);
  return {
    ...data,
    displayName,
    shareFilename: usageShareFilename(displayName, data.dateTo),
  };
}
```

Epithet does not include the name, so it is left as-is. Wordmark / share text / filename all read the new fields.

**Where it is read (initial).** `21-share-card.js` reads localStorage, passes `opts.displayName`. Assembler sanitizes again (belt) and stores `data.displayName`. Renderer and `buildShareText` read `data.displayName` only. Assembler remains pure.

**Where it is written — `_showPreview` let-box contract.** Today `_showPreview(svgString, cardData)` captures both as `const` and Share rasters `svgString`. That would keep the **unsigned** PNG after a rename. Specify:

```
function _showPreview(svgString, cardData) {
  const box = { svg: svgString, cardData };   // let-box; Share reads THIS
  // overlay chrome …
  const img = document.createElement('img');
  img.src = 'data:image/svg+xml,' + encodeURIComponent(box.svg);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;';

  if (cardData.kind === 'usage') {
    const nameRow = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'SIGN YOUR CARD (OPTIONAL)';
    input.maxLength = 24;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = box.cardData.displayName || '';
    input.style.cssText =
      'width:280px;background:' + KAARO_TOKENS.card +
      ';color:' + KAARO_TOKENS.body +
      ';border:1px solid ' + KAARO_TOKENS.border +
      ';border-radius:0;box-shadow:none;outline:none;' +
      "font:11px 'IBM Plex Mono','Courier New',monospace;" +
      'letter-spacing:0.08em;padding:8px 10px;text-transform:none;';
    function commit() {
      const name = sanitizeDisplayName(input.value);
      input.value = name;
      if (name) localStorage.setItem('kaaro-display-name', name);
      else localStorage.removeItem('kaaro-display-name');
      box.cardData = applyDisplayName(box.cardData, name);
      box.svg = generateUsageShareCardSVG(box.cardData);
      img.src = 'data:image/svg+xml,' + encodeURIComponent(box.svg);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    nameRow.appendChild(input);
    overlay.appendChild(nameRow);          // its own row, ABOVE the button row
  }

  shareBtn.addEventListener('click', async () => {
    const filename = box.cardData.shareFilename
      || `kaaro-${box.cardData.kind || 'share'}-card.png`;
    const result = await shareCard(
      box.svg, 'kaaroSessions', buildShareText(box.cardData), filename);
    // …
  });

  overlay.appendChild(img);
  overlay.appendChild(row);                // buttons under the optional name row
}
```

Rules:

- `if (cardData.kind !== 'usage')` skip the input. Session and project previews must not gain the field.
- Share / Save read `box.svg` and `box.cardData`, never the original arguments.
- `border-radius:0`, no `box-shadow`, tokens from `KAARO_TOKENS` (Register A). `test/design-lint.test.mjs` will not see these inline styles; the grammar still applies.
- No first-share prompt. No settings panel.

### 4.9 Share text

`buildShareText` usage branch today:

```
📊 My kaaroSessions canvas
90 sessions · 20 projects · 144.8M tokens
```

v1:

```
📊 arshi's kaaroSessions canvas          // or "My kaaroSessions canvas" if unnamed
6-harness operator · Pi-native · 17 months · heaviest world: kaaroViewer
90 sessions · 20 projects · 144.8M tokens
2025-03-01 → 2026-08-30
```

Possessive: name lowercased in the sentence; if it ends in `s` then `name + "'"`, else `name + "'s"` (`arshi's`, `james'`). Epithet line omitted when empty. Date line omitted when both dates empty. Still no URL.

### 4.10 Personal / delight — v1 vs later

**v1 (this RFC, cheap, tested):**

| Item | Where |
|---|---|
| Solid project hexes | renderer `forceSolid` |
| Humanized `HEAVIEST` stat | 5th `_shareStatRows` entry |
| Honest size caption + avg diversity | field caption, one line, no letter-spacing |
| `WEDGES = SESSIONS` | under ME medallion at y=402 |
| Epithet footer | `_shareFooter.tagLine` |
| Opt-in name on wordmark | `_shareHeader.wordmark` |
| Share text = possessive + epithet + counts + range | `buildShareText` |
| Collectible filename | `usageShareFilename` / `shareFilename` |

**Later / out of v1:**

| Item | Why later |
|---|---|
| Exact hex↔ball docking | Already rejected (RFC-share-cards §5) |
| Hash-seeded mosaic | Already rejected |
| Replace constellation with contribution graph | Already rejected — a thin pulse strip is the allowed demotion (PR 3) |
| Animated PNG/GIF | New raster path; card is a still 1200×630 |
| Fabricated public URL | Constraint in force |
| Raw home paths, `first_user_message`, file paths, error rings, branch names | Private-local intelligence; PNG leaves the machine |
| Inner ring on ME for consumption share | Second axis on a 56px hex; caption is the v1 honesty move |
| 3 `ai_title` chips | Titles carry intent. Crowded next to 5 stats + legend + medallion |
| ME ring as 12-tick clock (hour-of-day / month-of-span) | New mark type; pulse strip covers "when" if we want it |
| Preview overlay "minting" ritual | Browser-only glue in `21-share-card.js`; delight, not encoding |
| Recency halo in `--k-geo` on the one live project | Complementary to force-solid; later, not instead of |
| Legend collapse to top 4 + `+N` | Not needed at 6–8 rows once `legendY0` is 412 |
| Changing `deriveLabel` globally | Different RFC; graph labels, orchestrator, analyzers |

### 4.11 Monthly pulse strip — PR 3, not v1

A contribution-graph demotion: a **dense calendar** of months from `dateFrom` to `dateTo`, empty months visible. Does **not** replace the constellation. Keep out of v1.

**Why not v1.** Header (80px) already holds wordmark + kicker + date range. Footer (70px) holds the new epithet. Field bottom gutter (46px) already holds the honest caption. Five stats + 6-row legend + ME medallion fill the right column. Shipping it with the encoding fixes would crowd the caption and the epithet.

**Bucket set (A, not populated-only).** Inclusive walk of `YYYY-MM` from `dateFrom.slice(0, 7)` through `dateTo.slice(0, 7)`. This dump is **18 cells** (2025-03 … 2026-08 inclusive), of which 6 are populated. That is a different formula from the epithet's 17 *elapsed* months — elapsed is a duration; the strip is the months you lived through. Distinct-`date_str` assembly would yield 6 cells and hide the Mar–Dec 2025 hole, which is the interesting shape.

If either date is missing, no strip. If the inclusive span is longer than 24, keep the **last** 24 months (most recent). Empty canvas → no strip.

Assembler (PR 3 only; do not add unused `months` in PR 1):

```
months: { ym: 'YYYY-MM', sessions: n, tokens: n }[]
```

Seed every ym in the inclusive range at `{ sessions: 0, tokens: 0 }`, then increment from `opts.sessions` using `date_str.slice(0, 7)` and `tokens_total || 0` in the same pass as `tool_calls`. Needs `date_str` kept on a side list; today the constellation map drops it after sort.

**Renderer.** 10px-tall cells in the field's bottom gutter. Caption moves to `fieldY1 + 28`.

```
const n = months.length;
const gap = 1;
const w = (fieldX1 - fieldX0 - gap * (n - 1)) / n;   // this dump: (575 - 17) / 18 ≈ 31.0px
const maxN = Math.max(1, ...months.map(m => m.sessions));
const y = fieldY1 + 8;
months.forEach((m, i) => {
  const x = fieldX0 + i * (w + gap);
  if (m.sessions === 0) {
    // hole: hairline empty slot
    rect fill=none stroke=c.border stroke-width=1
  } else {
    const opacity = 0.15 + 0.85 * (m.sessions / maxN);
    rect fill=c.select opacity=opacity
  }
});
```

Fill encodes **session count**, not tokens (tokenless months would vanish). No new mark primitive.

**Tests (PR 3):** `dateFrom='2025-03-01'`, `dateTo='2026-08-30'` + sessions only in the six populated months → `months.length === 18`, six with `sessions > 0`, `2025-04.sessions === 0`; SVG has 18 gutters rects; empty canvas → no strip; 30-month span → 24 cells (last 24).

---

## 5. Security & Privacy

This card **leaves the machine as a PNG**. That is the threat model. kaaroSessions is a private local observability surface; the share card is the one intentional leak.

**Do not encode** (v1 and later unless a later RFC argues otherwise):

- `first_user_message` / prompts
- file paths (`file_ops` keys)
- absolute home paths / raw `Users-<user>-…` slugs (the whole point of `humanizeProjectLabel`)
- `ai_title` (session intent, often a paraphrase of the prompt)
- `branches` / git branch names
- `tool_errors` rings, `cache_hit_rate`, model names
- the opt-in display name, **unless the user typed it**

**Do encode:**

- counts (sessions, projects, tokens, tool calls)
- humanized project last-segments — repo names the user already shares (`kaaroViewer`, `alfred-buildathon`, `kaaro-sessions`)
- harness mix (already on the live ME dock, not a secret)
- date range
- display name only when present in `data.displayName`

**XSS / SVG injection.** `_shareFooter` already `esc()`s `tagLine`. `_shareHeader` `esc()`s kicker / dates / (new) wordmark after `toUpperCase()`. `humanizeProjectLabel` output still goes through `esc()` and `_shareTrunc`. `sanitizeDisplayName` is a charset allow-list, not a substitute for `esc()`.

**Filename.** Slug is `[a-z0-9-]` only. No path separators. Empty slug → `kaaro-usage-card.png`.

**localStorage.** `kaaro-display-name` is origin-scoped (the serve origin, typically `localhost:3333`). Not sent to any server — `serve.mjs` never reads it. Clearing site data forgets the name; the next share is anonymous again.

**Web Share API.** `shareCard` may send the PNG + `buildShareText` to the OS share sheet. Text now includes the epithet (heaviest world, harness mix, span) and, if signed, the display name. That is intended. It must not include raw slugs. After a preview rename, Share must send the **new** PNG (`box.svg`), not the unsigned original.

---

## 6. Risks

| Risk | Sev | Mitigation |
|---|---|---|
| `forceSolid` omitted at the usage-card call site; hexes stay hollow | High | Renderer test: idle project with harnesses **must** contain `HARNESS_MARK[harness]` in the usage SVG. Dock tests keep proving hollow without the flag. |
| `humanizeProjectLabel` over-strips (`kaaro-cad-civil` → `civil`) | Med | Prefix-strip only; table-driven tests include `kaaro-cad-civil`. |
| `humanizeProjectLabel` under-strips; `Users-arshigoyal-…` reaches the PNG | High | Exact-output table including `=== 'kaaroViewer'`. Invariant: non-empty output never matches `/^Users-/i`. Fallback `'home'` only when the remainder is still `Users-*` or empty after a Users- input. |
| General `users-` prefix runs first; specific `kaaro-src` rule is dead | High | Prefix order in §4.6; lock test on the live heaviest label. |
| Display name XSS | Med | Allow-list + `esc()` + 24-char cap. |
| Overlay Share rasters the unsigned SVG | High | `let` box + `applyDisplayName` + Share reads `box` (§4.8). |
| 5th stat collides with ME medallion | Low | Geometry: HEAVIEST ends ≤916; ME starts x=954. |
| Caption paints through the divider | High | Short string + no letter-spacing; `length * 5.4 < 575` with overflow. |
| `fmtTok(n) === '4k'` hides the stronger number | Low | Print `String(tool_calls)` like the session card's `TOOL CALLS` row, not `fmtTok`. |
| Epithet "Pi-native" reads as a value judgement | Low | It is a majority-share descriptor (≥ 50% of sessions), not a preference. Documented in tests. |
| Preview-overlay name field is untested DOM | Low | Accepted: `21-share-card.js` stays in the client-JS coverage gap. Sanitize + `applyDisplayName` + renderer are Node-tested; glue is browser-smoked. |
| `stripExports()` and a new `export function` | Low | New helpers are `export function` (already supported). Do not add `export async function` beyond `svgToPNG`. |
| Signing the wordmark looks like a rebrand | Low | Footer still says `◆ KAAROSESSIONS`. Unset name restores the product wordmark. Opt-in. |

---

## 7. Alternatives rejected

| Option | Why not |
|---|---|
| Fork `projectGlyphMarkup` into `shareProjectGlyphMarkup` | Two fill rules to drift. An option keeps one function; dock tests lock the default. |
| Always-solid hexes everywhere (change `isProjectGlyphActive` or drop idle-hollow) | Idle-hollow **is** the live dock ([RFC-project-glyph-grid.md](./RFC-project-glyph-grid.md) §4, §9.3). Recency is the point of the graph. |
| Recency halo (`--k-geo`) instead of force-solid | Complementary, not a substitute — 19 hollow hexes would still look empty. Later. |
| Retarget ME wedges to `tokens_total` share | Would **zero out command-code and copilot** (tokenless) and **enlarge Pi** (~70% of tokens). The pie's axis is session count on purpose (`meGlyph` comment) so tokenless harnesses remain visible. Name it; don't invert it. |
| Inner consumption ring on the ME hex in v1 | Second axis on r=56. Caption is cheaper and testable. |
| Swap `AVG TOOL TYPES` for `user_turns` (729) | Personal, but weaker than thousands of tool calls; session card already speaks `TOOL CALLS`. Turns can stay a later caption. |
| Swap for "17 months" as a stat | Already in the header date range and the epithet. Don't spend a 20px row on a number printed twice. |
| Print `topProject` raw | Home-directory slug on a PNG that leaves the machine. |
| Change `deriveLabel` in this PR | Touches analyzers, orchestrator, graph labels, every harness dialect. Different RFC. |
| File-based display name (`~/.agents/identity.json`) | No such file exists. Experience layer has no write path. localStorage matches every other personalization (`kaaro-glyph-board`, audio, shortcuts). |
| Prompt on first share for a name | Hostile. Opt-in field on the preview is enough. |
| Legend collapse to top 4 in v1 | Geometry: `legendY0 = 412`, below ME. Six rows still fit. |
| Pulse strip in the same PR as solid hexes | Layout collision with epithet + honest caption; independently reviewable as PR 3 on top of PR 1. |
| Populated-only pulse buckets | Hides the Mar–Dec 2025 hole. Dense calendar is the contribution-graph demotion. |
| Exact docking / mosaic / contribution graph / public URL / GIF | Already rejected (RFC-share-cards §5). |
| `ai_title` chips | Crowded + prompt-adjacent. Not on a leaving-the-machine PNG. |
| Two-line field caption | 46px gutter can take it, but the short one-liner with `letter-spacing` dropped already fits 575px with overflow. |

---

## 8. Files

| File | Role |
|---|---|
| `experience/client-core.mjs` | `projectGlyphMarkup` gains `forceSolid`. New exports: `humanizeProjectLabel`, `sanitizeDisplayName`, `usageEpithet`, `usageShareFilename`, `applyDisplayName`, `HARNESS_EPITHET_LABEL`. `buildUsageShareCardData` return-shape additions. `generateUsageShareCardSVG` caption / stats / ME caption y=402 / footer / header wordmark. `_shareHeader` optional `wordmark` (`esc` + `toUpperCase`, letter-spacing 3px). `buildShareText` usage branch. |
| `experience/client/21-share-card.js` | Pass `displayName` from `localStorage['kaaro-display-name']`. `_showPreview` let-box; usage preview `<input>` (Register A inline styles); `applyDisplayName` on commit; Share reads the box. **Not Node-tested** (coverage gap). |
| `experience/pages/template.html` | `#me-share-btn` already in the ME dock — no markup change expected in PR 1–2 (name field is overlay-only). |
| `test/client-core.test.mjs` | Extend: forceSolid dock-unchanged + usage-card solid; humanize table (exact `kaaroViewer`, leading-hyphen alfred, CC `kaaro-src-*`, cwd `kaaro-src`); caption width + overflow; epithet table; sanitize regex; `usageShareFilename` / `applyDisplayName`; assembler `tool_calls` reduce; SVG contains `HEAVIEST`, honest caption, `WEDGES = SESSIONS` at x=1020.4, `TOOL CALLS`, humanized name, no `Users-` slug, no `size = activity`, no `AVG TOOL TYPES`; `buildShareText` possessive + epithet. |
| `RFC-me-share-card.md` | This document, copied into the repo. |

No `experience/` → `hooks/` imports. No new deps. `build.mjs` `stripExports()` unchanged (`export function` only). Session and project cards untouched except `_shareHeader`'s new optional arg (default preserves current SVG).

---

## 9. Observability

This is a client-side PNG generator, not a server path. There is no metric, log line, or alert to add in `serve.mjs`.

- **Tests** are the regression net: `node --test test/client-core.test.mjs`.
- **Browser smoke** (chrome-devtools MCP or equivalent), same as RFC-share-cards §9: open `/graph`, click `◆ SHARE USAGE CARD`, confirm project hexes are solid, `HEAVIEST` is the humanized heaviest label, caption, ME `WEDGES = SESSIONS`, Share/Save rasters without a console error. After PR 2: type a name, Share, confirm the PNG wordmark and filename match. Repeat unsigned.
- **Negative:** landing `/` and the left dock still show idle projects hollow. Lattice / Force graph unchanged.
- Do **not** log `displayName` or epithet to the server. `GET /status` stays `{ rebuilding, lastBuilt, clients, port }`.

---

## 10. Key Decisions

1. **`forceSolid` option on `projectGlyphMarkup`, not a fork and not a dock-grammar change.** Idle-hollow is live-dock grammar; an all-time card is a portrait of every project that has sessions. One flag, default false. Highest-leverage fix.

2. **Do not retarget the ME pie.** `meGlyph` pies session count so **command-code, copilot, and any tokenless harness** remain visible. On this dump a token pie would **hide them and enlarge Pi** (~70% of tokens, 57% of sessions). Claude's 42.1M at 6% of the face is honest once the axis is named (`WEDGES = SESSIONS`). An inner consumption ring is later.

3. **Swap `AVG TOOL TYPES` for `TOOL CALLS`, not `user_turns` or span.** The exact sum of session `tool_calls` is the stronger census; the session card already uses that label; `user_turns` is more "personal" but weaker; 17 months is already in the header and the epithet. `fmtTok` would print `4k` — renderer uses `String(tool_calls)`. Avg diversity survives as `(avg N)` in the size caption.

4. **Humanize locally; do not touch `deriveLabel`.** Experience cannot import `hooks/`. A pure `humanizeProjectLabel` in `client-core.mjs` is the right scope. More-specific prefixes first, then leftover `^kaaro-src-`. Prefix-strip, not last-hyphen-token. Never emit `Users-*`. Cwd-as-project `Users-arshigoyal-kaaro-src` → `kaaro-src`, not `home`.

5. **Heaviest is a 5th stat, not a second field caption.** The spatial encoding (spiral index 0) becomes `HEAVIEST · kaaroViewer`. `legendY0` is **412** (below ME backing + WEDGES at 402). That is why legend collapse is not v1.

6. **Display name is localStorage-only, opt-in, assembler-pure. Signed card replaces the wordmark.** No identity file exists; do not invent one. Key `kaaro-display-name`. Sanitize allow-list, max 24. Name in via `opts`. Overlay mutates via `applyDisplayName` + a `let` box so Share rasters the signed SVG. **Decided by human reviewer 2026-08-30:** the 20px `KAAROSESSIONS` wordmark becomes `ARSHI` (uppercase `displayName`); kicker stays `FULL USAGE CANVAS · INTELLIGENCE TRACE`; footer keeps `◆ KAAROSESSIONS`. This is a portrait, not a kicker prefix. Unset name = today's card.

7. **Epithet is a pure function with a ≥50% majority rule.** No LLM. `{n}-harness operator` only for n ≥ 2. **Decided by human reviewer 2026-08-30:** `-native` only at ≥ 50% session share. A 40/30/30 mix has no `-native` clause. Always-naming the top harness is rejected (would stamp `Claude-native` on a 34% plurality). Labels from `HARNESS_EPITHET_LABEL`, not registry `label`. Span is elapsed months when both dates exist; same-month uses the UTC day-delta one-liner. Heaviest clause truncated to 18. Empty canvas is `empty canvas`, not the old `ALL PROJECTS · ALL TIME`.

8. **Pulse strip is PR 3, not v1, and it is a dense calendar.** Inclusive `dateFrom`…`dateTo` months (18 cells on this dump, empty months as hairline holes). Not populated-only (that would be 6 and hide the 2025 gap). Opacity `0.15 + 0.85 * (n / maxN)`; width `(fieldX1 - fieldX0 - (n-1)) / n`.

9. **One assembler, one renderer, card-is-the-artifact, Register A, no `hooks/` import — not reopened.** v2 is an increment on RFC-share-cards v3, not a redesign of the constellation.

10. **`21-share-card.js` glue stays in the coverage gap.** New logic that can be pure (`sanitizeDisplayName`, `usageEpithet`, `humanizeProjectLabel`, `usageShareFilename`, `applyDisplayName`, assembler fields) lives in `client-core.mjs` and is Node-tested. Overlay input is browser-smoked; its contract (let-box, commit, Share) is specified so the artifact cannot silently stay unsigned.

---

## 11. Open questions

Decided by the human reviewer (2026-08-30) — recorded in §10, not forks:

1. **Wordmark replacement vs kicker prefix — replace the wordmark.** 20px `KAAROSESSIONS` becomes `ARSHI` (uppercase display name). Footer keeps `◆ KAAROSESSIONS`. Kicker is not prefixed. (KD 6)

2. **Majority threshold — keep ≥50% session share** for the `-native` clause. A 40/30/30 mix has no `-native` clause. Always-naming the top harness is rejected. (KD 7)

Inherited, not blocking:

3. **`21-share-card.js` has no automated tests** (RFC-share-cards §8.1). This increment adds an overlay `<input>`. Still browser-smoke unless someone stands up jsdom.

4. **Caps 60 / 200** still un-eyeballed past a power-user history (RFC-share-cards §8.2).

Not open (decided in §10): wordmark vs kicker; 50% vs plurality-native; tool_calls vs user_turns; pulse strip in v1; dense vs populated-only months; ME wedges caption in v1; localStorage vs file; WEDGES y vs legend y; caption one-liner vs two-line.

---

## 12. Rollout

No feature-flag infra exists. Rollout is **three independently reviewable PRs, stacked 1 → 2, 3 optional on 1** (see **PR Plan**). They are not independently *mergeable* in parallel: PR 2 needs PR 1's `topProjectShort` / `humanizeProjectLabel`. Each PR is tests-first (`node --test test/client-core.test.mjs`) plus a headed browser smoke of `/graph` → `◆ SHARE USAGE CARD`.

- **PR 1** can ship alone: the card becomes truthful even with the old footer and anonymous share text.
- **PR 2** stacks on PR 1 (epithet wants the short name).
- **PR 3** is optional on PR 1 (field caption already longer; strip must not collide). Works with or without PR 2 (epithet lives in the footer, strip lives in the field gutter).

Rollback is `git revert` of that PR. No persist besides `kaaro-display-name`; reverting PR 2 leaves a stale localStorage key that nothing reads — harmless. No migration.

---

## 13. Success

On `/graph` against this machine's `sessions-data.json` after PR 1:

- Project hexes that have harnesses are solid wedges, including those with `recencyLevel === 0` (19 of 20 on the snapshot).
- Left dock + landing field + Force/Lattice graph still show those idle projects hollow.
- Caption is exactly the §4.4 string (with `(avg N)` and optional overflow). No `size = activity`. No `letter-spacing:1px` on that `<text>`.
- Fourth stat is `TOOL CALLS` and the **exact sum** of session `tool_calls` (`String(...)`, not `fmtTok`, not `AVG TOOL TYPES`). Tests use fixtures; a live smoke will not see `4253` if the census has drifted.
- Fifth stat is `HEAVIEST` / `kaaroViewer` (or whatever `humanizeProjectLabel` of the current heaviest label is). No `Users-arshigoyal` anywhere in the SVG. Lock test: `humanizeProjectLabel('Users-arshigoyal-kaaro-src-kaaroViewer') === 'kaaroViewer'`.
- ME medallion still pies session count; `WEDGES = SESSIONS` sits at y=402, `text-anchor="middle"`, x=1020.4.

After PR 2:

- Footer epithet matches `usageEpithet` for the live mix (snapshot: `6-harness operator · Pi-native · 17 months · heaviest world: kaaroViewer`).
- Unnamed share text carries the epithet + range. Named: wordmark `ARSHI`, share text `arshi's kaaroSessions canvas`, file `kaaro-arshi-2026-08.png` (or current `dateTo` month). Typing a name in the preview and hitting Share rasters the **signed** PNG (`box.svg`).
- Session and project cards visually unchanged (default wordmark).

`node --test` green. `test/design-lint.test.mjs` still clean (no new blue chrome, no shadows, no radius > 2px in page CSS). No `SyntaxError` from `stripExports()`.

---

## References

- [RFC-share-cards.md](./RFC-share-cards.md) — v1 constellation, v2 mosaic, v3 layered field; constraints.
- [RFC-project-glyphs.md](./RFC-project-glyphs.md) — hex primitive, `sizeNorm` = consumption, harness wedges.
- [RFC-project-glyph-grid.md](./RFC-project-glyph-grid.md) — idle = hollow, active = solid; lattice as a layout.
- `experience/client-core.mjs` — `meGlyph`, `meGlyphMarkup`, `projectGlyphMarkup`, `isProjectGlyphActive`, `buildUsageShareCardData`, `generateUsageShareCardSVG`, `buildShareText`, `_shareGeom` / `_shareHeader` / `_shareFooter` / `_shareStatRows`, `SHARE_CARD_TOKENS`, `MOSAIC_MAX_SESSIONS`, `CONSTELLATION_MAX_PROJECTS`, `hexPath`, `harnessWedges`, `glyphSpiralCell`, `glyphCellPosition`.
- `experience/client/21-share-card.js` — `#me-share-btn` wiring; `_showPreview` today captures `svgString`/`cardData` as `const`.
- `experience/pages/template.html` — `#me-share-btn` in the ME glyph dock.
- `experience/graph-pipeline.mjs` — session/project node fields the assembler can see.
- `hooks/sessions-schema.mjs` — `OPTIONAL_SESSION_FIELDS`.
- `hooks/helpers/analyze-helpers.mjs` — `deriveLabel` (untouched).
- `hooks/registry.mjs` — harness `label` (not `HARNESS_EPITHET_LABEL`); Pi `capabilities.tokens: true`.
- `test/client-core.test.mjs` — usage-card + glyph tests to extend.

---

## PR Plan

Three independently **reviewable** PRs, stacked **1 → 2**, **3 optional on 1**. TDD: failing tests in `test/client-core.test.mjs` before the `client-core.mjs` change. Browser smoke per PR, not a jsdom lane. Do not put `forceSolid` and the overlay input in one diff; do not put the pulse strip with the encoding fixes.

### PR 1 — Truthful encoding

**Title:** `fix(share-card): solid all-time hexes, honest size caption, print heaviest, tool-call stat`

**Files / components:**

- `experience/client-core.mjs` — `projectGlyphMarkup({ forceSolid })`; `humanizeProjectLabel` + `HUMANIZE_PREFIXES`; `buildUsageShareCardData` adds `topProjectShort`, `tool_calls` (`reduce` + `|| 0`), `avg_diversity`; `generateUsageShareCardSVG` passes `forceSolid: true`, §4.4 caption (no letter-spacing), `TOOL CALLS` + `HEAVIEST` stats, `WEDGES = SESSIONS` at y=402, `legendY0 = 412`.
- `test/client-core.test.mjs` — forceSolid / dock-unchanged; humanize table (lock `=== 'kaaroViewer'`, leading-hyphen alfred, CC `kaaro-src-*`, cwd `kaaro-src`); caption `length * 5.4 < 575` with overflow; usage SVG assertions (solid idle hex, no `Users-` slug, no `size = activity`, no `AVG TOOL TYPES`, has `HEAVIEST`, has `WEDGES = SESSIONS` at x=1020.4, has `TOOL CALLS` as the sum).
- `RFC-me-share-card.md` — this RFC, checked in.

**Depends on:** nothing.

**Description:** The PNG stops lying. Idle-hollow stays the live dock. `deriveLabel` and `21-share-card.js` untouched. Footer still `ALL PROJECTS · ALL TIME`; share text still `My kaaroSessions canvas` + counts. That anonymity is PR 2.

### PR 2 — Epithet + opt-in name

**Title:** `feat(share-card): deterministic epithet and opt-in display name`

**Files / components:**

- `experience/client-core.mjs` — `sanitizeDisplayName`, `usageEpithet`, `HARNESS_EPITHET_LABEL`, `usageShareFilename`, `applyDisplayName`; assembler `displayName` / `epithet` / `shareFilename`; `_shareHeader` `wordmark` (`esc` + `toUpperCase`); usage footer `tagLine: data.epithet`; `buildShareText` usage branch.
- `experience/client/21-share-card.js` — read/write `localStorage['kaaro-display-name']`; `_showPreview` let-box; usage preview `<input>` (snippet in §4.8); `applyDisplayName` on commit; Share reads `box`.
- `test/client-core.test.mjs` — epithet table (this dump + empty + single-harness + synthetic tokenless + same-month 29 days); sanitize regex; `usageShareFilename` / `applyDisplayName` (including `"..."` → anonymous file); named vs unnamed header/share-text/filename; assembler does not read localStorage (pass-in only).

**Depends on:** PR 1 (`topProjectShort` / `humanizeProjectLabel`).

**Description:** Footer becomes the portrait sentence. Signing is opt-in and preview-local. **Decided:** signed usage card replaces the 20px wordmark with the uppercase display name; kicker unchanged; footer keeps `◆ KAAROSESSIONS`. Session/project cards unchanged (default wordmark). No identity file. Share after rename must not raster the unsigned original. `-native` only at ≥ 50% session share.

### PR 3 — Monthly pulse strip (optional)

**Title:** `feat(share-card): monthly pulse strip on the usage canvas`

**Files / components:**

- `experience/client-core.mjs` — assembler `months[]` dense inclusive calendar; renderer 10px cells, width/opacity formulas in §4.11; caption to `fieldY1 + 28`.
- `test/client-core.test.mjs` — 2025-03-01 → 2026-08-30 + six populated months → **18 cells**, `2025-04.sessions === 0`; empty → none; span > 24 → last 24.

**Depends on:** PR 1 (field caption already specified; strip must not collide). Works with or without PR 2.

**Description:** The allowed demotion of the rejected contribution graph — dense calendar, empty months as holes. Does not replace the constellation. Skip if PR 1–2 layout is already tight on a live smoke.
