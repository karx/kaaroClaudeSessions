---
published: false
title: "Pending-Asst Pattern — Deferred Turn Flush for Tool-Result Pairing"
tags: [pattern, stream-processing, tool-calling, llm-reconstruction, skill]
description: "When reconstructing LLM conversation turns from a flat event stream, assistant turns must be held open until the next user record arrives so that tool_result blocks can be paired back to their originating tool_use calls by ID."
date: 2026-06-07
layer: L3-Principle
maturity: EVERGREEN
para: SkillSurface
---

# Pending-Asst Pattern

## The Problem

Claude Code JSONL logs interleave `assistant` and `user` records chronologically.
An `assistant` record contains `tool_use` blocks. The corresponding `tool_result`
blocks arrive in the *next* `user` record's `content` array, matched by `tool_use_id`.

If you flush each record as you see it, the assistant turn has no error information.
You must defer.

---

## The Pattern

```javascript
let pendingAsst = null;

for (const rec of records) {

  if (rec.type === 'assistant') {
    _flushPending();           // flush any previous (consecutive assistant turns)
    pendingAsst = {
      role: 'assistant',
      tool_calls: extractToolCalls(rec),   // is_error: null on each
      // ... other fields
    };
  }

  if (rec.type === 'user') {
    if (pendingAsst?.tool_calls.length) {
      // pair tool_results back to their tool_calls
      const byId = new Map(pendingAsst.tool_calls.map(tc => [tc.id, tc]));
      for (const block of (rec.message?.content || [])) {
        if (block.type !== 'tool_result') continue;
        const tc = byId.get(block.tool_use_id);
        if (tc) {
          tc.is_error = block.is_error || false;
          if (block.is_error) tc.error_text = extractText(block.content);
        }
      }
    }
    _flushPending();            // now flush with errors attached

    if (hasHumanText(rec)) {
      emit({ role: 'user', text: extractText(rec) });
    }
  }
}

_flushPending();  // close the final open turn
```

---

## Key invariants

1. **`_flushPending` before every new assistant record** — consecutive assistant turns
   (streaming continuations) are uncommon but valid; always flush first.

2. **`_flushPending` before every user record** — ensures tool_results are attached
   before the assistant turn is finalised.

3. **`_flushPending` after the loop** — the last assistant turn has no following
   user record; flush at EOF.

4. **Tool-result-only user records produce no user turn** — a user record that
   contains only `tool_result` blocks is bookkeeping, not conversation. Check:
   `_extractText(rec.message.content)` returns null → skip emitting a user turn.

---

## Where this is used

- `lib/context-tree.mjs` ��� turn-level session reconstruction for the thread view

---

## Generalises to

Any system reconstructing turn structure from an interleaved event stream where
responses (B) must carry state derived from the acknowledgement of the preceding
request (A), and that acknowledgement arrives embedded in the *next* request record.

Examples:
- LLM tool-use logs (this case)
- HTTP request/response pairs from proxy logs where responses precede their ACKs
- Any async RPC trace where callback payloads piggyback on the next request frame

---

## Links

- [[kaaro-sessions-area]] — where this pattern is implemented
- [[context-tree-thread-view]] — the crystallized output that uses this pattern
- [[sse-jsonl-live-reload]] — sibling pattern in the same system
