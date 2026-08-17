# Ontology / Meta View — a 6th graph layout mode

> **Status:** exported mid-implementation for discussion. Unit 1 is partially
> started (`hooks/action-keys.mjs` has `isBashToolName` factored out; failing
> tests for `computeToolMix` are written in `test/enrich-session.test.mjs`;
> `hooks/enrich-session.mjs` itself not yet touched). Nothing else from the plan
> has been implemented. Paused here per request to go back and forth before
> continuing.

## Context

Real session data (94 sessions, 6 harnesses) shows genuinely striking ontological
differences between harnesses — not assumptions, measured:

| Harness | avg tokens_work | avg tool_calls | tool diversity | branches | ai_title | skills |
|---|---|---|---|---|---|---|
| claude-code | 867,505 | 66.4 | 6.7 | 100% | 100% | 48% |
| grok | 0 (tokenless) | 111.1 | 7.2 | 100% | 100% | 0% |
| antigravity | 0 (tokenless) | 71.4 | 6.8 | 0% | 0% | 0% |
| pi | 10,729 | 8.4 | 1.5 | 0% | 0% | 0% |
| opencode | 1,250 | 7.5 | 1.6 | 0% | 100% | 0% |
| copilot | 604 (partial) | 6.4 | 1.9 | 0% | 71% | 0% |

The user wants a **Graph Explore Meta View** that exaggerates these differences —
approved design: a per-session **scatter** (each dot is one real session, not a
harness rollup) colored/shaped by harness, with an on-demand per-harness **radar**
fingerprint overlay, plus (added mid-planning) a **tool contribution-ratio**
breakdown per harness so "tool diversity" (already a scalar) gets a companion view
showing *which* categories make up that diversity.

Architecturally this slots in as a **6th layout mode** (`ontology`) alongside the
existing force/swimlane/arc/matrix/3d modes in `experience/client/11-layout-manager.js`
— not a new page. Every field needed already exists on session nodes in
`graph-data.json` (`harness`, `tokens_work`, `tool_calls`, `tool_diversity`,
`context_resets`, `ai_title`, `subagent_count`, `branches`, `skills`) except one:
canonical **tool-mix ratios**, which needs a small upstream addition since
`session.tools` is keyed by raw per-harness tool names (`"Bash"`, `"view_file"`,
`"run_command"`...), not the canonical vocabulary (`read`/`write`/`bash_git`/...)
needed for cross-harness comparison.

## Design decisions locked during exploration

- **Reuse, don't invent, at every layer:**
  - `sess.tool_diversity` (already computed in `hooks/enrich-session.mjs:21`) is
    reused directly as the "diversity" axis — no new diversity metric needed.
  - Canonical tool categories reuse `toolNameToKey()` from `hooks/action-keys.mjs`
    (already the single source of truth for the 10-key vocabulary
    `read/write/edit/grep_glob/agent/bash_git/bash_run/bash_other/web/other`).
  - Bash sub-typing (git/run/other) reuses the **already-tracked**
    `session.bash_categories` counts rather than re-deriving from `session.tools`
    (which has no per-call category attached) — this needs one small new export,
    `isBashToolName(name)`, added to `hooks/action-keys.mjs` so the bash-name list
    isn't duplicated between `toolNameToKey` and the new tool-mix computation.
  - Harness color assignment mirrors `assignProjectColors`/`PALETTE` in
    `experience/graph-data.mjs` (same signature shape, applied to harness ids
    instead of project ids).
  - Tool-category colors reuse the exact hex values already defined per-key in
    `DAW_FAMILY_LANES` (`experience/client-core.mjs`) — e.g. `write:'#00cc55'`,
    `edit:'#ccaa00'`, `read:'#3a6aaa'`, `bash_git:'#cc5522'` — so the new tool-mix
    bars read as the same "color is grammar" vocabulary as the DAW view, not a
    fresh palette.
  - Static positioning (`fx`/`fy` + `applyStaticPositions()`) and the
    decorLayer/dim-on-click patterns mirror `experience/client/08-arc.js` exactly.
  - Harness capability injection (`%%HARNESS_CAPS_JSON%%`) mirrors the existing
    `%%TRACE_HARNESSES%%` pattern in `build.mjs` line ~204, sourced from
    `HARNESS_REGISTRY` in `hooks/registry.mjs`.
- **No new HTTP endpoint, no new page** — `graph.html` stays self-contained;
  capability data is baked in at build time like `TRACE_HARNESSES` already is.
- **No `experience/ → hooks/` import** — canonicalization happens upstream in
  `hooks/enrich-session.mjs`; `experience/graph-pipeline.mjs` stays strict
  passthrough (same discipline as the `tokens_work` precedent, EXECUTION.md Item 3).

## Implementation (TDD units, red→green→commit each, per CLAUDE.md/EXECUTION.md convention)

**Unit 1 — canonical tool-mix in `hooks/`**
- `hooks/action-keys.mjs`: export `isBashToolName(name)` (the existing bash-alias
  list, currently inline in `toolNameToKey`, factored out so it's not duplicated).
- `hooks/enrich-session.mjs`: new export `computeToolMix(session)` — walks
  `session.tools` (raw name → `{calls, errors}`), skips bash-family names (handled
  below), calls `toolNameToKey(name)` for the rest, sums `.calls` into a
  fixed-shape `{read,write,edit,grep_glob,agent,web,other}` map; then sets
  `mix.bash_git/bash_run/bash_other` directly from `session.bash_categories`
  (`{git,run,other}` counts). `enrichSession()` sets `sess.tool_mix = computeToolMix(sess)`.
- Test in `test/enrich-session.test.mjs`: fixture session with mixed raw tool
  names across ≥2 "harnesses' vocabularies" (e.g. `Read`+`view_file` both → `read`)
  plus `bash_categories`, assert the summed canonical map and that bash counts
  come from `bash_categories` not re-derived.

**Unit 2 — schema + passthrough**
- `hooks/sessions-schema.mjs`: add `tool_mix` to `OPTIONAL_SESSION_FIELDS`.
- `experience/graph-pipeline.mjs`: add `tool_mix: sess.tool_mix || {}` to the
  session node object (strict passthrough, next to the existing `tools_top` line).
- Test in `test/graph-pipeline.test.mjs`: passthrough proof fixture (mirrors the
  Unit 3b precedent — a `tool_mix` value on the fixture that a formula could never
  produce, assert it survives unchanged onto the node).

**Unit 3 — harness capability injection**
- `build.mjs`: add `'%%HARNESS_CAPS_JSON%%': JSON.stringify(Object.fromEntries(HARNESS_REGISTRY.map(h => [h.id, h.capabilities.tokens])))`
  to the same `injectedJS` substitutions object that already sets `%%TRACE_HARNESSES%%`.
- `experience/client/01-data.js`: add `const HARNESS_CAPS = %%HARNESS_CAPS_JSON%%;`
  next to the existing `TRACE_HARNESSES` line.
- Test in `test/build-template.test.mjs`: marker-presence test (same shape as the
  existing `%%CLIENT_CORE%%`/`%%KAARO_TOKENS%%` marker tests).

**Unit 4 — pure ontology math in `experience/client-core.mjs`**
New exported functions (Node-tested in `test/client-core.test.mjs`, following the
file's flat `export function` convention, no DOM):
- `assignHarnessColors(harnessIds)` — same shape as `assignProjectColors`
  (sort ids, `PALETTE[i % PALETTE.length]`), returns `{HARNESS_COLORS}`.
- `computeOntologyMetrics(sessionNode, maxima, harnessCaps)` — per-session 0–1
  axes: `scale` (log-scaled `tokens_work`, falling back to `tool_calls` when
  `tokens_work` is 0 — same fallback idiom as `sizeNorm` in `graph-pipeline.mjs`),
  `diversity` (`tool_diversity / maxima.diversity`), `structure` (mean of 0/1:
  has `ai_title`, has `branches.length`, `subagent_count>0`, `context_resets>0`,
  `skills.length>0` — the composite summary), `density` (`message_count /
  max(duration_min,1)`, normalized against `maxima.density`). `maxima` is
  precomputed once per render (max across all visible sessions) and passed in
  — no hidden global state.
- `harnessSignature(sessionNodes, harnessId, maxima, harnessCaps)` — returns
  `{ shape: {scale,diversity,structure,density}, capability: {branches,tokenful,skills,ai_title} }`.
  `shape` averages `computeOntologyMetrics` across the harness's sessions.
  `capability` computes each signal as its own **rate** (fraction of the
  harness's sessions with that field present/truthy: `branches.length>0`,
  `skills.length>0`, `ai_title` truthy) except `tokenful`, which is the hard
  `harnessCaps[harnessId]` boolean (0 or 1) from `HARNESS_CAPS`, not a rate.
- `harnessToolMix(sessionNodes, harnessId)` — sums `tool_mix` counts across a
  harness's sessions, returns `{category: ratio}` (each divided by the summed
  total) — ratio-of-sums, computed once at aggregation time, never averaged
  per-session (which would skew toward small sessions). This is the
  "contribution ratios" donut data.

**Unit 5 — the layout module: `experience/client/20-ontology-layout.js`** (new
file; next available `NN-` slot per `orderClientModules()`, no browser tests —
documented gap per CLAUDE.md convention, same as other layout files)
- `getOntologyOpts()` — reads axis-picker `<select>` values (default x=`diversity`,
  y=`scale`).
- `computeOntologyPositions()` — for each session node, calls
  `computeOntologyMetrics`, maps chosen axes through a d3 linear scale into
  `fx`/`fy` (mirrors `computeArcPositions` in `08-arc.js`).
- `drawOntologyDecor()` — axis lines/labels/gridlines via `decorLayer` (mirrors
  `drawArcDecor`), plus a harness legend (swatches from `assignHarnessColors`)
  where clicking a swatch sets `focusedHarnessId` (single, mirrors
  `08-arc.js`'s `focusedArcFileId` pattern exactly) to dim everything else
  across the scatter + both radars + the donut strip — a focus affordance,
  not a selection gate. All harnesses always render regardless of focus state.
- `drawOntologyRadars()` — **two** small SVG polygon charts in fixed corners
  (shape + capability, per Unit 4's `harnessSignature`), one translucent
  polygon per harness in its legend color, always all 6-7 rendered.
- `drawOntologyToolMix()` — small donut per harness (`harnessToolMix` +
  `DAW_FAMILY_LANES` category colors), laid out as a strip/grid, always all
  6-7 rendered.
- `enter()`/`exit()` — same layer show/hide + cleanup shape as the `arc` handler.

**Unit 6 — wire it in**
- `experience/client/11-layout-manager.js`: add
  `ontology: { controls: ['ontology-options'], enter() {...}, exit() {...} }`
  to `LAYOUT_HANDLERS`, calling the Unit 5 functions.
- `experience/pages/template.html`: add `<button class="lay-btn" data-layout="ontology">Ontology</button>`
  next to the existing layout buttons (~line 619), and a `#ontology-options`
  panel (axis `<select>`s for x/y, harness legend container, two radar
  containers, donut-strip container) inside `#controls`, styled only with
  existing `--k-*` tokens — no new hex colors beyond the two reused tables
  above (design-lint forbids blue-hue chrome and any hex outside data-palette
  exemptions). No toggle checkboxes needed — radars/donuts are always-on.

**Unit 7 — manual verification**
`node analyze.mjs && node build.mjs && node serve.mjs`, open `/graph`, switch to
Ontology, confirm: clusters roughly match the measured table above (CC top-right/
biggest dots, opencode/pi/copilot bottom-left tight cluster, grok/antigravity
upper-left with high diversity), the shape radar's 6-7 overlaid polygons stay
visually distinct, the capability radar clearly shows the branches/ai_title/
skills/tokenful split from the measured table, tool-mix donuts show plausible
per-harness category splits (e.g. antigravity/grok heavy on read+grep_glob+
bash_run), clicking a legend swatch dims everything else consistently across
scatter+both radars+donuts, `node --test` stays green, `test/design-lint.test.mjs`
passes on the new template markup.

## Files touched
`hooks/action-keys.mjs`, `hooks/enrich-session.mjs`, `hooks/sessions-schema.mjs`,
`experience/graph-pipeline.mjs`, `build.mjs`, `experience/client/01-data.js`,
`experience/client-core.mjs`, `experience/client/20-ontology-layout.js` (new),
`experience/client/11-layout-manager.js`, `experience/pages/template.html`,
plus matching tests in `test/enrich-session.test.mjs`, `test/graph-pipeline.test.mjs`,
`test/build-template.test.mjs`, `test/client-core.test.mjs`.

## Resolved during discussion (final design)

- **Concurrent harnesses:** dropped the toggle/cap-at-3 model. **All harnesses
  are always shown at once.** No click-to-select gating what's rendered —
  legend clicks are a dim/focus affordance only (mirrors `08-arc.js`'s
  `focusedArcFileId` pattern: single `focusedHarnessId`, not a multi-select set).
- **Two radars, not one — "summary + detail":**
  - **Shape radar** (continuous 0-1, 4 axes): `scale`, `diversity`, `structure`
    (composite average, unchanged from the original design), `density`. All
    6-7 harnesses overlaid as translucent polygons.
  - **Capability radar** (per-signal rate, 4 axes): `branches`, `tokenful`,
    `skills`, `ai_title` — the same underlying signals broken out individually
    instead of averaged, for precise per-capability comparison. `subagent_count`
    and `context_resets` are **dropped** from this radar (not from the data) —
    both are ~0% for every harness in the real 94-session dataset right now,
    so as radar axes they'd just be flat/uninformative; `tokenful` (from
    `HARNESS_CAPS`, hard boolean not a rate) replaces them as the 4th axis
    since it's the one binary split that's actually stark (CC/pi/opencode
    tokenful vs grok/antigravity/command-code not).
  - `harnessSignature()` (Unit 4) returns both: `{shape: {scale,diversity,structure,density}, capability: {branches,tokenful,skills,ai_title}}`.
- **Scatter defaults:** x=`diversity`, y=`scale` (log tokens_work) — matches
  the measured data's clearest visual split (CC top-right, opencode/pi/copilot
  bottom-left, grok/antigravity upper-left).
- **Tool-mix: small donuts, not bars.** One compact donut per harness, all
  6-7 always visible in a strip/grid (no toggle, same "always show everything"
  principle as the radars). Category colors reuse `DAW_FAMILY_LANES` hex values
  as originally planned.
- **`tool_mix` data shape: raw counts**, not pre-computed ratios —
  `{read:5, write:1, edit:0, ...}` per session, matching how `tools_top` and
  `bash_categories` already store counts. `harnessToolMix()` (Unit 4) sums
  counts across a harness's sessions and divides once into ratios at render
  time — correct aggregation (ratio-of-sums, not average-of-ratios), and stays
  re-aggregable for any future consumer.

All five original open questions are now resolved; design is locked.
