# TODO — kaaroSessions

**Current state (2026-07-30, post Batch 2 Unit 6c):** **1565 tests pass, 0 fail.**
Seven harnesses supported (claude-code, pi, antigravity, grok, opencode, copilot,
command-code) through the `hooks/` (normalization) + `surface/` (HTTP+SSE) split.
CI runs `node --test` on push/PR (Node 18/20/22). Policy pillar phase 1 landed
(`hooks/policy.mjs`, `hooks/signal-evaluator.mjs`, `/api/signals`). See
`docs/harnesses.md` for the live support matrix, CLAUDE.md's "Known coverage gaps"
for test-coverage holes, and EXECUTION.md for the active execution tracker.
This file tracks genuinely open design/DX work instead.

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

### 2. ~~Token arithmetic computed in multiple places~~ ✅ Resolved 2026-07-19
`tokensWork()` in `hooks/enrich-session.mjs` is now the single home of the formula;
`enrichSession`/`enrichProject` set `tokens_work` upstream and
`experience/graph-pipeline.mjs` is strict passthrough (proof-tested).

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

### 4. ~~`BUILTIN_COMMANDS` vs `skills` split is undocumented~~ ✅ Resolved 2026-07-19
Documented at the definition site (`hooks/helpers/analyze-helpers.mjs`) and in the
schema field contract (`hooks/sessions-schema.mjs`).

### 5. Browser module load-order coupling
`TOOL_COLORS`, `_fmtTok`, `_esc` are globals sourced from `experience/client-core.mjs`
(injected via `01-data.js`). Any new module must know it loads after core — the
dependency is implicit.

**Consider:** `window.UI = { fmtTok, esc, TOOL_COLORS }` makes the dependency
explicit and grep-able. Not urgent but will bite as more client modules are added.

### 6. ~~Client module numbering vs concat order~~ ✅ Resolved 2026-07-19
`orderClientModules()` in `build.mjs` fails the build on any client filename that
isn't `NN-name.js` (tested in `test/build.test.mjs`).

---

## 💬 Open UX questions

- Tool calls in the graph: make them more visually distinct — currently only visible in panel
- Path/node highlight logic: clicking a session highlights only immediate neighbours;
  is multi-hop expansion wanted?
- Branch edge logic: what exactly triggers a branch edge vs a membership edge?
  Document or surface this in the detail panel.
