# Grok Build — Adapter Findings

**Surveyed:** 2026-06-07  
**Corpus:** live session `019ea1c9-46ee-77e0-bf36-f87a6403b5db` on `D:\src\kaaroSessions`  
**Sessions root:** `~/.grok/sessions/`

---

## Session directory layout

```
~/.grok/sessions/
  <url-encoded-cwd>/                 e.g. D%3A%5Csrc%5CkaaroSessions
    <session-uuid>/
      updates.jsonl                    ← authoritative ACP stream (watch + analyze)
      summary.json                     ← cwd, model, title, git branch
      signals.json                     ← aggregate counters (tool calls, compaction, tokens)
      chat_history.jsonl               ← model-facing history (not used by adapter)
      terminal/                        ← per-call stdout logs
      compaction_checkpoints/
    prompt_history.jsonl               ← group-level, not per-session
```

---

## Primary analyze stream: `updates.jsonl`

JSON-RPC envelopes: `{ method, params: { sessionId, update }, _meta }`.

| `sessionUpdate` | Role in adapter |
|---|---|
| `user_message_chunk` | user turn + model from `_meta.modelId` |
| `agent_message_chunk` | assistant turn + words pulse |
| `agent_thought_chunk` | assistant turn (deduped per `turnStartMs`) |
| `tool_call` | tool_use + live `tool_call` pulse |
| `tool_call_update` | tool errors when `status=completed` and `exit_code≠0` |
| `compaction_checkpoint` / `auto_compact_completed` | `context_reset` |
| `available_commands_update` | skip |
| `plan`, `current_mode_update` | skip |

**Live session counts (019ea1c9):** 1518 records — 326 `tool_call`, 902 `tool_call_update`, 7 `user_message_chunk`.

---

## Multi-file `readGrokSession()`

```javascript
readGrokSession(sessionDir) → { records, summary, signals, sizeBytes }
```

- **records** — parsed `updates.jsonl`
- **summary** — `generated_title`, `current_model_id`, `head_branch`, `info.cwd`
- **signals** — `toolCallCount`, `compactionCount`, `contextTokensUsed`, `sessionDurationSeconds`

Project slug derived from URL-decoded cwd dir name (same rules as Antigravity).

---

## Tool name mapping

| Grok `title` | Canonical op |
|---|---|
| `Read` | file read |
| `Write` | file write |
| `StrReplace`, `EditNotebook` | file edit |
| `Shell` | bash category |
| `Grep`, `Glob`, `Task`, … | tool stats only |

---

## Live pulse contract

Watch path: `<encoded-cwd>/<session-id>/updates.jsonl`

Pulse on:
- `tool_call` → `tool_call` SSE (Shell/Grep/Read/Write/…)
- `agent_message_chunk` → `words` SSE (≥3 words)

No per-chunk `tokens` pulse — Grok exposes aggregate usage in `signals.json` only.

---

## Validation target

After Phase 4, `node serve.mjs` watching `~/.grok/sessions/` should:

1. Include session `019ea1c9` in the graph after rebuild (`--all-harnesses`)
2. Stream live `tool_call` pulses as this session's `updates.jsonl` grows
3. Match pulses to graph node via `node.id.startsWith('019ea1c9')`

---

## Related

- [[Grok Coding Harness]] (ebrain vault)
- `lib/harness-registry.mjs` — `grok` descriptor
- `adapters/grok.mjs` — `recordsToNormalized`
- `analyze-grok.mjs` — scanner + `readGrokSession`