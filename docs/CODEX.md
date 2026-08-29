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
| `response_item` message, role `user` | `user_turn` | every qualifying prompt (≥8 chars), Thread View text, human-turn pulses |
| `response_item` message, role `assistant` | `assistant_turn`, `content_block:text` | Thread View text, word/chirp pulses |
| `response_item` reasoning | `content_block:thinking` | thinking count and thinking pulses |
| `response_item` function call | `tool_use` | tool counts, graph stats, DAW/Now pulses. Shell calls (`shell_command` — the real local CLI name; `exec_command`/`shell`/`bash` kept as aliases) get `category` from `categorizeBash()` (git/npm/node/python/other) |
| `response_item` function call output | `tool_result` / `tool_error` | error counts and error pulses |
| `response_item` custom tool call (`apply_patch`) | `tool_use` | file_ops, graph file-node connections. Raw `input` is a diff-DSL string ("`*** Update File: x`"), not structured JSON — every touched path is parsed out into `input.paths[]` so a single multi-file patch credits every file without inflating the tool-call count |
| `response_item` custom tool call output | `tool_result` / `tool_error` | error detection from the wrapped JSON's `metadata.exit_code` |
| `event_msg` token count | `tokens` | session size and token pulses |

`event_msg`'s `agent_message`/`user_message`/`agent_reasoning` are a second, redundant narration channel — verified byte-identical text to the corresponding `response_item` message/reasoning, written ~1ms apart. Only `response_item` is read for turn content; handling both was found to double every `content_block:text` NR (62 for 31 real assistant turns in one session before this was fixed).

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

Verified against live local rollouts (2026-08-29): `last_token_usage.input_tokens`
and `.cached_input_tokens` grow every turn because they report the size of the
*whole context window sent with that request*, not new tokens since the last
turn — a session's `total_token_usage.input_tokens` is essentially the running
sum of each turn's `last_token_usage.input_tokens`. Treating either as a
per-event delta would make graph sizing and audio intensity explode into
unusable ranges (confirmed: summing `last_token_usage.input_tokens` across one
session's turns lands within ~0.3% of that session's final
`total_token_usage.input_tokens`). Output tokens are the stable signal for
"agent work heard/seen" in this harness. A future improvement could derive a
true per-turn delta from consecutive `total_token_usage` snapshots instead of
dropping input/cache entirely — not yet implemented.

Zeroing input/cache also zeroes the *ratio* — `cache_hit_rate` — even though
real Codex cache-hit rates run high (80-90%+ in sampled sessions). Registry
capability `cache_accounting: false` (also set on Copilot, same UI symptom,
different cause — see `docs/CODEX.md` §Token Handling vs. Copilot's
output-only VS Code API) makes `enrich-session.mjs` emit `cache_hit_rate:
null` instead of `0` for these harnesses, and the UI renders `N/A` rather than
a false `0%`. See `RFC-cache-hit-rate.md` for the full analysis — that RFC's
Option D (UI honesty) is what's implemented; Option C (recovering a real
last-turn-snapshot ratio) is still an open follow-up.

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
- Codex input/cache token counters are not used for sizing or audio — see
  [Token Handling](#token-handling) above.
- Context resets are not currently derived from Codex compaction metadata.
- No `unknown_record` catch-all yet (matches Command Code, unlike the other six
  adapters) — an unrecognised raw record type is silently dropped instead of
  surfacing as a kind-map coverage hole.
