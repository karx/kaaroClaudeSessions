# Codex Harness

`kaaro-sessions` can read local Codex task transcripts from `$CODEX_HOME` or
`~/.codex`, normalize them into the same session model as the other harnesses,
and stream live pulses while a task is still running.

This page documents the Codex-specific behavior. For the full multi-harness
matrix, see [harnesses.md](./harnesses.md).

## Quick Start

Start the local server as usual:

```bash
node serve.mjs
```

The server watches:

```text
$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl
```

If `CODEX_HOME` is not set, it falls back to:

```text
~/.codex
```

When Codex task files change, `kaaro-sessions` tails the new JSONL records,
emits live SSE pulses for `/now` and `/daw`, then schedules the normal
debounced graph rebuild.

## Storage Layout

Codex writes dated rollout files:

```text
~/.codex/
  session_index.jsonl
  sessions/
    2026/
      08/
        21/
          rollout-2026-08-21T20-02-32-01a025b4-1087-7bc1-aabc-47bf2806b894.jsonl
```

`session_index.jsonl` is used as a title side channel. The scanner keeps the
latest entry per task id and uses `thread_name` as `session.ai_title`.

## What Is Extracted

| Codex raw record | Normalized output | Used by |
|---|---|---|
| `session_meta` | `session_meta`, `branch_change` | project labels, model/version/cwd, branch history |
| `turn_context` | `session_meta` | cwd/model fallback |
| `response_item` message, role `user` | `user_turn` | first prompt, Thread View text, human-turn pulses |
| `response_item` message, role `assistant` | `assistant_turn`, `content_block:text` | Thread View text, word/chirp pulses |
| `response_item` reasoning | `content_block:thinking` | thinking count and thinking pulses |
| `response_item` function call | `tool_use` | tool counts, graph stats, DAW/Now pulses |
| `response_item` function call output | `tool_result` / `tool_error` | error counts and error pulses |
| `event_msg` token count | `tokens` | session size and token pulses |
| `event_msg` agent message | `content_block:text` | live commentary pulses |

The implementation lives in:

- [hooks/adapters/codex.mjs](../hooks/adapters/codex.mjs)
- [hooks/analyzers/analyze-codex.mjs](../hooks/analyzers/analyze-codex.mjs)
- [hooks/registry.mjs](../hooks/registry.mjs)
- [hooks/session-locators.mjs](../hooks/session-locators.mjs)

## Project Labels

Codex transcripts include the working directory in `session_meta.cwd` or
`turn_context.cwd`. The scanner derives:

- `project_id` from the normalized cwd path
- `project_label` from the cwd basename

This keeps Codex tasks grouped by the workspace where they ran.

## Token Handling

Codex token events can include both `last_token_usage` and cumulative
`total_token_usage`. The adapter intentionally ignores cumulative totals and
uses only `last_token_usage`.

For Codex, only output tokens are counted into the normalized token object:

```json
{
  "input": 0,
  "output": 1234,
  "cache_create": 0,
  "cache_read": 0
}
```

Older Codex logs can report input and cache counters in a cumulative way within
a task. Counting them as per-event work makes graph sizing and audio intensity
explode into unusable ranges. Output tokens are the stable signal for "agent
work heard/seen" in this harness.

## Live Watch

The registry watches dated rollout paths:

```text
sessions/YYYY/MM/DD/rollout-*.jsonl
```

It ignores `session_index.jsonl` for live pulses because that file is metadata,
not a transcript stream. Title updates are picked up during the next full scan.

Codex live events flow through the same pipeline as other harnesses:

```text
fs.watch -> surface/watch-handlers.mjs
         -> surface/pulse-emitter.mjs
         -> hooks/adapters/codex.mjs
         -> hooks/pulse-transformer.mjs
         -> SSE /now + /daw
```

## Trace Support

Codex is trace-capable. `/api/trace/:session_id` resolves the rollout file via
`locateCodexSession()`, reads the raw JSONL, normalizes it with the Codex
adapter, and reconstructs the Thread View from normalized records.

Codex does not currently emit `context_reset` records into kaaro's normalized
model, so most Codex traces appear as a single segment.

## Tests

Codex coverage is intentionally localized:

- [test/adapters/codex.test.mjs](../test/adapters/codex.test.mjs) checks raw
  Codex records map to turns, text, tool calls, results, and token events.
- [test/analyze-codex.test.mjs](../test/analyze-codex.test.mjs) checks dated
  rollout scanning, title index use, and canonical session shape.
- [test/adapters/nr-compliance.test.mjs](../test/adapters/nr-compliance.test.mjs)
  includes Codex in the permanent NormalizedRecord contract guard.
- [test/harness-registry.test.mjs](../test/harness-registry.test.mjs) checks
  Codex registry and watch behavior.

Run:

```bash
node --test test/adapters/codex.test.mjs test/analyze-codex.test.mjs
node --test
```

## Known Limits

- Codex title changes in `session_index.jsonl` are scan-time metadata, not live
  pulse events.
- Codex input/cache token counters are not used for sizing or audio because
  older logs can report them as cumulative values.
- Context resets are not currently derived from Codex compaction metadata.
