# PR #3 Code Review — `refactor/two-layer` → `master`

**Reviewer role:** Senior Platform Engineer  
**Review date:** 2026-06-17  
**PR scope:** 177 files changed · +24,645 / −1,452 · 112 commits  
**Test suite:** 1435 tests · 1 failing (platform-specific path assertion)

---

## Executive Summary

This is a **major architectural refactor** that introduces a clean two-layer separation:  
`Normalization (hooks/) → Observability Surface (surface/) → Experience (experience/)`.

The **experience layer and build pipeline are production-ready** — clean composition, no race conditions, no XSS vectors, correct SSE patterns, and solid test coverage. The **hooks/normalization layer is architecturally correct in design** but carries three issues that should be resolved before merging: one undocumented contract field used in live logic, silent data loss in two adapters, and a compliance test that doesn't catch either of those.

**Verdict: REQUEST CHANGES** on the three issues below; rest of the PR is approved.

---

## 1. PR Overview

### What Changed

| Category | Files | Nature |
|---|---|---|
| `hooks/` (adapters, analyzers, registry, NR contract) | 26 added | New normalization layer (entire layer is new) |
| `surface/` (http-routes, sse-hub, active-state, etc.) | ~10 modified | Exposure layer decomposed + tested |
| `experience/client/` modules 13–19 | 7 added | Live SSE, pulse audio, beat overlay, DAW builder, trace panel |
| `experience/audio/` | 5 added | New sonic pipeline (beat-clock, audio-sim, presets, ticker-store) |
| `experience/pages/` | 3 added (now.html, daw-template.html, template.html) | Mission Control, DAW page, rewritten graph template |
| `experience/client-core.mjs`, `design-tokens.mjs` | 2 added | Shared browser helpers + Register A CSS tokens |
| `analyze.mjs` refactor + `analyze-pi.mjs` removal | 2 modified/removed | Root CLI thinned; logic moved to hooks/ |
| `build.mjs` expansion | 1 modified | Now builds 4 pages (graph, DAW, Mission Control, landing) |
| `ARCHIVE/` | 17 added | Old code preserved (context-tree, grok-context-tree, pulse-adapters) |
| `docs/` | 6 added | ADRs, sonic mapping, signal intelligence, harness guide |
| Root-level docs | 8 added | RFC files, TODO, AGENT-LOG, CONTEXT, FINDINGS |
| `.claude/commands/transcript.md` | 1 added | `/transcript` slash command |

### What Was Preserved / Deleted Clean

- Archival pattern (ARCHIVE/) preserves historical implementations without polluting working code — good discipline.
- `analyze-pi.mjs` moved to `hooks/analyzers/analyze-pi.mjs`, root file deleted correctly.
- Old `lib/pulse-adapters.mjs` archived, replaced by `hooks/pulse-transformer.mjs`.

---

## 2. Architecture Assessment

### Two-Layer Boundary: CLEAN ✓

The experience layer has zero imports from `hooks/` or adapters directly. It consumes only:
- `/events` SSE stream
- `/api/active`, `/api/trace/:session_id`, `/graph-data.json` HTTP endpoints

The boundary holds in every UI file reviewed. `experience/graph-pipeline.mjs` is a pure transform with no I/O.

### Registry as Single Source of Truth: MOSTLY CLEAN ⚠

`hooks/registry.mjs` correctly centralises adapter binding, scan logic, capability declarations, and session locators. The harness-addition checklist at the top is a useful guard.

**One crack:** the `overwrite` field on `session_meta` NRs is read by `session-reducer.mjs:118,154` but does not appear in the `KIND_FIELDS.session_meta.optional` map in `hooks/normalized-record.mjs:55–59`. The field works today because adapters emit it, but the contract test will not catch a regression. See Critical Finding #1.

### Composition in serve.mjs: CORRECT ✓

Watch event → `tailAndPulse()` (SSE pulse emitted immediately) → `scheduleRebuild()` (debounced rebuild). Pulse emission is non-blocking; sequential watch callbacks serialise state access. No race conditions detected.

### Build Pipeline: CORRECT ✓

`applySubstitutions()` is single-pass regex (no re-scan). The poison-data test in `build-template.test.mjs` explicitly validates that a `%%PLACEHOLDER%%` embedded inside injected JSON data does not trigger a second substitution. All four pages (`graph.html`, `daw-builder.html`, `now.html`, `home.html`) are built in the pipeline.

---

## 3. Findings

### 🔴 CRITICAL

---

#### C-1 · `overwrite` field not in NR contract but actively used in reducer logic

**Files:** `hooks/session-reducer.mjs:118,154` reads `rec.overwrite` · `hooks/normalized-record.mjs:55–59` does not declare it

**Issue:**  
`session-reducer.mjs` uses `rec.overwrite` (a boolean on `session_meta` records) to decide whether to clobber stale model values. All adapters that emit this pattern (pi, antigravity, grok, copilot) do set it, so it works today. But `validateNormalizedRecord()` and `nr-compliance.test.mjs` do not know the field exists — a future adapter that omits it will silently break model tracking with no test failure.

**Fix:**
```js
// hooks/normalized-record.mjs line 55–59 — add overwrite to session_meta.optional:
session_meta: { required: {}, optional: {
  ai_title: 'string', last_prompt: 'string', slug: 'string', duration_ms: 'number',
  message_count: 'number', version: 'string', entrypoint: 'string', cwd: 'string',
  branch: 'string', model: 'string', title: 'string', project_label: 'string',
  overwrite: 'boolean',   // ← add this line
} },
```

Then add a test in `test/adapters/nr-compliance.test.mjs` asserting that adapters which emit model overrides have `overwrite: true` on those records.

---

### 🟠 MAJOR

---

#### M-1 · Grok and opencode adapters silently drop successful tool execution records

**Files:** `hooks/adapters/grok.mjs:85–96` · `hooks/adapters/opencode.mjs:70–75`

**Issue:**  
Both adapters only emit a `tool_result` NR on failure. Claude-code, copilot, and antigravity emit on both success and failure. This means trace views and context-tree reconstruction will show tool calls that appear to never complete for grok and opencode sessions — half the picture missing, silently.

```js
// grok.mjs — current: only emits on error
if (msg.type === 'tool_call_update' && msg.error) { ... }

// Should also emit on completed status:
if (msg.type === 'tool_call_update' && (msg.error || msg.status === 'completed')) { ... }
```

Same pattern in `opencode.mjs`. Once fixed, add assertions to the golden session tests that tool_result appears for a completed tool in each harness.

---

#### M-2 · `pulse-transformer.mjs` overwrites semantic `category` with the sonic key

**File:** `hooks/pulse-transformer.mjs:47`

**Issue:**  
```js
// Current:
data: { ...base(ctx, ts), tool: nr.tool, key, where, why, category: key },
//                                                        ↑ overwrites nr.category
```

`nr.category` carries the raw bash sub-category (e.g. `'git'`, `'node'`, `'py'`). `key` is the derived sonic key (e.g. `'bash_git'`). The pulse's `data.category` is always identical to `data.key`, destroying the original subcategory signal. The DAW builder uses `data.category` for matching rules — if you add a rule that matches `'git'` (the semantic value), it will never fire because the emitted value is `'bash_git'`.

**Fix:**
```js
data: { ...base(ctx, ts), tool: nr.tool, key, where, why, category: nr.category ?? null },
```

---

#### M-3 · `nr-compliance.test.mjs` does not validate the gaps it claims to guard

**File:** `test/adapters/nr-compliance.test.mjs:28–35`

**Issue:**  
The comment on line 4 calls this file "the harness-format-change guard," but:
1. It does not assert that grok/opencode emit `tool_result` (they don't — M-1 above went undetected by this test).
2. It does not validate the `overwrite` field on `session_meta` (C-1 above).
3. It does not verify that `display_text` is only present in CC/grok adapters (not in pi/copilot/antigravity/opencode).

The test validates NR shape, but not behavioural completeness per adapter.

**Fix — add to the golden session sweep:**
```js
// For each harness's golden session, assert tool_result pattern:
const toolResults = nrs.filter(r => r.kind === 'tool_result');
assert.ok(toolResults.length > 0, `${harness}: expected tool_result records`);

// For CC and grok: assert display_text appears on at least one user_turn
// For others: assert display_text is absent
```

---

#### M-4 · `display_text` asymmetry undocumented — trace quality silently degraded for 4 harnesses

**Files:** `hooks/adapters/claude-code.mjs:116–117` · `hooks/adapters/grok.mjs:48` · pi, antigravity, opencode, copilot adapters (none emit it)

**Issue:**  
`display_text` on `user_turn` NRs carries per-turn human text for trace and thread views. Claude-code and grok populate it; the other four adapters do not. This is not documented in the NR contract comment or in the harness docs. Downstream trace consumers will show blank turn text for pi/opencode/copilot/antigravity sessions with no error.

**Fix (two options):**  
Option A: Populate `display_text` in all adapters that have per-turn human text (opencode and copilot do; pi and antigravity may not have it available).  
Option B: Add to `KIND_FIELDS.user_turn.optional` comment: `// display_text: CC and grok only — other harnesses omit`.

At minimum, document this clearly in `docs/harnesses.md` so future adapter authors know to populate it.

---

### 🟡 MINOR

---

#### Mi-1 · Path-segment parsing duplicated across 7 `ctxFromPath` implementations

**File:** `hooks/registry.mjs:82–284`

**Issue:** The pattern `.replace(/\\/g, '/').split('/')` appears inline in every adapter's `ctxFromPath` function. If the path contract changes for even one harness, all need updating.

**Fix:** Extract into `hooks/path-parsers.mjs`:
```js
export function normalisePath(p) { return p.replace(/\\/g, '/'); }
export function splitRelPath(p)  { return normalisePath(p).split('/'); }
```

---

#### Mi-2 · `session-reducer.mjs` first-user-message heuristic is coupled to adapter output shape

**File:** `hooks/session-reducer.mjs:132`

**Issue:** The reducer checks `rec.text?.length >= 8` to find the first user message. But pi already filters short texts in its adapter (adapter-level concern), and claude-code rejects specific boilerplate prefixes. This logic is split across layers inconsistently.

**Fix:** Adapters should signal intent via `is_first_candidate: true` on the user_turn NR, or null `text` on turns that aren't candidates. Let the reducer simply take the first non-null `text`.

---

#### Mi-3 · `session-reducer.mjs` subagent counting not harness-aware

**File:** `hooks/session-reducer.mjs:183`

**Issue:** Subagent count increments when `name === 'Agent' || name === 'Task'`. These are Claude Code tool names; no test validates this is correct (or intentionally skipped) for grok, opencode, copilot, or antigravity.

**Fix:** Document in code comment that `subagent_count` is CC-only; add a test asserting grok/opencode/copilot golden sessions have `subagent_count === 0`.

---

#### Mi-4 · `snapshotActive` does not shallow-copy `last_tool` object

**File:** `surface/active-state.mjs:189`

**Issue:** Other per-session fields in the snapshot are copied (`[...e.recent_actions]`), but `last_tool` is assigned by reference. A caller that mutates the returned snapshot's `last_tool` would corrupt internal state.

**Fix:**
```js
last_tool: e.last_tool ? { ...e.last_tool } : null,
```

---

#### Mi-5 · Watch-handlers test uses Windows path literal — fails on Linux (1 test failing)

**File:** `test/watch-handlers.test.mjs:13`

**Issue:** The assertion hardcodes `'C:\\fake\\root\\...'`. On Linux, `path.join()` returns `'C:/fake/root/...'`. This is the one currently-failing test.

**Fix:**
```js
assert.equal(r.absPath, path.join('C:\\fake\\root', 'D--src-foo', 'abc-def-123.jsonl'));
// path.join() normalises slashes per platform
```

---

#### Mi-6 · Grok adapter `currentTurnKey` statefulness not tested under disordered records

**File:** `hooks/adapters/grok.mjs:28–33`

**Issue:** Turn grouping uses `turnStartMs` as a stateful key. If records are ever replayed out of order (e.g. log rotation / retry), assistant_turn could be mis-grouped. No test covers this.

**Fix:** Add a test in `test/adapters/nr-compliance.test.mjs` or a new grok-specific test that verifies assistant_turn is emitted once per unique `turnStartMs` value even when records arrive in non-chronological order.

---

#### Mi-7 · `tokens` NR validation errors are unattributed

**File:** `hooks/normalized-record.mjs:95–108`

**Issue:** When a tokens object is malformed, error messages say "tokens field missing" but not which counter (input/output/cache_create/cache_read) is missing.

**Fix:**
```js
// Instead of generic typeError():
errors.push(`tokens.${k}: expected number, got ${typeof val[k]}`);
```

---

### 🔵 NITPICK

---

#### N-1 · `readJsonlRecords` default read mode implicit — no JSDoc on the override contract

**File:** `hooks/registry.mjs:39–43`

Adapters like opencode override the default JSONL reader entirely (reads from a JSON directory tree instead). The override pattern is powerful but invisible without a comment explaining the dispatch.

**Suggestion:** Add a one-line JSDoc: `// grok/opencode/copilot supply custom readSessionRecords; default reads JSONL`.

---

#### N-2 · `by_harness` rollup mutates output object — "pure module" comment slightly misleading

**File:** `surface/active-state.mjs:207`

The comment says "Pure module: no I/O, no Date.now()" — true, but `by_harness[e.harness] ??= { ... }` mutates the fresh output object. The function is pure in the meaningful sense (no external state), but the wording could confuse a future maintainer into thinking the output is also immutable.

**Suggestion:** Clarify: "Pure transformation: no I/O, no Date.now(). Caller may mutate the returned snapshot."

---

#### N-3 · Root-level docs proliferation

**Files:** `AGENT-LOG.md`, `CONTEXT.md`, `RFC-*.md`, `*-FINDINGS.md`, `TODO.md` (8 new root-level markdown files)

These are valuable working documents but they belong in `docs/` rather than the repo root. The `docs/` directory was created in this same PR. Moving them there would keep the root clean.

---

## 4. Test Coverage Assessment

| Area | Status | Notes |
|---|---|---|
| `hooks/normalized-record.mjs` | ✅ Tested | validateNormalizedRecord covered; overwrite gap (C-1) not caught |
| `hooks/adapters/*` | ✅ Tested | `nr-compliance.test.mjs` covers shape; behavioural gaps per M-3 |
| `hooks/session-reducer.mjs` | ✅ Tested | Core paths covered; subagent CC-only assumption not asserted |
| `hooks/pulse-transformer.mjs` | ✅ Tested | `pulse-transformer.test.mjs` covers key derivation; category overwrite (M-2) not caught |
| `hooks/trace-tree.mjs` | ✅ Tested | Parity + all-harness sanity |
| `surface/active-state.mjs` | ✅ Tested | Burn rate, burn window, eviction, rollups |
| `surface/sse-hub.mjs` + `http-routes.mjs` | ✅ Tested | Ephemeral port tests |
| `experience/graph-pipeline.mjs` | ✅ Tested | All new fields (`context_resets`, `ai_title`, `subagent_count`, `branches`, `tools_top`) asserted |
| `experience/client-core.mjs` | ✅ Tested | formatters, geometry, SSE wiring |
| `experience/audio/*` | ✅ Tested | beat-clock, ticker-store, audio-sim, presets, resolveSonic |
| `experience/client/14-pulse-audio.js` | ❌ Browser only | Beat ring, BPM scheduler — not unit-testable without DOM |
| `experience/client/19-daw-builder.js` | ❌ Browser only | 1228 lines untested |
| `test/watch-handlers.test.mjs:13` | ❌ 1 failing | Platform path literal (Mi-5) |

**Coverage gap not yet in CLAUDE.md known gaps:** grok/opencode tool_result omission (M-1) is not flagged in the known gaps section.

---

## 5. Maintainability & Extensibility

**Adding a new harness** (the core extensibility use case):

The registry checklist is excellent: one adapter, one analyzer, one registry descriptor, one compliance test entry. The `scan-walk.mjs` skeleton + `jsonl-io.mjs` reduce boilerplate. The NR contract is legible. Rating: **9/10**.

The one friction point: a new harness author reading the NR contract will not know about the `overwrite` field (C-1), the expectation around `display_text` quality (M-4), or the tool_result success/failure convention (M-1). These gaps are implicit knowledge.

**Code smells:**

- C-1 is a contract–implementation divergence (the worst kind of smell in an otherwise clean contract-first architecture).
- Mi-1 (path parsing duplication) is classic DRY violation but low blast radius.
- M-2 (semantic field overwrite) is a subtler API design smell — `category: key` looks right on first read but destroys information.

**Positive patterns:**

- `applySubstitutions()` single-pass design is clever and well-tested — prevents a class of injection bugs.
- `beat ring` mutability contract is documented in CLAUDE.md and enforced by design (no reassignment in 14-pulse-audio.js). Good.
- Archive pattern (ARCHIVE/) preserves history without polluting working code.
- ADR-001 documents the pulse-layer decision. The docs/ structure is a good long-term habit.
- Zero external runtime dependencies maintained.

---

## 6. Security

No security concerns found. Specifically reviewed:
- `19-daw-builder.js`: All user-supplied values go through `esc()` before HTML injection; chip inputs use enumerated hardcoded values, not free text.
- `now.html`: `actLine()` and card rendering use `esc()` for all harness/slug/project/branch values from SSE.
- `applySubstitutions()`: Single-pass prevents XSS via placeholder-in-data poisoning.
- No `eval()`, no `innerHTML` with untrusted strings, no SQL, no shell injection surfaces.

---

## 7. Required Changes Before Merge

| # | File(s) | Change |
|---|---|---|
| **C-1** | `hooks/normalized-record.mjs:59` + `test/adapters/nr-compliance.test.mjs` | Add `overwrite: 'boolean'` to `session_meta.optional`; add compliance assertion |
| **M-1** | `hooks/adapters/grok.mjs:85–96` + `hooks/adapters/opencode.mjs:70–75` | Emit `tool_result` on success status, not only on error |
| **M-2** | `hooks/pulse-transformer.mjs:47` | Change `category: key` → `category: nr.category ?? null` |
| **M-3** | `test/adapters/nr-compliance.test.mjs` | Add tool_result presence assertions per harness |
| **Mi-5** | `test/watch-handlers.test.mjs:13` | Fix platform-specific path literal (currently failing on Linux) |

---

## 8. Suggested (Non-Blocking) Improvements

- **M-4**: Document `display_text` as CC/grok-only in `KIND_FIELDS` comment and `docs/harnesses.md`.
- **Mi-1**: Extract path-segment parsing to `hooks/path-parsers.mjs`.
- **Mi-2**: Move first-user-message candidacy decision into adapters.
- **Mi-3**: Assert subagent_count is 0 for non-CC harnesses.
- **Mi-4**: Shallow-copy `last_tool` in `snapshotActive()`.
- **Mi-6**: Add grok disordered-record test.
- **N-3**: Move root-level working docs (`AGENT-LOG.md`, `CONTEXT.md`, RFC files, FINDINGS files) to `docs/`.

---

*This document should be updated as findings are resolved. Mark each row with ✅ when the fix is committed.*
