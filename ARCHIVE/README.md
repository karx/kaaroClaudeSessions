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
| 2026-08-29 | `surface/analyze-orchestrator.mjs` | Caused a `hooks/analyzers` → `surface` → root `analyze.mjs` circular import (`buildSessionsOutput` here imported `buildProjectSummary`/`buildGlobalRollup` back from `analyze.mjs`; all six per-harness analyzers depended on this file). Found by `test/architecture-boundary.test.mjs`, tracked as TODO #7, now resolved. | `hooks/session-output.mjs` (all four assembly functions consolidated there; `analyze.mjs` re-exports for backward compat) |

When adding new harnesses, prefer the normalized adapter pattern so less ends up here.
