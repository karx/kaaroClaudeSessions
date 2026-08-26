# RFC: Project Glyphs

**Project:** kaaroSessions  
**Status:** Implemented (PR #11)  
**Date:** 2026-08-25  
**Relates to:** multi-harness project identity · force-graph node language · session `sizeNorm` / consumption  
**Grounding:** live `sessions-data.json` on the authoring machine (2026-08-24), 24 project nodes, 3 label collisions

---

## 1. Problem

The history view is a force graph of **projects → sessions → files**. Three type-glyphs exist:

| Type | Primitive | Size |
|---|---|---|
| session | filled circle | `√(tokens_work / MAX_WORK)` or `√(tool_calls / MAX_CALLS)` if work is 0 |
| file | diamond | `√((write+edit) / MAX_FILE_W)` |
| cluster | dashed circle + count | own-scale work-or-calls |
| **project** | **hollow ringed circle, fixed 26px** | **none** |

Projects are the *place* the graph is about, and they are the weakest mark:

1. **Same shape family as sessions.** A project is a hollow circle; a session is a filled circle. Recency is an extra pulsing ring on both. The type distinction is fill, not primitive.
2. **No consumption.** Radius does not track `tokens_total`, `tokens_work`, or session count. A 17-session `kaaroSessions` ring is the same size as a 1-session Pi fork.
3. **Duplicates from unnormalized IDs.** The graph groups by `project_id`, not by path. Labels already collapse (`deriveLabel` / last-segment); IDs do not. The viewer sees two **EBRAIN** planets.

These are one RFC because a prettier ring on top of two IDs still looks like two repos.

---

## 2. Ground truth: live collisions

From `sessions-data.json` on this machine:

| label | `project_id` | harnesses | sessions |
|---|---|---|---|
| ebrain | `D--src-ebrain` | claude-code, grok | 13 |
| ebrain | `--D--src-ebrain--` | pi | 6 |
| kaaroSessions | `D--src-kaaroSessions` | copilot, antigravity, claude-code, grok | 17 |
| kaaroSessions | `--D--src-kaaroSessions--` | pi | 1 |
| art-of-intent | `D--src-art-of-intent` | copilot, grok | 2 |
| art-of-intent | `--D--src-art-of-intent--` | pi | 1 |

**24 project nodes** of which **6 are forks of 3 repos.**

Cause:

- Claude Code / Grok / Antigravity / opencode / copilot converge on `Drive--src-name` (Grok reuses `deriveAntigravityProjectId`).
- Pi stores `--Drive--src-name--`. `derivePiLabel` strips wrapping `--` **for the label only**. `buildSessionsOutput` still keys `projectMap[sess.project_id]`.
- Command Code can still emit `users-<user>-<path>` — a fourth dialect not in this dump but documented in `docs/harnesses.md`.

`deriveLabel` (`^[A-Za-z]--src-` / Users prefix) is a **display** helper. It is not a merge key. Grouping by `label.toLowerCase()` would false-merge two different folders both named `ebrain`.

---

## 3. Goals

1. **One project node per real workspace** across harnesses, when the path slug is the same repo.
2. **A project glyph that is not a circle.** Sessions keep the disk; files keep the diamond; clusters keep the dashed count-circle. Projects get a new primitive.
3. **Size encodes overall consumption** for token-bearing sessions at the project rollup (`tokens_total` = input + cache_create + cache_read + output). Tokenless members contribute an explicit stand-in, not a silent second axis.
4. **Harness presence is visible on the glyph** (which agents touched this repo) without splitting the node.
5. **Raw IDs remain recoverable** for debug and for `/api/*` that still speak harness-native slugs.

Non-goals:

- Merging by display label alone.
- Changing session or file primitives.
- Using live SSE / synthetic token pulses to size the graph (analyze snapshot only).
- Folding Command Code `users-*` blindly without a path-tail proof.

---

## 4. Identity: canonical project key

### 4.1 Function

New pure helper (name bikeshed: `canonicalProjectId(rawId)`), in `hooks/helpers/analyze-helpers.mjs` next to `deriveLabel`:

```
strip wrapping `-` / `--`
uppercase a leading `X--` drive letter if present
do not lowercase the rest (Windows paths in CC slugs are mixed)
```

Examples (must be tests):

| raw | canonical |
|---|---|
| `D--src-ebrain` | `D--src-ebrain` |
| `--D--src-ebrain--` | `D--src-ebrain` |
| `d--src-ebrain` | `D--src-ebrain` |
| `D--src-kaaroSessions` | `D--src-kaaroSessions` |
| `--D--src-kaaroSessions--` | `D--src-kaaroSessions` |

Command Code `users-<user>-D--src-ebrain` (or equivalent): strip a leading `users-<nonDash>-` **once**, then apply the same strip. If the remainder does not look like a drive slug, leave the id unchanged (no false merge).

### 4.2 Where it is applied

**Only** in `buildSessionsOutput` (`surface/analyze-orchestrator.mjs`), when grouping sessions into projects:

```
key = canonicalProjectId(sess.project_id)
projectMap[key].push(sess)
```

Session objects **keep** their harness-native `project_id` (watch, locators, `/api/trace` must not break). The project summary’s `id` becomes the canonical key. Extra fields on the project:

```
id            canonical slug
label         existing deriveLabel / sample.project_label (last segment)
raw_ids       sorted unique original project_id values
harnesses     sorted unique session.harness values
```

`buildGraph` passthrough: project nodes gain `raw_ids`, `harnesses`. Membership edges still go `session → project.id` (canonical). Session `project_id` on the **session node** can stay native for filters; the membership target is the unified project.

Alternatively (cleaner for filters): set `session.project_id` to canonical at enrich time and keep `session.project_id_raw`. Prefer **orchestrator-only rewrite of the project bucket** first; mutating every session is a larger contract change. Decision: **v1 mutates only the project summary `id` and the membership edge target.** Session records in `sessions-data.json` keep native ids. Graph session nodes get `project_id` overwritten to the canonical id when the node is built, so layout and filters see one project. Native id stays on `sess` in the JSON for analyzers.

### 4.3 Colors

`assignProjectColors` keys on project id. After unify, one color per repo. Today Pi ebrain and CC ebrain can get two palette slots for the same word.

---

## 5. Glyph

### 5.1 Primitive: hex

**Lock: regular hexagon**, pointy-top, stroke in project color, fill `KAARO_TOKENS.bg`, inner fill at 0.12 opacity (same hollow language as today’s ring, different silhouette).

Why hex, not rounded square / double-ring / octagon:

| Candidate | Why not |
|---|---|
| Hollow circle (today) | Same family as session |
| Double ring | Still a circle; recency already uses rings |
| Rounded square | `border-radius` fights Register A; in SVG `rx` looks like a squircle |
| Octagon | Too close to circle at 26px |
| **Hex** | Distinct from circle and diamond at small size; reads as “cell / place”; 6 vertices can host harness ticks |

File diamonds stay `M0,-r L r,0 L0,r L-r,0 Z`. Hex path (pointy-top, radius `r`):

```
for k in 0..5: (r·sin(k·60°), -r·cos(k·60°))
```

Radius from `nodeRadius`: new `PR_MIN` / `PR_MAX` (e.g. 18–34) so a hex is in the same visual weight as today’s 26px circle at mid scale, not drowning sessions (`SR_MAX` 20).

### 5.2 Size: overall consumption

Project `sizeNorm`:

```
consumption(p) =
  tokens_total  if tokens_total > 0
  else tool_calls of member sessions   // tokenless-only project
sizeNorm = √(consumption / MAX_CONSUMPTION)
```

`tokens_total` is already on the project from `enrichProject` (input + cache_create + cache_read + output). That **is** overall consumption for token-bearing members.

A mixed project (CC + Grok on `D--src-kaaroSessions`): `tokens_total` is dominated by CC. Grok’s tool_calls do not add a second axis. Honest: we do not have Grok tokens; we do not pretend. The hex is still one node; harness ticks show Grok was there.

A Pi-only fork that we **unify** into that hex disappears as a duplicate; its sessions hang off the same hex. A remaining tokenless-only project (no CC sessions) uses tool_calls so it is not a 18px speck.

Do **not** size projects by `tokens_work` (output + cache_create). Cache read is most of billed consumption on CC; omitting it was the session-node bug. Projects, at least, tell the truth about total.

Session node sizing is **out of this RFC’s implementation** except a one-line note in §8: same consumption rule should follow in a later unit so session disks and project hexes share a definition of “big.”

### 5.3 Depth: harness fill

The hex *interior* encodes how many harnesses touched the repo. Stroke stays the project color (place). Fill uses `HARNESS_MARK` at `HARNESS_FILL_OPACITY` 0.35 (a cell, not a neon pie):

| n | fill |
|---|---|
| 1 | solid hex in that harness color |
| 2 | split through the top–bottom vertices |
| 3 | 120° center fan (vertex-aligned) |
| 4+ | equal-angle polygons from the center to each side/corner the ray hits |

`harnessWedges(harnesses, r)` in `experience/client-core.mjs` is the geometry. Never a second project node. `session_count` is not written inside the hex — count stays in the hover panel / `◆ HARNESSES` list.

Harness colors are data, not chrome (same idea as `TOOL_COLORS`). No blue-family hues — Register A retired navy chrome.

### 5.4 Recency

Keep the existing `.pring` animation, but the pulse follows the **hex bounding circle** (`r + 6`), not a second inner circle language. One motion, new silhouette.

### 5.5 Label

Unchanged: uppercase `d.label` under the glyph. After unify, one label.

---

## 6. Data on the project node (graph payload)

```
{
  id, type: 'project', label, color,
  session_count, tokens_total, tokens_work,
  harnesses: string[],     // NEW
  raw_ids: string[],       // NEW
  sizeNorm,                // NEW
  last_activity, recency, recencyLevel
}
```

`buildGraph` computes `sizeNorm` from `tokens_total` (passthrough numbers from enrich; the √ / max is a **layout** scale, same as sessions today). Tests: fixture two projects with known totals → `sizeNorm` 1.0 and √(small/big).

---

## 7. Alternatives rejected

| Option | Why not |
|---|---|
| Merge by `label.toLowerCase()` | Two folders named `ebrain` become one |
| Leave Pi `--` ids, only change the glyph | Two hexes labelled EBRAIN |
| Size by `tokens_work` | Ignores cache_read; not “overall consumption” |
| Size by `session_count` | A long cached CC session out-consumes ten empty Pi chats |
| Synthetic token pulses for Grok sizing | Live pulse path; graph is analyze snapshot; adapters never set `content_length` |
| Rounded square | Register A anti-pattern; weak vs diamond |
| Pie-chart fill per harness | Chrome, not a mark; unreadable at 20px |

---

## 8. TDD units (implementation, not this RFC’s commit)

Follow EXECUTION.md: 🔴 failing test → 🟢 minimal code → 📦 one commit per unit.

**Unit G1 — `canonicalProjectId`**  
`test/analyze-helpers.test.mjs` (new or extend): table in §4.1. Implement in `analyze-helpers.mjs`. Pi `derivePiLabel` unchanged.

**Unit G2 — orchestrator merge**  
`test/analyze-orchestrator.test.mjs`: CC session `D--src-ebrain` + Pi session `--D--src-ebrain--` → `projects.length === 1`, `session_count === 2`, `raw_ids` has both, `harnesses` is `['claude-code','pi']` (sorted). Green: `buildSessionsOutput` groups on canonical id.

**Unit G3 — graph passthrough + sizeNorm**  
`test/graph-pipeline.test.mjs`: project node carries `harnesses`, `raw_ids`; `sizeNorm === 1` on the max-`tokens_total` project; tokenless-only project (`tokens_total: 0`, `tool_calls` on members — may need the summary to expose `tool_calls`, already on `buildProjectSummary`) uses the fallback. Membership edge target is canonical id; session node `project_id` matches.

**Unit G4 — `nodeRadius` for projects**  
`test/client-core.test.mjs`: `type:'project'` uses `PR_MIN`/`PR_MAX` × `sizeNorm` (not fixed 26).

**Unit G5 — hex path helper**  
Pure `hexPath(r)` / `harnessWedges(harnesses, r)` in client-core. `04-rendering.js` fills the hex by harness count. Visual proof: `node build.mjs`, `/graph`, one EBRAIN hex, Pi sessions attached.

**G6 (landed):** session `sizeNorm` uses `tokens_total` (overall consumption), same as project hexes. `tool_calls` fallback when total is 0. Timeline/swimlane stay on `tokens_work`.

---

## 9. Files

| File | Role |
|---|---|
| `hooks/helpers/analyze-helpers.mjs` | `canonicalProjectId` |
| `surface/analyze-orchestrator.mjs` | group on canonical id; `raw_ids`, `harnesses` |
| `hooks/analyze.mjs` `buildProjectSummary` | expose `tool_calls` on project if not already |
| `experience/graph-pipeline.mjs` | passthrough + project `sizeNorm` |
| `experience/client-core.mjs` | `hexPath`, `harnessWedges`, `HARNESS_MARK`, `PR_MIN`/`PR_MAX` |
| `experience/client/04-rendering.js` | hex + ticks |
| `test/analyze-helpers.test.mjs` | G1 |
| `test/analyze-orchestrator.test.mjs` | G2 |
| `test/graph-pipeline.test.mjs` | G3 |
| `test/client-core.test.mjs` | G4–G5 |

No `experience/` → `hooks/` imports.

---

## 10. Key decisions

1. **Merge on canonical path slug, not label.** Prevents false merges.
2. **Hex, not another circle.** Type is silhouette.
3. **Project size = `tokens_total` (overall consumption),** tool_calls only when the unified project has no tokens at all.
4. **Harness fill on the hex, not extra nodes or stroke ticks.**
5. **Session JSON keeps native `project_id`.** Graph membership uses canonical id.
6. **Synthetic flutes stay out of graph sizing.**

---

## 11. Open questions

1. **Command Code `users-<user>-…`:** implement the strip in G1 now, or wait for a live collision? Recommendation: include the strip in G1 tests with a synthetic id; no production Command Code dump required.
2. **Hex pointy-top vs flat-top.** Recommendation: pointy-top (stronger “not a circle” at 20px).
3. **G6 (session size → `tokens_total`)** in the same PR as G1–G5 or after? **After, then landed on PR #11.** Max session radius is unchanged (still 0…1 → 5–20px); only ranking shifts toward cache-read-heavy sessions.

---

## 12. Success

On `/graph` after analyze+build:

- One node labelled EBRAIN (and KAAROSESSIONS, ART-OF-INTENT).
- That node is a **hex**, not a ring.
- Larger hexes are the high-`tokens_total` repos.
- Hex fill splits match the harnesses that actually have sessions there (quiet 0.35 opacity).
- Session disks use the same consumption definition.
- `node --test` green; no duplicate project ids in `buildGraph` output for the Pi `--…--` dialect.
- Performance verification is **REQ-GRAPH-PERF-01** (`docs/GRAPH-PERFORMANCE-REQUIREMENT.md`) — a headed Chrome DevTools run, not claimed by the glyph implementation.
