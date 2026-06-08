# Code Review Findings — feat/multi-harness-tdd

**Reviewed:** 2026-06-07  
**Branch:** `feat/multi-harness-tdd` (5 commits ahead of master)  
**Scope:** 43 files, ~4 200 insertions — Agent Harness Modularity  
**Method:** 7-angle parallel review (correctness, removed-behavior, cross-file, reuse, simplification, efficiency, altitude) × 1-vote verify

---

## 🔴 High — correctness, affects all sessions

### 1. `assistant_turns` = 1+N per CC turn
**File:** `adapters/claude-code.mjs:119`

For each `assistant` JSONL record with N content blocks the adapter emits **1 turn-header record** (line 99) **+ N per-block records** (line 119 loop). `session-reducer.mjs:142` increments `assistant_turns++` for every `assistant_turn` record, so the count is `1+N` instead of `1`.

The deleted code in the old `analyze.mjs` had a single `session.assistant_turns++` per assistant JSONL record.

**Fix:** Push the per-block records with a different kind (e.g. `content_block`) and only increment `assistant_turns` once for the turn-header record.

---

### 2. Grok adapter double-emits `assistant_turn` for text chunks
**File:** `adapters/grok.mjs:48`

Lines 41–46 emit one `assistant_turn` (content_block: su). Lines 48–52 then unconditionally emit a second `assistant_turn` (content_block: 'text') for every `agent_message_chunk` that has `content.text`. Both records hit `assistant_turns++` in the reducer.

A Grok session streaming 20 message chunks accumulates 40 `assistant_turns` instead of 20.

**Fix:** Track `content_block: 'text'` with a separate kind, or merge both signals into one `assistant_turn` record.

---

### 3. `message_count` overwritten by inflated `assistant_turns`
**File:** `lib/session-reducer.mjs:190`

CC's `turn_duration` JSONL record provides the authoritative `messageCount`. Line 102 correctly sets `session.message_count` from it. At end-of-loop, line 190 overwrites with `user_turns + assistant_turns`. Due to bug #1, this is e.g. `1 + 4 = 5` for a single-turn session instead of the correct `2`.

The correct metadata value is silently discarded every time.

---

## 🟡 Medium — correctness / quality gates

### 4. Grok `seenTurns` dedup bypassed when `_meta.turnStartMs` absent
**File:** `adapters/grok.mjs:45`

When `rec._meta?.turnStartMs` is null/undefined the `else if (turn == null)` branch (line 45) emits unconditionally — no dedup at all. Combined with bug #2, each such chunk produces 2 `assistant_turn` records with no upper bound. A 50-chunk Grok response with missing `_meta` could produce 100+ `assistant_turn` records.

---

### 5. Harness parity test is circular — cannot catch CC pipeline bugs
**File:** `test/harness-parity.test.mjs:79`

The "legacy" path calls `analyzeSession()` (line 79). But `analyzeSession` was refactored to internally call `reduceSession(recordsToNormalized(records), ...)` — the same functions the "pipeline" path (lines 80–86) calls directly. The `assertParity` comparison proves internal consistency, not correctness. Bug #1 passes this test: both paths produce `assistant_turns = 4`, yet the true answer is `1`.

**Fix:** Snapshot the legacy output as a hardcoded fixture (before this PR) and compare the pipeline against that.

---

### 6. `rebuildArg` never used — full `--all-harnesses` scan on every file change
**File:** `serve.mjs:90` / `lib/watch-handlers.mjs:26`

`processWatchFilename` returns `{ ctx, absPath, rebuildArg, relPath }` where `rebuildArg` is e.g. `'--session=D--src-foo/abc123.jsonl'`. `handleWatchEvent` ignores it and calls `scheduleRebuild()` which always runs `run(ANALYZE_SCRIPT, ['--all-harnesses'])`. The incremental rebuild path (`parseSessionFlag`, `mergeSessionIntoData`) is dead for all harnesses. A single keystroke in an active session triggers a full multi-harness scan.

---

### 7. Sync I/O per `/api/trace/` request blocks event loop
**File:** `lib/session-resolver.mjs:27`

All four resolver functions use `readdirSync + statSync + existsSync` in the HTTP request path. On a machine with 200+ CC sessions, each trace click can stall the event loop for 50–200 ms, queuing all concurrent requests. No caching was added in this PR (the lazy-Map fix noted in TODO.md #5 was not implemented).

---

### 8. Scanner error in any harness aborts entire rebuild
**File:** `lib/scan-harnesses.mjs:29`

`scanHarnesses` has no outer try/catch. A non-ENOENT filesystem error in `scanGrokSessions` (e.g. EPERM mid-write on Windows) propagates to `analyze.mjs main()`, which exits with code 1. The `rebuild()` in `serve.mjs` emits an SSE error and subsequent graph updates stop — even though CC and Pi sessions are unaffected.

**Fix:** Wrap each `scanner()` call in a try/catch; warn and continue on per-harness failure.

---

## 🟢 Low — cleanup / inconsistency

### 9. `CC_FILE_OPS` and `PI_FILE_OPS` are duplicate Sets with different casing
**File:** `lib/pulse-adapters.mjs:14–15`

`CC_FILE_OPS = Set(['Read', 'Write', 'Edit'])` and `PI_FILE_OPS = Set(['read', 'write', 'edit'])` are semantically identical. `FILE_OP_TOOLS` in `session-reducer.mjs` already normalises all harnesses' op names. A new harness must add a third Set and a third `if` clause. Drift has already begun (CC capitalized, Pi lowercase).

---

### 10. Pi adapter emits zero-value `tokens` record unconditionally
**File:** `adapters/pi.mjs:56`

When `msg.usage` is absent, `const u = msg.usage || {}` yields `{}` and a token record with all fields `0` is emitted. The CC adapter guards with `if (msg.usage !== undefined)` (adapters/claude-code.mjs:103). Token totals are unaffected (adding 0) but the inconsistency could mislead future harness authors using Pi as a reference implementation.

---

## Test coverage at time of review

| Suite | Pass | Fail |
|---|---|---|
| All tests (`node --test`) | **907** | **0** |

All tests pass, but bugs #1–#3 are invisible to the suite because the parity test is circular (finding #5) and no test feeds raw CC records through the adapter and asserts `assistant_turns === 1`.
