---
published: false
title: "Session Intelligence Sprint — June 2026"
tags: [kaaro-sessions, pipeline, session-intelligence, context-tree]
description: "Sprint that added subagent metadata, live pulse SSE, the context tree reconstruction, and the thread view. The first time kaaroSessions could answer 'how did this session unfold' not just 'what files were touched'."
date: 2026-06-07
layer: L1-Instance
maturity: BUDDING
para: Pipeline
---

# Session Intelligence Sprint — June 2026

**Branch:** `subagent-improvement`
**Tests at close:** 907 pass, 0 fail
**Status:** Closed → crystallized

---

## Goal

Move kaaroSessions from answering *what* (files, tokens, tools across sessions) to answering *how* (the arc of a single session — context resets, subagents, exact tool calls, conversation flow).

---

## What was built

### Metadata extraction (`analyze.mjs`)
- `context_resets` — count of `compact_boundary` records per session
- `ai_title` — extracted from `<ai-title>` JSONL records
- `subagent_count` — Agent tool_use count
- `branches[]` — all git branches seen in a session (not just the last)
- normPath Windows drive-letter lowercasing — fixes cross-project file node deduplication

### Live pulse layer (`serve.mjs` + `lib/pulse-parser.mjs` + `lib/jsonl-tail.mjs`)
- SSE events: `tool_call`, `tokens`, `words` emitted as JSONL lines are appended
- `tailRead(filePath, byteOffset)` — incremental read, only new bytes
- Two clocks deliberately: pulse is immediate, graph rebuild is debounced 1500ms

### DAW Feed Widget (`src/client/14-pulse-audio.js`, `16-beat-overlay.js`)
- Beat ring buffer — mutable in-place (critical: never reassign `window._beatRing`)
- BPM scheduler with 80ms coalescing
- Tool family → instrument mapping
- 80px canvas overlay, LIVE/SCROLL mode, hover → graph accent ring

### Context tree Phase 1 (`lib/context-tree.mjs`)
- `reconstructContextTree(records)` — pure, no I/O
- Segments between compact boundaries: tool_summary, token counts, branches, permission_modes

### Context tree Phase 2 — turn-level
- `turns[]` per segment: role, text (500-char cap), tool_calls with sanitised inputs
- **[[pending-asst-pattern]]** — key insight: hold assistant turn open until next user record to pair tool_results back by `tool_use_id`
- `_sanitizeInput` strips blobs (Write content), truncates Edit diffs to 160 chars, keeps Bash commands in full

### Trace panel + Thread view (`17-trace-panel.js`, `18-thread-view.js`)
- Proportional context strips — width = token weight, color = dominant tool, lazy-fetches `/api/trace/`
- Thread view full-screen overlay — every USER/ASST turn, tool calls with args, Edit diffs, error indicators
- Shared `window._traceCache` — panel and thread view share one fetch

### `/simplify` pass
- Hoisted `TOOL_COLORS`, `_fmtTok`, `_esc` to `01-data.js` — eliminated 3 local copies that had silently diverged
- Simplified `context-tree.mjs` user-turn guard (removed dead negation)
- `buildTrace` → `tailRead(filePath, 0)` (removed duplicate parse loop)

---

## Key decisions

| Decision | Alternatives considered | Why this path |
|---|---|---|
| pendingAsst flush pattern | Emit turns eagerly; post-process to add errors | Flush-on-next-turn keeps reconstruction pure and stateless per record |
| Two-clock SSE design (pulse vs graph) | Single debounced pipeline | Pulse gives sub-second feedback; graph rebuild is expensive |
| `window._traceCache` global | Module-private caches | Thread view is opened from panel; sharing avoids redundant fetch |
| Write content stripped from sanitiseInput | Truncate to N chars | Content can be megabytes; file_path is enough for the reader |

---

## What remains open

See `[[TODO]]` for the backlog. Critical items:
- `serve.mjs` has zero test coverage (trace resolver, cache, file watchers)
- `analyze-pi.mjs` missing 4 fields — Pi sessions silently degrade in thread view
- Token arithmetic computed in 3 places (analyze → enrich → buildGraph)

---

## Links
- [[kaaro-sessions-area]] — the system this sprint extended
- [[pending-asst-pattern]] — key skill surface crystallized here
- [[sse-jsonl-live-reload]] — architecture pattern for the pulse layer
- [[context-tree-thread-view]] — crystallized output of the context-tree RFC
