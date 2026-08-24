---
published: false
title: "OOM-proof transcript I/O — what the 512MB cap does not cover"
tags: [kaaro-sessions, pipeline, jsonl, oom, tail]
description: "The 512MB parseJsonlFile cap stops analyze from fatal-OOM on a runaway Grok updates.jsonl. It is not OOM-proof. Remaining unbounded readers, the live-tail hole, and the layers it would take to actually bound heap."
date: 2026-08-24
layer: L3-Principle
maturity: BUDDING
para: Pipeline
---

# OOM-proof transcript I/O

**Status:** L1 + L2 shipped (L2 scope narrower than originally proposed — see below) — not an RFC
**Incident:** a Grok `updates.jsonl` grew to 3.15GB; `readFileSync(..., 'utf8')` aborted analyze with a V8 heap OOM
**Shipped L1:** `fix(hooks): cap JSONL reads at 512MB` (`2fd6847`) — `statSync` then throw, before allocate
**Shipped L2:** `hooks/fix: cap live tail + copilot + opencode reads at MAX_JSONL_BYTES` — same stat-then-refuse pattern applied to `tailRead`, `readCopilotSession`, and `jsonAndPulse` (opencode's whole-file watch, found during L2 review — not in the original table's "remaining fatal path" narrative, but the same class of bug: unbounded read triggered by a live `fs.watch` event)

This is a hardening note, not a product RFC. RFCs in this repo propose new contracts (OTLP surface, context tree, subagent child nodes). The snapshot/stream I/O contract does not change. What changes is: no transcript reader may allocate unbounded bytes from disk.

Promote to an RFC only if we decide to **include** huge sessions (streaming `NormalizedRecord[]` → `reduceSession`) instead of **skipping** them.

---

## Why `try/catch` cannot save you

`walkSessions` already isolates per-session JS errors. V8 heap exhaustion is not a JS error:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

The process aborts. The guard has to run **before** any heap-sized allocation. That is why the cap is `statSync` then refuse, not `readFileSync` in a `try`.

`parseJsonlFile` now throws a normal `Error` when `size > 512MB`. `walkSessions` logs:

```
!! [grok] <cwd>/<uuid>: JSONL file too large to parse (3150.0MB > 512.0MB cap): …
```

The oversized session is absent from the graph. Every other session still builds.

512MB is a **policy** number (well above a legitimate session, well below the abort). It is not a memory-safe parse size: a file just under the cap still becomes string + `split('\n')` + `JSON.parse` objects.

---

## What is actually guarded today

| Reader | Path | Capped? |
|---|---|---|
| `hooks/jsonl-io.mjs` `parseJsonlFile` | CC / Pi / Command Code / Antigravity / Grok analyze; `/api/trace` via `readJsonlRecords` | Yes |
| `hooks/jsonl-tail.mjs` `tailRead` | live pulse (`tailAndPulse`) | **Yes** — delta over cap: no alloc, offset jumps to EOF, emitter logs `skippedBytes` |
| `hooks/analyzers/analyze-copilot.mjs` `readCopilotSession` | Copilot scan + trace | **Yes** — `stat` then throw, same shape as `parseJsonlFile` |
| `surface/pulse-emitter.mjs` `jsonAndPulse` | opencode live watch (whole-file JSON) | **Yes** — `stat` then skip-and-log before `readFileSync` |
| `hooks/analyzers/analyze-opencode.mjs` `readJson` | opencode scan/analyze (not the live-watch path above) | **No** (small files in practice — one message/part per file) |
| `scripts/sim-audio.mjs`, `scripts/dump-pulses.mjs` | one-shot CLI, human-run | **No** — deliberately deprioritized: a human sees it hang/crash and kills it; not a long-lived server process silently going down |

---

## The fatal path that was open: live tail from offset 0 — now closed

`createPulseEmitter` bookmarks per-file offsets, but a first watch event started at 0:

```
const offset = offsetMap.get(filePath) ?? 0;
tailRead(filePath, offset);   // Buffer.allocUnsafe(size - offset)
```

`tailRead` then `toString('utf8')`s that span. If the runaway Grok session was **still being written**, `fs.watch` would fire, offset would be 0, and the process could still fatal-OOM. The `try/catch` around `tailAndPulse` could not catch that either.

Dormant 3GB file: analyze skips it, watch never fires, server lives.
Live 3GB file (before L2): analyze was safe; the next append could still kill `serve.mjs`.

This was the same class of bug as the incident, on the Stream clock instead of the Snapshot clock. `tailRead` now takes the same `maxBytes` cap `parseJsonlFile` does (`{ maxBytes = MAX_JSONL_BYTES }` opt, shared constant) — an over-cap delta returns `{ records: [], newOffset: size, skippedBytes }` instead of allocating, `tailAndPulse` logs the skip, and the offset jumps straight to EOF so the same oversized delta is never retried. `jsonAndPulse` (opencode's whole-file watch) got the equivalent `stat`-then-skip guard, found during L2 review — it wasn't in the original table but is the identical bug shape.

**What L2 deliberately did *not* do:** the original plan's item 3 ("`tailAndPulse` first sight: `offsetMap.set(filePath, currentSize)`, so we never replay history as pulses") was reconsidered, not shipped. `pulse-emitter.test.mjs` encodes the current, intended contract: the *first* `tailAndPulse` call on a freshly-created session file is expected to read its existing content from offset 0 and emit pulses for it — that's how a brand-new session's opening moves become live pulses at all. Unconditionally jumping first-sight to EOF would silently drop that opening content for every new session, not just skip stale gigabyte backlogs. And it isn't needed for OOM-safety: the `maxBytes` cap on the delta *alone* already refuses the pathological case (a multi-GB file's first-sight delta is `size - 0`, which trips the same cap as any other oversized delta). What's left on the table is a narrower, lower-priority UX concern — replaying a *moderately* large but under-cap history (tens of MB) as a burst of fake-"live" pulses after a restart mid-session — which needs a real signal to distinguish "stale backlog" from "new file's first content," not a blanket rule. Left open, not attempted here.

---

## Layers of "proof"

**L1 — refuse to start a read larger than N.** Shipped for `parseJsonlFile`. Skip the session; do not parse it.

**L2 — every reader shares L1.** Same cap (or a smaller `MAX_READ_BYTES`) in `tailRead`, Copilot, opencode JSON, and the one-shot scripts. On first sight of a tailed file: bookmark current `size` (true tail, don't replay history) **and** refuse to `alloc` a delta larger than the cap (jump offset to EOF, log, continue). This closes the live hole without changing the NR contract. **This is the next patch.**

**L3 — stream lines, don't `readFileSync` + `split`.** Chunked read, split on `\n`, `JSON.parse` one line. Bounds: max line length. A 400MB-under-cap file can still blow heap today via the full-string + line-array copies. L3 removes those copies on the I/O side.

**L4 — stream into the reducer.** Even a line stream materializes `records[]` then `NormalizedRecord[]`. `reduceSession(nrs, …)` takes the whole array. To *include* a multi-GB session you would fold records one at a time and never hold the transcript. That **is** an RFC: it changes the analyzer/reducer contract.

**L5 — bound the artifacts.** `sessions-data.json` / inlined `graph.html` can themselves be huge. Out of scope until L2/L3 exist.

OOM-proof as in "a transcript cannot abort the process" is **L2 + L3**. L4 is a different product question (skip vs ingest).

---

## L2 patch — what actually shipped

1. ✅ `MAX_JSONL_BYTES` (in `hooks/jsonl-io.mjs`) is the one shared cap — imported by `tailRead`, `readCopilotSession`, and `jsonAndPulse`. Not renamed (the "JSONL" name is a slight misnomer for the JSON-whole-file case, but renaming touches every existing call site for no functional gain — left as is).
2. ✅ `tailRead(filePath, byteOffset, { maxBytes })`: `fstat` first (already open for the read, so this is free); if `size - byteOffset > maxBytes`, no `alloc` — returns `{ records: [], newOffset: size, skippedBytes }`. `tailAndPulse` logs the skip via `console.warn`.
3. ⛔ **Not shipped as originally proposed** — see "What L2 deliberately did not do" above. The cap in (2) already closes the OOM hole for the pathological case; blanket first-sight-jumps-to-EOF would have broken legitimate new-session tailing.
4. ✅ `readCopilotSession(filePath, { maxBytes })`: same `stat`-then-throw shape as `parseJsonlFile`, still sits under `walkSessions`' per-session catch (scan path) and `trace-service.mjs`'s catch → `null` (trace path).
4b. ✅ (found during review, not in the original list) `jsonAndPulse(filePath, ctx)`: `stat` before `readFileSync`, skip-and-log over cap. Threaded through `createPulseEmitter({ ..., maxBytes })`.
5. ✅ Tests use the `maxBytes` opt seam throughout (`jsonl-tail.test.mjs`, `analyze-copilot.test.mjs`, `pulse-emitter.test.mjs`) — no gigabyte fixtures. Covers: delta-over-cap refuses + advances offset past it (no retry loop); delta-under-cap unaffected; Copilot file-over-cap throws; opencode whole-file-over-cap skips without throwing.

"OOM-proof" still isn't the right claim for this commit — L3 (stream instead of `readFileSync` + `split`) isn't done, so a file just under 512MB can still blow heap via the full-string + line-array copies. What shipped: **the specific incident class (multi-GB file, live or dormant) can no longer abort the process**, on both the Snapshot (L1) and Stream (L2) clocks.

---

## Links

- `hooks/jsonl-io.mjs` — L1 cap
- `hooks/jsonl-tail.mjs` — unbounded delta alloc
- `surface/pulse-emitter.mjs` — offset 0 on first watch
- `hooks/scan-walk.mjs` — catchable-error isolation only
- [[sse-jsonl-live-reload]] — the two-clock pattern this hole lives in
- [[harness-architecture]] — snapshot vs stream boundary
