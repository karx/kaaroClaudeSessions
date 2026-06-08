# kaaroSessions — Wishlist

**Current implementation status (2026-06, feat/multi-harness-tdd branch):**  
The core `analyze → build → serve` pipeline now fully supports **4 harnesses** (claude-code, pi, antigravity, grok) via a clean normalized record adapter model (`adapters/*.mjs`, `lib/session-reducer.mjs`, `lib/scan-harnesses.mjs`, `lib/harness-registry.mjs`). Many "Phase 1" extraction and multi-harness readiness items (W-OBS-04, W-OBS-06) have been realized as part of the multi-harness TDD effort. See `docs/harnesses.md` for the live support matrix and `CODE-REVIEW-FINDINGS.md` for issues addressed on this branch. Policy and advanced Report pillars remain future work.

Items grouped by the three pillars: **Observe → Policy → Report**.
These extend the existing `analyze → build → serve` pipeline without breaking it.
The layer is **signal-only** — kaaroSessions reads JSONL files after the fact and cannot intercept or block agent execution.

---

## Architecture

```
Claude Code session
  └─ writes JSONL → ~/.claude/projects/<project>/<session>.jsonl
                              │
                    reads passively (non-blocking)
                              │
                              ▼
              analyze.mjs  [OBSERVE]
                ├─ skills[]         already extracted (extractSkills)
                ├─ tools{}          already extracted (tool_use blocks)
                ├─ file_ops{}       already extracted
                ├─ tokens           already extracted
                │
                ├─ [POLICY]  loadPolicy() → evaluate() → signals[]   ← new
                │
                └─ sessions-data.json + signals-data.json            ← new
                              │
              build.mjs    [REPORT]
                ├─ graph-data.json   (existing visualization)
                └─ signal overlay    (new: annotate nodes with signals)
                              │
              serve.mjs    [REPORT]
                ├─ /                → graph (existing)
                ├─ /api/sessions    → sessions-data.json (existing)
                └─ /api/signals     → signals-data.json (new)

kaaroSkills registry.json ──bridge──► analyze.mjs
  (skill metadata: version, tools, tags, scope)   enriches signals
```

**Key constraint:** Signals are emitted after sessions complete, not inline. The policy engine is an auditor, not a gatekeeper.

---

## Claude Code JSONL schema reference

Surveyed across 68 sessions / 13 projects / 13,816 records. Canonical record types:

| `type` / `subtype` | Count | Notes |
|---|---|---|
| `assistant` | ~6,370 | `message.content[]` contains `tool_use`, `text`, `thinking` blocks. `message.usage` includes cache tiers (`ephemeral_1h`, `ephemeral_5m`). Each `tool_use` block has a `caller` field. |
| `user` | ~4,217 | `message.content` is a string or array of `text`/`tool_result` blocks. Carries `entrypoint`, `cwd`, `gitBranch`, `version`, `sessionId`, `timestamp`. |
| `attachment` | ~627 | See attachment subtypes below. |
| `permission-mode` | ~574 | `{ permissionMode: "default"\|"bypassPermissions"\|... }`. First record in every session. |
| `system/turn_duration` | ~304 | `{ durationMs, messageCount, slug, version, gitBranch, cwd }`. Written at turn end. |
| `ai-title` | ~129 | `{ aiTitle: "Fix the script" }`. AI-generated session title — more descriptive than `first_user_message`. |
| `queue-operation` | ~72 | `{ operation: "enqueue"\|"dequeue", content }`. Queued user commands. |
| `system/local_command` | ~33 | `/rename`, `/compact`, etc. `content` contains `<command-name>` tag. |
| `system/away_summary` | ~32 | Idle-session summaries. |
| `system/compact_boundary` | ~14 | `{ compactMetadata: { trigger: "auto"\|"manual", preTokens } }`. |
| `agent-name` | ~13 | `{ agentName }`. Set when a named sub-agent runs. |
| `system/api_error` | ~2 | `{ error, retryInMs, retryAttempt, maxRetries }`. |
| `agent-color` | ~7 | `{ agentColor }`. Sub-agent UI colour. |
| `file-history-snapshot` | ~868 | Internal file tracking. Not semantically useful for analysis. |
| `last-prompt` | ~540 | `{ lastPrompt, leafUuid }`. Internal cursor marker. |

**Attachment subtypes** (`attachment.type`):

| `attachment.type` | Count | Notes |
|---|---|---|
| `task_reminder` | ~286 | `{ content: Task[] }`. Active task list at time of turn. |
| `deferred_tools_delta` | ~81 | Added/removed deferred tool names. |
| `skill_listing` | ~61 | Full skill descriptions available to this turn. |
| `invoked_skills` | ~14 | **Primary skill signal.** `{ skills: [{ name, path, content }] }`. Emitted when a skill is loaded. Has exact `timestamp`. More reliable than `<command-name>` scanning. |
| `hook_non_blocking_error` | ~42 | Hook execution errors. |
| `file` | ~36 | Attached file content. |
| `date_change` | ~28 | Day-boundary marker. |
| `compact_file_reference` | ~15 | Reference to a compacted context file. |
| `edited_text_file` | ~14 | File content after an edit. |
| `plan_mode` / `plan_mode_exit` | ~3 | Plan mode entry/exit markers. |

**Tool names observed** (from `tool_use` blocks, by call count):
`Bash` (1073), `Read` (973), `Edit` (804), `Write` (308), `Grep` (128), `Glob` (106), `PowerShell` (73), `TaskUpdate` (47), `TaskCreate` (30), `Agent` (26), `WebFetch` (13), `ToolSearch` (10), `Skill` (4), `EnterPlanMode` (1), `ExitPlanMode` (1).

---

## Pillar 1 — Observe

Deepen what `analyze.mjs` already extracts.

---

### W-OBS-01 — Skill invocation timeline
**What:** For each session, record a chronological list of skill invocations with exact timestamps and turn indices.

**Current state:** `session.skills[]` is a deduped flat array — no order, no timing. Derived by scanning `<command-name>` tags in user message text.

**Implementation:** Use `attachment/invoked_skills` records as the primary source. Each such attachment has an exact `timestamp` and `skills[].name`. Fall back to `<command-name>` scanning only for sessions that predate the `invoked_skills` attachment type.

**Target shape:**
```jsonc
"skill_timeline": [
  { "skill": "visualize-seed", "ts": "2026-05-05T10:03:12Z", "turn_index": 4, "source": "invoked_skills" },
  { "skill": "web-seo",        "ts": "2026-05-05T10:11:44Z", "turn_index": 9, "source": "invoked_skills" }
]
```

**Also extract:** `ai_title` from the `ai-title` record. More descriptive than `first_user_message` as a session label — surface it alongside `slug` in graph tooltips.

**Why:** Policy rules may care about invocation order or frequency within a session. The timeline also enables sequence analysis across sessions.

---

### W-OBS-02 — Tool-to-skill attribution
**What:** Associate tool calls with the skill invocation that preceded them.

**Implementation note:** Attribution must walk at **block level within turns**, not just turn boundaries. A single assistant turn can contain multiple `tool_use` blocks. Attribution logic: at each `attachment/invoked_skills` record, start a new attribution window; all subsequent `tool_use` blocks (across any number of assistant turns) belong to that skill until the next `invoked_skills` record or session end.

**Null-check requirement:** If `skill_timeline` is empty (no skills invoked), `skill_attribution` should be `{}`. Rules using `tools.contains` against attribution data must be skipped gracefully with an `INFO`-level diagnostic when attribution data wasn't collected, so misconfigured rules are visible rather than silently non-matching.

**Target shape:**
```jsonc
"skill_attribution": {
  "visualize-seed": { "tool_calls": 12, "tools": { "Read": 5, "Write": 4, "WebFetch": 3 }, "errors": 0 },
  "web-seo":        { "tool_calls": 7,  "tools": { "Read": 3, "Write": 4 },                 "errors": 1 }
}
```

**Why:** Enables detecting when a skill uses tools not declared in its `allowed-tools` frontmatter. A core signal for the policy engine.

---

### W-OBS-03 — Tool argument sampling
**What:** For `Read`, `Write`, `Edit` — record file path (already done in `file_ops`). For `Bash`/`PowerShell` — command category (already done in `bash_categories`, extend to cover `PowerShell`). New: for `WebFetch`/`WebSearch` — record domain only (strip path/query for privacy). For `Agent` sub-agent calls — record the `description` field from input.

**Also extract:** The `caller` field present on every `tool_use` block (observed in real JSONL). Surface in `tools` map as `{ calls, errors, caller_types: {} }`.

**Why:** Enables domain-level signals without recording sensitive URLs. Sub-agent descriptions enable policy rules on delegated work patterns.

---

### W-OBS-04 — Multi-harness readiness (Claude Code focus, schema-first)
**What:** Abstract the JSONL reader behind a clean internal interface so future harnesses can be added without touching the core analysis logic.

**Current state (2026-06):** ✅ **Largely implemented.** 
- `lib/normalized-record.mjs` and the adapter contract (`recordsToNormalized()`) exist.
- 4 harnesses supported via `adapters/claude-code.mjs`, `adapters/pi.mjs`, `adapters/antigravity.mjs`, `adapters/grok.mjs`.
- `lib/session-reducer.mjs` + `enrichSession` consume the common normalized stream.
- Dynamic discovery/routing via `lib/harness-registry.mjs` + `lib/scan-harnesses.mjs`.
- Live watch + targeted rebuilds work across harnesses (see `serve.mjs` + `processWatchFilename`).
- `lib/pulse-adapters.mjs` provides harness-dispatched live pulses.
- See `docs/harnesses.md` (self-growing matrix) and `lib/harness-registry.mjs` header for "easy hook-in" guidance.

The original "Phase 1 (now)" normalized record + "Phase 2 (future)" routing has been delivered in production form on this branch (with review fixes for correctness, isolation, and incremental paths). New harnesses add one adapter + registry entry + scanner.

**Why:** Avoids tight coupling between analysis logic and raw harness record shapes. The design proved robust enough to support real multi-harness use while addressing the 2026-06 code review findings.

---

### W-OBS-05 — Session intent classifier
**What:** Use `first_user_message` (already extracted, capped at 200 chars) to classify session intent: `coding` | `review` | `planning` | `debugging` | `writing` | `other`.

Simple keyword matching is sufficient — no LLM call needed.

**Note:** The 200-char cap in `analyzeSession` is sufficient for keyword matching but documents a known limit — the classifier sees only the first 200 characters of the first substantive user message.

**Why:** Intent is useful context for policy signals (e.g., "Bash tool used in a session classified as `writing` — unexpected").

---

### W-OBS-06 — Extract newly observed record types
**What:** Several record types visible in real JSONL are not yet extracted. Add to `analyzeSession`:

| Record | Field to extract | Shape |
|---|---|---|
| `ai-title` | `ai_title` | `string \| null` |
| `agent-name` | `agent_name` | `string \| null` — flags sub-agent sessions |
| `system/compact_boundary` | `compact_events[]` | `[{ trigger: "auto"\|"manual", pre_tokens, ts }]` |
| `system/api_error` | `api_errors` | `count of retried API errors` |
| `attachment/hook_non_blocking_error` | `hook_errors` | `count` |
| `attachment/task_reminder` | `max_active_tasks` | `max(itemCount)` across turns — proxy for task complexity |

**Current state (2026-06):** Partial / good progress.
- `ai_title`, `context_resets` (from compact_boundary), `subagent_count` (Agent/Task), `branches` are now extracted for claude-code + grok via the normalized pipeline and stored on sessions (see `lib/sessions-schema.mjs`, adapters, reducer, graph-pipeline passthrough).
- `agent_name` and richer `compact_events` details are not yet fully surfaced for all harnesses.
- These fields are now part of the canonical optional session contract and work across the multi-harness adapters.

**Why:** `ai_title` is a better session label. `agent_name` distinguishes sub-agent sessions from root sessions. `compact_events` enables policy rules about sessions that hit context limits. `api_errors` and `hook_errors` are observable failure signals not currently tracked. Much of the extraction infrastructure landed as part of the multi-harness refactor.

---

## Pillar 2 — Policy

Add rule evaluation on top of observed session data. **Output is signals, never blocks.**

---

### W-POL-01 — Policy file loader
**What:** Load and merge `.agents/policy.json` (project) and `~/.agents/policy.json` (global) — same schema used by kaaroSkills.

```jsonc
{
  "version": "1",
  "default": "allow",
  "rules": [
    {
      "id": "rule-id",
      "match": { "skill": "visualize-seed", "tools.contains": "Bash" },
      "signal": "WARN",
      "reason": "visualize-seed should not use Bash"
    }
  ]
}
```

**Signal levels:** `INFO` | `WARN` | `ALERT` | `ANOMALY`

Policy evaluation happens in `analyze.mjs` after `analyzeSession()` completes for each session. Rules are evaluated against the session's aggregated data — not turn-by-turn.

**Merge semantics:** identical to kaaroSkills `rc.js` — project rules prepend global rules.

---

### W-POL-02 — Signal evaluator
**What:** For each session, evaluate each policy rule against the session's observed data. Emit a signal for each matching rule. First matching rule wins.

**Match predicates (session-scoped):**
| Predicate | Matches when |
|---|---|
| `skill` | session.skills includes this skill |
| `tool` | session.tools[name] exists |
| `tools.contains` | skill X used tool Y (requires W-OBS-02; skip with INFO diagnostic if attribution missing) |
| `tool_errors.gt N` | session.tool_errors > N |
| `cache_hit_rate.lt N` | session.cache_hit_rate < N (%) |
| `duration_min.gt N` | session.duration_min > N |
| `project` | session.project_label matches |
| `intent` | session.intent (from W-OBS-05) matches |
| `agent_name.exists` | session was a named sub-agent (from W-OBS-06) |
| `compact_count.gt N` | session had > N compact_boundary events (from W-OBS-06) |
| `skill_not_registered` | skill not found in any kaaroSkills registry |
| `skill_version_mismatch` | local version ≠ registry version |

---

### W-POL-03 — Signal format
**What:** A signal is a structured record emitted when a policy rule matches.

```jsonc
{
  "ts":           "2026-05-05T10:03:12Z",  // analysis time, not session time
  "session_id":   "abc12345",
  "project_id":   "D--src-kaaroSkills",
  "project_label": "kaaroSkills",
  "session_ts":   "2026-05-04T09:00:00Z",  // when the session ran
  "rule_id":      "no-bash-in-visualize",
  "signal":       "WARN",
  "reason":       "visualize-seed used Bash (3 calls) — not in allowed-tools",
  "context": {
    "skill": "visualize-seed",
    "tool":  "Bash",
    "calls": 3
  }
}
```

`signals-data.json` is rebuilt on each analysis run (same as `sessions-data.json`). Signals are derived — always re-derivable from sessions + current policy. For durable audit history use W-REP-04's append-mode `audit.log`.

---

### W-POL-04 — kaaroSkills registry bridge
**What:** At analysis time, attempt to load kaaroSkills' cached registry manifests from `~/.agents/cache/*.json`. Use this to:
- Check whether each observed skill is registered (detect `local-only` skills)
- Compare local skill version (from SKILL.md frontmatter) against registry version
- Retrieve `allowed-tools` and `platforms` for rule evaluation

**Implementation:** Optional enhancement — if `~/.agents/cache/` is absent, skip silently. Do not network-fetch during analysis. If the cache format changes, fail gracefully with a warning rather than crashing analysis.

---

### W-POL-05 — Anomaly detection (heuristic signals)
**What:** Emit `ANOMALY` signals for statistically unusual patterns, without requiring explicit policy rules.

**Thresholds are configurable** via `policy.json` using a `"builtin_anomalies"` key. The values below are defaults — users override them without changing source code:

```jsonc
{
  "builtin_anomalies": {
    "high_error_rate":       { "threshold": 0.3,  "signal": "WARN"  },
    "skill_no_tools":        { "threshold": 0,    "signal": "INFO"  },
    "zero_cache_long":       { "min_duration": 10, "signal": "WARN" },
    "high_tool_diversity":   { "threshold": 8,    "signal": "INFO"  },
    "unregistered_skill":    { "signal": "ALERT" },
    "repeated_compaction":   { "threshold": 2,    "signal": "WARN"  }
  }
}
```

| Anomaly | Default threshold | Signal |
|---|---|---|
| High tool error rate | `tool_errors / tool_calls > 0.3` | WARN |
| Skill used but no tools called | `skill_attribution[skill].tool_calls === 0` | INFO |
| Zero cache hit rate on long session | `cache_hit_rate === 0 && duration_min > 10` | WARN |
| Very high tool diversity | `tool_diversity > 8` | INFO |
| Skill invoked but not in registry | (via W-POL-04) | ALERT |
| Session compacted more than N times | `compact_events.length > 2` (from W-OBS-06) | WARN |

Anomalies are emitted as signals with `rule_id: "anomaly:<type>"`.

---

## Pillar 3 — Report

Surface observed data and signals through the existing visualization and HTTP server.

---

### W-REP-01 — Signal overlay in graph
**What:** In `build.mjs`, annotate graph nodes (sessions and projects) with signal counts and highest severity level. In the graph visualization, render a visual indicator (ring color or badge) on nodes with signals.

**Node annotation:**
```jsonc
{
  "id":         "session:abc12345",
  "signals":    3,
  "max_signal": "ALERT",
  "signal_ids": ["no-bash-in-visualize", "anomaly:high-error-rate"]
}
```

---

### W-REP-02 — `/api/signals` HTTP endpoint
**What:** New route in `serve.mjs` that returns `signals-data.json`.

**Response shape:**
```jsonc
{
  "generated_at": "2026-05-05T10:00:00Z",
  "total_signals": 12,
  "by_level": { "INFO": 5, "WARN": 6, "ALERT": 1, "ANOMALY": 0 },
  "by_rule":  { "no-bash-in-visualize": 3, "anomaly:high-error-rate": 2 },
  "signals":  [ /* full signal objects */ ]
}
```

---

### W-REP-03a — Policy data endpoint
**What:** A `/api/policy` route in `serve.mjs` returning the active (merged) policy rules alongside their signal hit counts. Delivers the data layer before any UI work begins.

```jsonc
{
  "rules": [ { "id": "...", "signal": "WARN", "reason": "...", "hit_count": 3 } ],
  "anomaly_config": { /* active builtin_anomalies thresholds */ }
}
```

---

### W-REP-03b — Policy report page (`/policy`)
**What:** A `/policy` route in the web UI (separate HTML served by `serve.mjs`) showing:
- Active rules (from `/api/policy`) with signal counts per rule
- Sessions that triggered each rule (linked to session detail in the main graph)
- Timeline: signals over time

Depends on W-REP-03a being complete.

---

### W-REP-04 — Audit log export (kaaroSkills interop)
**What:** Append signals to `~/.agents/audit.log` in JSONL format during each analysis run. Compatible with kaaroSkills' audit schema, enabling a unified audit trail across both tools.

**Signal → audit entry mapping:**
```jsonc
{
  "ts":                  "<signal.ts>",
  "event":               "signal",
  "skill":               "<signal.context.skill>",
  "action":              "warn" | "alert" | "anomaly",
  "policyRulesMatched":  ["<signal.rule_id>"],
  "exitCode":            0
  // exitCode is always 0: kaaroSessions is post-hoc and never blocks execution
}
```

Command for one-off export: `node serve.mjs --export-audit > audit-export.jsonl`

---

### W-REP-05 — Alert hook
**What:** After analysis, if any `ALERT` or higher signals were emitted, call a configurable webhook URL with the signal payload.

Config in `.agents/kaaroRC`:
```jsonc
{
  "alerts": {
    "webhook": "https://hooks.slack.com/...",
    "minLevel": "ALERT"
  }
}
```

Optional, skipped silently if `alerts` is absent from config.

---

## Implementation Order

| Phase | Items | Delivers |
|---|---|---|
| 1 | W-OBS-01, W-OBS-02, W-OBS-06 | Skill timeline (via `invoked_skills`), block-level tool attribution, new session fields (`ai_title`, `agent_name`, `compact_events`, etc.) |
| 2 | W-POL-01, W-POL-02, W-POL-03 | Policy loader + signal evaluator + `signals-data.json` |
| 3 | W-REP-01, W-REP-02 | Signal overlay in graph + `/api/signals` endpoint |
| 4 | W-OBS-03, W-OBS-05 | Tool argument sampling + intent classifier |
| 5 | W-POL-04, W-POL-05 | Registry bridge + configurable anomaly heuristics |
| 6 | W-REP-03a, W-REP-03b, W-REP-04, W-REP-05 | Policy data endpoint + report page + audit export + alert hook |

**2026-06 update:** W-OBS-04 (multi-harness readiness + NormalizedRecord abstraction) has been delivered ahead of schedule as part of the `feat/multi-harness-tdd` work (adapters, registry, scan-harnesses, pulse-adapters, etc.). The core pipeline is now multi-harness native. Policy and Report pillars (beyond basic live pulses) remain the main future work. The original Phase 1 focus on `analyze.mjs` only has expanded to a full adapter-based architecture while preserving the observe-first philosophy.
