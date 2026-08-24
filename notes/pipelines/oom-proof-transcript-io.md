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

**Status:** open follow-up — not an RFC
**Incident:** a Grok `updates.jsonl` grew to 3.15GB; `readFileSync(..., 'utf8')` aborted analyze with a V8 heap OOM
**Shipped:** `fix(hooks): cap JSONL reads at 512MB` (`2fd6847`) — `statSync` then throw, before allocate

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
| `hooks/jsonl-tail.mjs` `tailRead` | live pulse (`tailAndPulse`) | **No** |
| `hooks/analyzers/analyze-copilot.mjs` `readCopilotSession` | Copilot scan + trace | **No** |
| `hooks/analyzers/analyze-opencode.mjs` | whole-file JSON trees | **No** (small files in practice) |
| `scripts/sim-audio.mjs`, `scripts/dump-pulses.mjs` | one-shot CLI | **No** |

---

## The remaining fatal path: live tail from offset 0

`createPulseEmitter` bookmarks per-file offsets, but a first watch event starts at 0:

```
const offset = offsetMap.get(filePath) ?? 0;
tailRead(filePath, offset);   // Buffer.allocUnsafe(size - offset)
```

`tailRead` then `toString('utf8')`s that span. If the runaway Grok session is **still being written**, `fs.watch` fires, offset is 0, and the process can still fatal-OOM. The `try/catch` around `tailAndPulse` cannot catch that either.

Dormant 3GB file: analyze skips it, watch never fires, server lives.
Live 3GB file: analyze is now safe; the next append can still kill `serve.mjs`.

This is the same class of bug as the incident, on the Stream clock instead of the Snapshot clock.

---

## Layers of "proof"

**L1 — refuse to start a read larger than N.** Shipped for `parseJsonlFile`. Skip the session; do not parse it.

**L2 — every reader shares L1.** Same cap (or a smaller `MAX_READ_BYTES`) in `tailRead`, Copilot, opencode JSON, and the one-shot scripts. On first sight of a tailed file: bookmark current `size` (true tail, don't replay history) **and** refuse to `alloc` a delta larger than the cap (jump offset to EOF, log, continue). This closes the live hole without changing the NR contract. **This is the next patch.**

**L3 — stream lines, don't `readFileSync` + `split`.** Chunked read, split on `\n`, `JSON.parse` one line. Bounds: max line length. A 400MB-under-cap file can still blow heap today via the full-string + line-array copies. L3 removes those copies on the I/O side.

**L4 — stream into the reducer.** Even a line stream materializes `records[]` then `NormalizedRecord[]`. `reduceSession(nrs, …)` takes the whole array. To *include* a multi-GB session you would fold records one at a time and never hold the transcript. That **is** an RFC: it changes the analyzer/reducer contract.

**L5 — bound the artifacts.** `sessions-data.json` / inlined `graph.html` can themselves be huge. Out of scope until L2/L3 exist.

OOM-proof as in "a transcript cannot abort the process" is **L2 + L3**. L4 is a different product question (skip vs ingest).

---

## Proposed L2 patch (when we pick this up)

1. Export `MAX_JSONL_BYTES` as the single cap (or rename to `MAX_READ_BYTES` and use it everywhere).
2. `tailRead`: `stat`/`fstat` first; if `size - byteOffset > cap`, do not `alloc` — return `{ records: [], newOffset: size }` plus a thrown or returned error the emitter logs.
3. `tailAndPulse` first sight: `offsetMap.set(filePath, currentSize)` so we never replay a 3GB history as pulses. (Today the first change after serve starts dumps the whole file into SSE.)
4. `readCopilotSession`: same `stat` then throw as `parseJsonlFile` — Copilot scan already sits under `walkSessions`.
5. Tests: `tailRead` refuses a delta over `maxBytes`; first-seen `tailAndPulse` does not emit historical records. Use the existing `maxBytes` test seam, never a 512MB fixture.

Do not claim "OOM-proof" in commit messages until L2 is in. L1 is "analyze no longer dies on that Grok file."

---

## Links

- `hooks/jsonl-io.mjs` — L1 cap
- `hooks/jsonl-tail.mjs` — unbounded delta alloc
- `surface/pulse-emitter.mjs` — offset 0 on first watch
- `hooks/scan-walk.mjs` — catchable-error isolation only
- [[sse-jsonl-live-reload]] — the two-clock pattern this hole lives in
- [[harness-architecture]] — snapshot vs stream boundary
