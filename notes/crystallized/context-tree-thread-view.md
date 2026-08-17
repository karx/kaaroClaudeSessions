---
published: false
title: "Context Tree + Thread View — Crystallized"
tags: [kaaro-sessions, crystallized, context-tree, thread-view, llm-reconstruction]
description: "Completed implementation of the context-tree RFC. A session is now fully reconstructable from its JSONL: segment-level aggregates (Phase 1) and per-turn conversation detail with tool call arguments (Phase 2)."
date: 2026-06-07
layer: L1-Instance
maturity: EVERGREEN
para: Crystallized
---

# Context Tree + Thread View — Crystallized

**RFC:** `RFC-context-tree-visualization.md` (Status: Implemented)
**Sprint:** `[[2026-06-session-intelligence]]`
**Tests:** 67 tests in `test/context-tree.test.mjs`, all passing

---

## What was built

A pure function `reconstructContextTree(records)` in `lib/context-tree.mjs` that
takes the flat JSONL record array for a session and returns:

```typescript
{
  ai_title: string | null,
  segments: Segment[]   // one per compact_boundary
}

Segment {
  index: number,
  ts_start, ts_end: string,
  user_turns, assistant_turns: number,
  tool_calls: number,
  subagent_count, thinking_count: number,
  permission_modes: string[],
  branches: string[],
  tool_summary: Record<string, number>,
  tokens: { output, cache_read },
  compact_trigger: 'auto' | null,
  turns: Turn[]    // Phase 2
}

Turn {
  role: 'user' | 'assistant',
  ts: string | null,
  text: string | null,         // 500-char cap
  tool_calls: ToolCall[],
  has_thinking: boolean,
  usage: { output, cache_read } | null,
  duration_ms: number | null,
  stop_reason: string | null
}

ToolCall {
  id, name: string,
  input: object,    // sanitised — large blobs stripped
  is_error: boolean | null,
  error_text: string | null
}
```

---

## Key design decisions

### Phase 1 → Phase 2 is additive
All Phase 1 segment-level tests remain valid. Phase 2 adds `turns[]` to each
segment without changing any existing field. Safe to add, safe to ignore.

### pendingAsst flush pattern
The central insight: assistant turns must be held open until the next user record
arrives so `tool_result` blocks can be paired back to `tool_use` blocks by ID.
See `[[pending-asst-pattern]]` for the reusable abstraction.

### Input sanitisation per tool
`_sanitizeInput(name, input)` dispatches by tool name:
- `Write`: omit `content` (can be megabytes); keep `file_path`
- `Edit`: truncate `old_string`/`new_string` to 160 chars; keep `file_path`
- `Bash`/`PowerShell`: keep `command` in full (essential for "what scripts ran")
- `Agent`: truncate `description` to 400 chars
- Unknown: pass scalar fields through, truncate strings > 300 chars

### Tool-result-only user records produce no user turn
A user record that contains only `tool_result` blocks is bookkeeping.
`_extractText` returns null → no turn emitted. Only human-typed text generates
a user turn in the output.

---

## The UI surface

`18-thread-view.js` renders the reconstructed tree as a full-screen overlay:
- Each segment = a bordered block with header (window number, mode, branch, metrics)
- Composition bar = stacked proportional colored bar (tool families)
- Turn list = USER/ASST rows with actor labels, timestamps, tool call rows
- Tool call rows: colored name, primary argument, multiline Bash indent, Edit diff preview, error indicator
- `⟲ context reset` dividers between segments

Entry: `window.openThread(sessionId)` — fetches `/api/trace/:id`, uses `window._traceCache`.

---

## What this enables (new questions answerable)

| Before | After |
|---|---|
| How many tokens? | How many per context window? Where did the bulk go? |
| What files were touched? | In which context window? After how many turns? |
| Did it hit max_tokens? | Which turn? What was the stop_reason? |
| Was there a subagent? | In which window, and what was it asked to do? |
| What was the session about? | Read the ai_title + first turn verbatim |

---

## Phase 3 (not yet built)

Recursive subagent loading: the RFC envisions following `Agent` tool calls to
child session JSONL files and rendering them as nested trees. Current implementation
counts subagents but doesn't link to child sessions.

---

## Links

- [[pending-asst-pattern]] — core skill surface crystallized here
- [[kaaro-sessions-area]] — the system this extends
- [[proportional-strip-ui]] — the strip variant (17-trace-panel) that previews the thread
- [[2026-06-session-intelligence]] — the sprint that produced this
