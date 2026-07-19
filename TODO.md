# TODO — kaaroSessions

**Current state (2026-07, two-layer + Command Code):** **1436 tests pass, 0 fail.**
Seven harnesses supported (claude-code, pi, antigravity, grok, opencode, copilot,
command-code) through the `hooks/` (normalization) + `surface/` (HTTP+SSE) split.
See `docs/harnesses.md` for the live support matrix and CLAUDE.md's "Known coverage
gaps" section for the canonical, up-to-date list of test-coverage holes — not
duplicated here. This file tracks genuinely open design/DX work instead.

---

## ✅ Resolved — Pi parity re-scoped (2026-07-19)

### 1. `analyze-pi.mjs` parity — closed as data-absent
Surveyed all local Pi transcripts: the raw format contains only four record
types (`session`, `model_change`, `thinking_level_change`, `message`). There
are **no** compaction, git-branch, AI-title, or subagent records in Pi's format,
so `context_resets`, `ai_title`, `subagent_count`, `branches` cannot be
extracted — the registry capabilities `false` flags are honest, not a gap.
The one extractable signal, `thinking_level_change`, now maps to a
`mode_shift` NR (`mode: "thinking:<level>"`) instead of `unknown_record`.

---

## 🟡 Architecture — data-flow awkwardness

### 2. Token arithmetic computed in multiple places
`session-reducer` → `enrich-session` → `graph-pipeline` each touch token fields.
`tokens_work` exists on session nodes but not project summary nodes.
`hooks/sessions-schema.mjs` doesn't enforce derivation order, so drift goes undetected.

**Fix:** Make `hooks/enrich-session.mjs` the single place all derived fields are
computed; `experience/graph-pipeline.mjs` passthrough only.

### 3. `tailAndPulse` fires before rebuild debounce
SSE pulses emit immediately on `.jsonl` change; graph rebuild is debounced 1500ms.
On fast multi-turn sessions, clients receive bursts of pulse events for data the
graph hasn't processed yet. The two clocks are intentionally decoupled, but
there's no backpressure if writes come faster than SSE can absorb.

**Consider:** Buffer pulse events; flush after rebuild completes. Or leave as
documented, intentional decoupling — don't "fix" it without re-checking this
reasoning first.

---

## 🟢 DX / naming

### 4. `BUILTIN_COMMANDS` vs `skills` split is undocumented
Two arrays on every session node; no comment in the schema explaining why
`/agent` goes into `skills[]` and `/config` into `builtin_commands[]`.
Invisible to new contributors.

**Fix:** Add a schema comment in `hooks/sessions-schema.mjs` and `analyze.mjs`.

### 5. Browser module load-order coupling
`TOOL_COLORS`, `_fmtTok`, `_esc` are globals sourced from `experience/client-core.mjs`
(injected via `01-data.js`). Any new module must know it loads after core — the
dependency is implicit.

**Consider:** `window.UI = { fmtTok, esc, TOOL_COLORS }` makes the dependency
explicit and grep-able. Not urgent but will bite as more client modules are added.

### 6. Client module numbering vs concat order
Numeric prefix implies "this loads first" but `build.mjs` concatenates by
`Array.sort()`. They align today; a file named `09b-` would silently break load
order. Add a build-time assertion or a comment in `build.mjs`.

---

## 💬 Open UX questions

- Tool calls in the graph: make them more visually distinct — currently only visible in panel
- Path/node highlight logic: clicking a session highlights only immediate neighbours;
  is multi-hop expansion wanted?
- Branch edge logic: what exactly triggers a branch edge vs a membership edge?
  Document or surface this in the detail panel.
