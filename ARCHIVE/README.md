# ARCHIVE

This folder holds code, modules, or paths that were superseded during refactors
(e.g. the multi-harness TDD work addressing the 2026-06 review).

## Convention
- Move clearly dead/unused code here instead of deleting (preserves history for archaeology).
- Add a README entry with date, reason, and what replaced it.
- Remove imports at the call-site before moving code here.

## Log

| Date | What | Why | Replaced by |
|---|---|---|---|
| 2026-06 | `lib/pulse-parser.mjs` CC/Pi divergence (separate file-op Sets, block shape branches) | Extracted into harness-dispatched adapters | `lib/pulse-adapters.mjs` + `FILE_OP_TOOLS` from `lib/session-reducer.mjs` |
| 2026-06 | Inline session-counting in `analyze.mjs` / `analyze-pi.mjs` | Moved to normalized adapter + reducer pipeline | `adapters/*.mjs` + `lib/session-reducer.mjs` |
| 2026-07 | `CODE-REVIEW-FINDINGS.md` (root) | Point-in-time review of `feat/multi-harness-tdd`; findings resolved and tracked live in `TODO.md` instead | `TODO.md`, `docs/harnesses.md` |
| 2026-07 | `ANTIGRAVITY-ADAPTER-FINDINGS.md`, `GROK-ADAPTER-FINDINGS.md`, `PI-ADAPTER-FINDINGS.md` (root) | One-time per-harness investigation notes; superseded by the living support matrix | `docs/harnesses.md`, `hooks/registry.mjs` |
| 2026-07 | `AGENT-LOG.md` (root) | Session retrospective from the `subagent-improvement` branch; content already crystallized into the PKM vault | `notes/pipelines/2026-06-session-intelligence.md`, `notes/crystallized/*`, CLAUDE.md gotchas |
| 2026-07-30 | `docs/SIGNAL-INTELLIGENCE.md` | Dated 2026-06-10; documents the pre-split `lib/` structure (`lib/event-types.mjs`, `lib/audio-sim.mjs`, `lib/pulse-transformer.mjs`, `adapters/*.mjs`) and calls that migration "done" — superseded the very next day by the `hooks/`+`surface/` two-layer split. Found stale (`lib/` no longer exists) during a docs-drift check. | `experience/audio/event-registry.mjs`, `hooks/pulse-transformer.mjs`, `hooks/adapters/*.mjs`, CLAUDE.md architecture section |

When adding new harnesses, prefer the normalized adapter pattern so less ends up here.
