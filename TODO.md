# TODO — kaaroSessions

Backlog surfaced by flow-state audit on 2026-06-07 (branch: subagent-improvement).
Current state: **907 tests pass, 0 fail.**

---

## 🔴 Critical — will cause silent failures

### 1. `serve.mjs` has zero test coverage
HTTP routes, file-watcher debounce, `ctxFromCcPath`, `resolveSessionFile`,
`buildTrace` mtime cache, SSE lifecycle, incremental rebuild pipeline —
none of it is tested. The mtime-cache invalidation (trace freshness) has
no harness at all.

**Fix:** Extract into `lib/trace-resolver.mjs` (pure), unit-test path resolution,
mtime cache eviction, and subagent path handling.

### 2. `analyze-pi.mjs` parity is incomplete
Pi sessions silently produce nodes missing `context_resets`, `ai_title`,
`subagent_count`, `branches`. Thread view and trace panel degrade silently.
No cross-adapter test matrix validates both adapters produce the same schema shape.

**Fix:** Implement the four missing fields in `analyze-pi.mjs`; add schema parity
tests to `test/analyze-pi.test.mjs`.

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

**Fix:** `lib/pulse-adapters.mjs` with CC and Pi adapters each implementing a
single `parse(record)` interface. `parsePulse` becomes a 2-line dispatcher.

---

## 🟡 Efficiency — hot paths

### 5. `resolveSessionFile` does unbounded sync I/O per request
`readdirSync` + `statSync` per project + `existsSync` per candidate, all
blocking the event loop, repeated on every `/api/trace/` request.

**Fix:** Lazy `Map<sessionId, filePath>` built on first call; invalidated in
the `fs.watch` handler (already fires on every `.jsonl` change). Makes it O(1).

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

## 📋 Known coverage gaps (from CLAUDE.md)

- `serve.mjs` — HTTP routes, `ctxFromCcPath`, `resolveSessionFile`, trace cache
- `src/client/*.js` — browser JS; pure logic (`blockGeom`, `_toolBars`) testable but not yet extracted
- `analyze-pi.mjs` — missing `context_resets`, `ai_title`, `subagent_count`, `branches`
- `lib/graph-pipeline.mjs` — `tools_top`, `context_resets`, `ai_title`, `subagent_count`, `branches` passthrough not covered
