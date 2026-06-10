# Harness Support Matrix

This is the living compatibility / support page for kaaroSessions multi-harness pipeline.

It is intended to be **self-growing**: when adding or discovering differences for a harness, update this table and the related code/docs.

## Overview

| Harness       | ID            | Root (default)                  | Tokens | Pulse (live) | Trace (/api/trace) | Notes / Quirks |
|---------------|---------------|---------------------------------|--------|--------------|--------------------|---------------|
| Claude Code   | `claude-code` | `~/.claude/projects/`           | Yes    | Yes          | Yes                | Full optional fields (context_resets, ai_title, subagent_count, branches). `turn_duration` provides authoritative `message_count`, `slug`, `duration_ms`. |
| Pi            | `pi`          | (via `PI_SESSIONS_ROOT`)        | Yes    | Yes          | No                 | Many optionals declared `false` in registry (context_resets etc. not yet extracted in adapter). Usage may be absent on some messages (guarded). |
| Antigravity   | `antigravity` | `~/.gemini/antigravity/brain/`  | No     | Yes          | No                 | Tokenless (size_proxy = tool_calls). No project_id (always null). Uses `transcript.jsonl` (preferred) or `overview.txt`. |
| Grok          | `grok`        | (via `GROK_SESSIONS_ROOT`)      | No     | Yes          | Yes                | Tokenless (size_proxy = tool_calls). Streaming chunks: dedup on `turnStartMs` when present; content blocks for text handled separately. Rich meta from summary/signals. |
| opencode      | `opencode`    | `~/.local/share/opencode/storage/` | Yes | Yes          | No                 | Session spread across three JSON trees: `session/<proj>/ses_*.json` (info), `message/<ses>/msg_*.json` (roles + full token breakdown incl. cache read/write), `part/<msg>/prt_*.json` (text/reasoning/tool/step/patch). Whole-file JSON watch (`read_mode: 'json'`), not JSONL tail. Tool parts emit only on completed/error (file is rewritten across states). step-finish tokens silenced (message envelope is authoritative). Project id derived from `info.directory` path → unifies with CC project ids. |

## Optional Session Fields by Harness

See `lib/sessions-schema.mjs` OPTIONAL_SESSION_FIELDS for the full list.

Populated (✓) / absent or partial (—) as of latest:

- `context_resets`, `ai_title`, `subagent_count`, `branches`: ✓ for claude-code + grok; — for pi + antigravity. opencode: `ai_title` ✓ (session info `title`), others —.
- `message_count`: Authoritative from harness metadata when available (CC `turn_duration`); derived as `user_turns + assistant_turns` fallback for others.
- `content_blocks` / `thinking_count`: Populated via `content_block` normalized records (CC/Grok). Used for UI dots and panels.

## Normalized Record Kinds (common vocabulary)

All adapters emit from this small set (the "harness hop"):

- `user_turn`
- `assistant_turn` (exactly one per conversational assistant response)
- `content_block` (per-block telemetry inside an assistant turn; does **not** increment turn counts)
- `tool_use`, `tool_result`
- `tokens`
- `context_reset`
- `session_meta`
- `branch_change`
- `skill_invoke`

See `adapters/*.mjs` + `lib/session-reducer.mjs` and the Architecture Note in `analyze-intelligence.md`.

**Recent refinements (Phase 3/4):**
- Grok streaming without `_meta.turnStartMs` now safely limited to one `assistant_turn` per response burst (using `emittedAssistantSinceLastUser` guard + reset on user).
- File-op detection for pulses unified to `FILE_OP_TOOLS` (no more per-harness duplicate Sets).
- Error isolation in scanners and resolver cache + watch invalidation added for resilience.

## Adding a New Harness (ergonomics goal)

1. Registry entry in `lib/harness-registry.mjs` (roots, capabilities, `watch.matchLogFile` / `ctxFromPath` / `rebuildArg`).
2. `adapters/<new>.mjs` exporting `recordsToNormalized(records)`.
3. Scanner + single-session analyzer in `analyze-<new>.mjs` (can delegate to normalized + reduce for the stats path).
4. Optional: context-tree variant only if you want rich `/api/trace`.
5. Wire in `lib/scan-harnesses.mjs` SCANNERS and `lib/pulse-adapters.mjs` if live pulses desired.
6. Add parity / correctness tests + update this matrix.

The goal is that a 5th harness feels like a localized, obvious addition with minimal cross-file churn.

## Known Gaps / Future

- Subagent sessions under CC `<project>/subagents/*.jsonl` are not yet walked by the main CC scanner.
- Full incremental merge for Grok/Antigravity (their `rebuildArg` currently returns `null`).
- Deeper caching/index for resolver beyond the simple Map (current clear-on-any-change is pragmatic).
- Serve has very little unit test coverage (HTTP, watch debounce, trace path).

Update this file whenever behavior or support changes. It is the single source of truth visible to contributors and users.

Last updated: during Phase 3/4 work on the multi-harness-tdd branch (addressing the 2026-06 code review).