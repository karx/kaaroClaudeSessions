# EXECUTION.md — Plan & Execution Tracker (Agent-First)

> **Who this is for:** any agent (or human) picking up this work cold.
> Every item is broken into TDD units. A unit is not done until its cycle is:
> **🔴 red** (failing test committed to working tree) → **🟢 green** (minimal code passes) →
> **📦 commit** (one atomic commit per unit, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
> Never batch units into one commit. Never write code before its failing test.
>
> **Ground rules** (from CLAUDE.md + project memory):
> - `node --test` must be green before every commit (full suite, <5 s, zero npm deps).
> - Deprecated code moves to `ARCHIVE/`, never `@deprecated` markers.
> - `experience/` must NOT import from `hooks/` — verified boundary, keep it.
> - Update this file's checkboxes as part of each unit's commit.

**Plan origin:** approved 2026-07-19 (plan file `elegant-splashing-token.md`).
**Baseline at start:** master fast-forwarded to `44a22cc`, 1500 tests green.

---

## Item 1 — Merge stack to master + CI ✅ DONE

- [x] Fast-forward `master` to `kaaro/feat/session-clusters` tip (`44a22cc`), push
- [x] `.github/workflows/test.yml` — `node --test`, matrix Node 18/20/22, push+PR (`63a0980`)
- [x] Verify: Action run 29698488417 → **success** on all three Node versions

Notes: remote moved to `https://github.com/karx/kaaroSessions.git` (old URL redirects).
`node:sqlite` (copilot index) degrades gracefully pre-22.5 — test self-skips, matrix safe.

## Item 2 — Pi re-scope: close TODO #1 as data-absent ✅ DONE (`afe9867`)

- [x] 🔴 `test/adapters/pi.test.mjs`: `thinking_level_change` → `mode_shift` NR (`mode: "thinking:<level>"`)
- [x] 🟢 `hooks/adapters/pi.mjs`: handle `thinking_level_change`
- [x] Docs: TODO.md #1 rewritten as resolved/data-absent; CLAUDE.md coverage gap + docs/harnesses.md Pi row updated
- [x] 📦 One commit, suite 1501 green

Grounding (2026-07-19 survey of all local Pi transcripts): raw format has ONLY
`session` / `model_change` / `thinking_level_change` / `message` record types.
`context_resets`, `ai_title`, `subagent_count`, `branches` do not exist in Pi data —
registry `false` capability flags are honest. Do not reopen without new Pi format evidence.

## Item 3 — Token arithmetic → single source in enrich-session ⏳ IN PROGRESS

**Design (locked during exploration):**
- `hooks/enrich-session.mjs` is the ONLY place token arithmetic lives:
  - export `tokensWork(t)` = `(t?.output || 0) + (t?.cache_create || 0)`
  - `enrichSession(sess)` additionally sets `sess.tokens_work = tokensWork(sess.tokens)`
  - new export `enrichProject(proj)` sets `proj.tokens_work` + `proj.tokens_total`
- `surface/analyze-orchestrator.mjs` `buildSessionsOutput()` calls `enrichProject` on every
  merged project (single choke point — per-harness analyzers already call `enrichSession`).
- `experience/graph-pipeline.mjs` becomes **strict passthrough**: session nodes use
  `sess.tokens_work || 0`; project nodes use `proj.tokens_work` / `proj.tokens_total`;
  timeline uses `s.tokens_work || s.tool_calls || 0`; `MAX_WORK` from `s.tokens_work`.
  The `experience/ → hooks/` import boundary stays clean (no imports — passthrough only).
  Test fixtures in `test/graph-pipeline.test.mjs` gain `tokens_work` (they model
  post-enrich data). sizeNorm tool_calls fallback for tokenless harnesses is sizing
  policy, not arithmetic — it stays in the pipeline.
- `hooks/sessions-schema.mjs`: document `tokens_work` in `OPTIONAL_SESSION_FIELDS`
  (derived by enrich, consumed as passthrough).

**Units:**
- [ ] 🔴→🟢→📦 Unit 3a: `test/enrich-session.test.mjs` — `tokensWork` helper + `enrichSession` sets `tokens_work` + `enrichProject` sets project fields; implement in `hooks/enrich-session.mjs`; wire `enrichProject` into `surface/analyze-orchestrator.mjs` (+ orchestrator test asserts projects carry `tokens_work`)
- [ ] 🔴→🟢→📦 Unit 3b: `test/graph-pipeline.test.mjs` — passthrough proof (fixture `tokens_work: 999` ≠ formula → node carries 999) + missing passthrough coverage for `tools_top`, `context_resets`, `ai_title`, `subagent_count`, `branches` (closes CLAUDE.md gap); make pipeline strict-passthrough; update fixtures to enriched shape
- [ ] 📦 Unit 3c: schema doc for `tokens_work` + CLAUDE.md "Known coverage gaps" update (docs-only, rides with 3b commit if trivial)
- [ ] Verify: `node analyze.mjs && node build.mjs` — graph renders, node sizes unchanged vs pre-change build

## Item 4 — Policy pillar phase 1 (W-POL-01/02/03 + /api/signals) ⬜ PENDING

Signals only — auditor, never gatekeeper. Predicates needing W-OBS-02 attribution
(`tools.contains`) are OUT of scope; evaluator must skip unknown predicates with an
INFO diagnostic (visible, not silent).

- [ ] 🔴→🟢→📦 Unit 4a: `test/policy.test.mjs` — `hooks/policy.mjs` loader/merger:
      project `.agents/policy.json` prepends global `~/.agents/policy.json`;
      absent/malformed → warn + null (mirror `loadClusterOverrides()` in build.mjs)
- [ ] 🔴→🟢→📦 Unit 4b: `test/signal-evaluator.test.mjs` — `hooks/signal-evaluator.mjs`
      pure `(session, rules) → signals[]` per W-POL-03 shape; predicates:
      `skill`, `tool`, `tool_errors.gt`, `cache_hit_rate.lt`, `duration_min.gt`,
      `project`, `compact_count.gt`; first matching rule wins; INFO diagnostic for
      unsupported predicate keys
- [ ] 🔴→🟢→📦 Unit 4c: wire into `surface/analyze-orchestrator.mjs` →
      `signals-data.json` emitted beside `sessions-data.json` (gitignore it);
      test in `test/analyze-orchestrator.test.mjs`
- [ ] 🔴→🟢→📦 Unit 4d: `GET /api/signals` in `surface/http-routes.mjs`
      (W-REP-02 response shape: `generated_at`, `total_signals`, `by_level`, `by_rule`,
      `signals[]`); test in `test/http-routes.test.mjs` (ephemeral port pattern)
- [ ] Verify end-to-end: sample `.agents/policy.json` with one rule →
      `node analyze.mjs` produces `signals-data.json` → `node serve.mjs` → `/api/signals`
- [ ] W-REP-01 graph overlay: explicitly OUT of scope (next batch)

## Item 5 — DX batch (one commit) ⬜ PENDING

- [ ] 🔴→🟢 Concat-order assertion in `build.mjs`: client module filenames must sort
      identically numerically and lexically (guards a future `09b-` file); test in
      `test/build.test.mjs`
- [ ] Schema comment in `hooks/sessions-schema.mjs` + `analyze.mjs`: why `/agent` → `skills[]`
      vs `/config` → `builtin_commands[]` (TODO #4)
- [ ] TODO.md refresh: stale test count (says 1436 → update to current), strike resolved items
- [ ] 📦 Single commit for the batch

---

## Status log

| When (UTC) | Event |
|---|---|
| 2026-07-19 | Plan approved; Item 1 done (CI green run 29698488417); Item 2 done `afe9867`, suite 1501 |
| 2026-07-19 | Item 3 design locked (strict passthrough + enrichProject in orchestrator); units 3a–3c pending |
