# TODO — kaaroSessions

Backlog surfaced by flow-state audit on 2026-06-07 (branch: subagent-improvement).
**Current state (2026-06, feat/multi-harness-tdd):** **1076 tests pass, 0 fail.**

**Major milestone:** Full multi-harness adapter pipeline landed (claude-code, pi, antigravity, grok) with normalized records, `lib/scan-harnesses.mjs`, harness registry, live watch + targeted rebuilds, error isolation, resolver cache, and review findings from CODE-REVIEW-FINDINGS.md addressed. See `docs/harnesses.md` for current support matrix.

---

## 🔴 Critical — will cause silent failures

### 1. `serve.mjs` has zero test coverage
HTTP routes, file-watcher debounce, `ctxFromCcPath`, `resolveSessionFile`,
`buildTrace` mtime cache, SSE lifecycle, incremental rebuild pipeline —
none of it is tested. The mtime-cache invalidation (trace freshness) has
no harness at all.

**Status / progress:** Partial mitigation. `resolveSessionFile` now has cache + invalidation (see #5). Incremental rebuild (`rebuildArg`) and scan isolation are implemented and exercised indirectly. Full unit tests for serve routes / watch / trace remain a gap. No extraction to `trace-resolver` yet.

### 2. `analyze-pi.mjs` parity is incomplete
Pi sessions silently produce nodes missing `context_resets`, `ai_title`,
`subagent_count`, `branches`. Thread view and trace panel degrade silently.
No cross-adapter test matrix validates both adapters produce the same schema shape.

**Status:** Still open for Pi (capabilities declare them false). CC and Grok now extract them fully via the shared normalized pipeline. Harness parity tests exist but are noted as consistency checks only (see updated comments in `test/harness-parity.test.mjs`). A full cross-adapter schema matrix would still be valuable.

---

## 🟡 Architecture — data-flow awkwardness

### 3. Token arithmetic computed in three places
`analyzeSession` → `enrichSession` → `buildGraph` each touch token fields.
`tokens_work` exists on session nodes but not project summary nodes
(`buildProjectSummary` emits `tokens_total` instead). Schema in
`sessions-schema.mjs` doesn't enforce these, so drift goes undetected.

**Fix:** Make `enrichSession()` the single place all derived fields are computed.
`buildGraph` passthrough only. Add `tokens_work` to project summaries.

### 4. `pulse-parser.mjs` CC/Pi divergence belongs in adapters
`CC_FILE_OPS` vs `PI_FILE_OPS`, `block.input` vs `block.arguments`,
`tool_use` vs `toolCall` — harness-adapter differences leaked into the parser.
Adding a third harness (opencode, Copilot) means a third branch in `parsePulse`.

**Status:** ✅ **Done.** `lib/pulse-adapters.mjs` implements per-harness adapters (parseCcPulse, parsePiPulse, etc.). `lib/pulse-parser.mjs` is now a thin re-export. FILE_OP detection unified to shared `FILE_OP_TOOLS` from the reducer (no more duplicate Sets). See Phase 4 work on feat/multi-harness-tdd.

---

## 🟡 Efficiency — hot paths

### 5. `resolveSessionFile` does unbounded sync I/O per request
`readdirSync` + `statSync` per project + `existsSync` per candidate, all
blocking the event loop, repeated on every `/api/trace/` request.

**Status:** ✅ **Done.** Simple `Map` cache + `invalidateSessionResolveCache()` added to `lib/session-resolver.mjs`. Invalidation wired from `serve.mjs` watch handler on any log change (clear-all for simplicity/correctness). Existing resolver tests pass; trace resolution is now fast after first hit.

### 6. `tailAndPulse` fires before rebuild debounce
SSE pulses emit immediately on `.jsonl` change; graph rebuild is debounced 1500ms.
On fast multi-turn sessions, clients receive bursts of pulse events for data the
graph hasn't processed yet. The two clocks are intentionally decoupled, but
there's no backpressure if writes come faster than SSE can absorb.

**Consider:** Buffer pulse events; flush after rebuild completes. Or document
the intentional decoupling clearly so it isn't "fixed" incorrectly.

---

## 🟢 DX / naming

### 7. `serve.mjs` child-process errors are silent
If `analyze.mjs` fails (permissions, corrupt JSONL), browser shows
"◌ building…" indefinitely. No SSE error event, no labeled stderr output.

**Fix:** Emit `event: error` on SSE when child process exits non-zero.
Add `--debug` flag that runs analyze/build inline (no `execFile`) so stderr
surfaces immediately in the terminal.

### 8. `BUILTIN_COMMANDS` vs `skills` split is undocumented
Two arrays on every session node; no comment in the schema explaining why
`/agent` goes into `skills[]` and `/config` into `builtin_commands[]`.
Invisible to new contributors.

**Fix:** Add a schema comment in `lib/sessions-schema.mjs` and `analyze.mjs`.

### 9. Browser module load-order coupling
`TOOL_COLORS`, `_fmtTok`, `_esc` are globals from `01-data.js`. Any new
module must know it loads after `01-data.js` — the dependency is implicit.

**Consider:** `window.UI = { fmtTok, esc, TOOL_COLORS }` makes the dependency
explicit and grep-able. Not urgent but will bite at module 20+.

### 10. Client module numbering vs concat order
Numeric prefix implies "this loads first" but `build.mjs` concatenates by
`Array.sort()`. They align today; a file named `09b-` would silently break
load order. Add a build-time assertion or a comment in `build.mjs`.

---

## 💬 Open UX questions (from open-feature-requests.md)

- Tool calls in the graph: make them more visually distinct — currently only visible in panel
- Path/node highlight logic: clicking a session highlights only immediate neighbours;
  is multi-hop expansion wanted?
- Branch edge logic: what exactly triggers a branch edge vs a membership edge?
  Document or surface this in the detail panel.

---

## 📋 Known coverage gaps (from CLAUDE.md)

- `serve.mjs` — HTTP routes, full watch/rebuild logic, `resolveSessionFile`, trace cache still have limited unit coverage (runtime behavior improved with cache + targeted rebuilds).
- `src/client/*.js` — browser JS; pure logic (`blockGeom`, `_toolBars`) testable but not yet extracted.
- `analyze-pi.mjs` / pi adapter — still missing full extraction of `context_resets`, `ai_title`, `subagent_count`, `branches` (declared as false in registry capabilities; CC + Grok are complete).
- `lib/graph-pipeline.mjs` — `tools_top`, context fields passthrough coverage improved but not exhaustive for all harnesses.
- New: `lib/pulse-adapters.mjs` and harness-specific pulse paths have good parser tests but limited end-to-end live pulse coverage in integration.

**Note:** Many original gaps were mitigated by the multi-harness refactor and review fixes (resolver cache, scan isolation, etc.). `node --test` now exercises far more of the pipeline.
