---
published: false
title: "SSE + JSONL Tail — Live Reload Without a Full Rebuild"
tags: [pattern, sse, live-reload, file-watching, jsonl, skill]
description: "Two-clock architecture for live data tools: pulse events emit immediately on file append via byte-offset tail reads; expensive rebuild is debounced separately. Gives sub-second feedback without blocking the pipeline."
date: 2026-06-07
layer: L3-Principle
maturity: BUDDING
para: SkillSurface
---

# SSE + JSONL Tail — Two-Clock Live Reload

## The Problem

A file-watching live-reload tool has two conflicting needs:
- **Immediacy**: show new data (a tool call, a token count) as it appears
- **Coherence**: don't push partial graph states to the browser mid-rebuild

Single-debounce designs sacrifice one for the other.

---

## The Pattern

Two independent clocks on the same `fs.watch` event:

```
fs.watch(file) fires
    │
    ├──→ tailAndPulse() — runs IMMEDIATELY
    │         tailRead(filePath, lastOffset)
    │           → new bytes only (byte-offset bookmark)
    │           → parse complete JSONL lines
    │           → parsePulse(record) → SSE event: tool_call / tokens / words
    │
    └──→ scheduleRebuild() — DEBOUNCED 1500ms
              execFile(analyze.mjs)
              execFile(build.mjs)
              SSE event: updated → browser fetches /graph-data.json
```

The browser consumes both streams:
- Pulse events: feed the ticker, trigger audio, show highlights — no graph mutation
- `updated` event: trigger `window.updateGraph(newData)` — atomic graph swap

---

## `tailRead` — the incremental reader

```javascript
// lib/jsonl-tail.mjs
export function tailRead(filePath, byteOffset = 0) {
  const fd = fs.openSync(filePath, 'r');
  const size = fs.fstatSync(fd).size;
  if (size <= byteOffset) return { records: [], newOffset: byteOffset };
  const buf = Buffer.allocUnsafe(size - byteOffset);
  fs.readSync(fd, buf, 0, size - byteOffset, byteOffset);
  fs.closeSync(fd);

  // Only process complete lines (trailing \n)
  const lastNL = buf.lastIndexOf(0x0a);
  if (lastNL === -1) return { records: [], newOffset: byteOffset };

  const records = buf.slice(0, lastNL + 1)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });

  return { records, newOffset: byteOffset + lastNL + 1 };
}
```

Key: **never advance the offset past the last complete newline**. Incomplete
lines (file written mid-line) are left for the next call.

---

## Byte-offset bookmarking

```javascript
const offsetMap = new Map(); // filePath → lastReadOffset

function tailAndPulse(filePath, ctx) {
  const offset = offsetMap.get(filePath) ?? 0;
  const { records, newOffset } = tailRead(filePath, offset);
  offsetMap.set(filePath, newOffset);
  for (const rec of records)
    for (const pulse of parsePulse(rec, ctx))
      notify(pulse.event, JSON.stringify(pulse.data));
}
```

The `offsetMap` resets to 0 if the file is replaced (new session), which is the
correct behaviour — a new session file should be read from the start.

---

## Invariants

- **Pulse events must not mutate graph state** — they're live telemetry, not authoritative data
- **`updated` event must be atomic** — client fetches a complete snapshot from `/graph-data.json`
- **SSE client-side error recovery** — `es.onerror` resets badge, `es.onopen` restores it

---

## Generalises to

Any tool that needs both:
- Real-time observability (streaming telemetry as things happen)
- Periodic coherent snapshots (expensive aggregation, debounced)

E.g.: log tail + periodic aggregate; database CDC + periodic rollup report.

---

## Links

- [[kaaro-sessions-area]] — where this pattern is implemented
- [[pending-asst-pattern]] — sibling pattern in the same JSONL reconstruction system
