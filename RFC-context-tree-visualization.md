# RFC: Context Tree Visualization

**Project:** kaaroSessions  
**Status:** Draft  
**Date:** 2026-06-07  
**Author:** Kartik Arora  

---

## 1. Problem

The current graph view (force-directed: projects → sessions → files) answers **what** was worked on across sessions. It does not answer **how** a single session unfolded.

A Claude Code session is not a flat timeline. It is a tree:

- A session may be interrupted and resumed across multiple context windows (compact events)
- A session may spawn subagent child sessions via the `Agent` tool
- Each subagent may itself spawn further subagents
- Permission modes change mid-session, altering what the agent can do
- Git branches change mid-session, pointing at different codebases

The current graph collapses all of this into a single node. The RFC proposes a new view: **the context tree** — a full reconstruction of a session's branching structure, rendered as a navigable interface.

---

## 2. Ground Truth: f1d13aab

This RFC was designed from a real session trace.

**Session:** `f1d13aab-26a0-41fd-ae00-4b151d3968b0`  
**Project:** `D--src-kaaroViewer`  
**Span:** 2026-05-16T12:23 → 2026-05-23T08:26 (7 days)  
**Slug:** `temporal-puzzling-feigenbaum`

| Dimension | Observed |
|---|---|
| Branches | `kaaro/paint` → `master` → `kaaro/visualize-discoverability` |
| Permission modes | `default` → `plan` → `acceptEdits` |
| Context resets | 2 compact_boundary events |
| Subagents spawned | 5 (ae2d458d, a4ddeeeb, a0ae854b, a7d2d3ef, a2bada1051) |
| Tool calls | Read×78, Bash×58, Edit×35, Grep×14, Agent×11, Write×8, ToolSearch×6, Glob×6, TaskCreate×3, TaskUpdate×5 |
| Tokens | in=20,928 · out=413,877 · cache_create=3.64M · cache_read=37.5M |

---

## 3. The Context Tree Model

A session produces this logical structure:

```
Session (f1d13aab)
├── Segment 0  [default mode, kaaro/paint]  turns 0..N
│   ├── Turn 0:  USER "code review"
│   ├── Turn 1:  ASST  Bash, Bash, Read → end_turn  (2m 18s)
│   └── ...
│
├── ── compact_boundary (auto, pre_tokens ~84k) ──
│
├── Segment 1  [default → plan mode, kaaro/paint]  turns N+1..M
│   ├── Turn N+1:  USER "Let's plan for bug fixes..."
│   ├── Turn N+2:  ASST  EnterPlanMode, Agent×3
│   │              ├── Subagent: ae2d458d  (explore codebase)
│   │              │   └── turns...
│   │              ├── Subagent: a4ddeeeb  (explore tests)
│   │              │   └── turns...
│   │              └── Subagent: a0ae854b  (explore structure)
│   │                  └── turns...
│   └── ...
│
├── ── compact_boundary (auto) ──
│
└── Segment 2  [acceptEdits mode, master]  turns M+1..end
    ├── Turn M+1:  USER "Handoff Phase 3"
    ├── Turn M+2:  ASST  Agent×5  (parallel TDD work packages)
    │              ├── Subagent: a7d2d3ef
    │              └── Subagent: a2bada1051
    └── Turn end:  ASST  Bash (git push)  → end_turn
```

### 3.1 Entities

| Entity | Definition | Source in JSONL |
|---|---|---|
| **Session** | One JSONL file; root of the tree | filename (UUID) |
| **Segment** | Turns between compact_boundary events | `system/compact_boundary` records |
| **Turn** | One user→assistant→tool_results cycle | consecutive user + assistant records |
| **Tool Call** | One `tool_use` block in an assistant turn | `assistant.message.content[].type == "tool_use"` |
| **Subagent** | Child JSONL file under `subagents/` | `tool_use` name=Agent in parent + task-notification in user content |
| **Permission Region** | Turns within a given permission mode | `permission-mode` records |
| **Branch Region** | Turns with the same `gitBranch` | `user.gitBranch` or `system.gitBranch` |

---

## 4. Data Model

### 4.1 ContextTree (top-level)

```jsonc
{
  "session_id":       "f1d13aab",
  "project":          "D--src-kaaroViewer",
  "project_label":    "kaaroViewer",
  "ai_title":         "kaaroViewer code review, bug fixes, and TDD refactor",
  "slug":             "temporal-puzzling-feigenbaum",
  "ts_start":         "2026-05-16T12:23:21Z",
  "ts_end":           "2026-05-23T08:26:09Z",
  "duration_ms":      594528000,
  "branches":         ["kaaro/paint", "master", "kaaro/visualize-discoverability"],
  "permission_modes": ["default", "plan", "acceptEdits"],
  "context_resets":   2,
  "segments":         [ /* Segment[] */ ],
  "subagents":        [ /* SubagentRef[] */ ],
  "totals": {
    "turns":          227,
    "tool_calls":     235,
    "tool_errors":    0,
    "input_tokens":   20928,
    "output_tokens":  413877,
    "cache_create":   3639621,
    "cache_read":     37515227
  }
}
```

### 4.2 Segment

```jsonc
{
  "index":            0,
  "ts_start":         "2026-05-16T12:23:21Z",
  "ts_end":           "2026-05-16T18:47:33Z",
  "turn_range":       [0, 18],
  "compact_trigger":  "auto",          // "auto" | "manual" | null (last segment)
  "pre_tokens":       84000,           // tokens at compact time; null if last segment
  "permission_modes": ["default"],
  "branches":         ["kaaro/paint"],
  "turns":            [ /* Turn[] */ ]
}
```

### 4.3 Turn

```jsonc
{
  "index":            0,
  "segment":          0,
  "ts":               "2026-05-16T12:26:42Z",
  "duration_ms":      136367,
  "permission_mode":  "default",
  "git_branch":       "kaaro/paint",
  "actor":            "user",           // "user" | "assistant" | "system"
  "text":             "Let's do a code review of the changes from this branch to master.",
  "tool_calls": [
    {
      "id":            "tu_01",
      "name":          "Bash",
      "input_summary": "git diff master...",
      "is_error":      false,
      "spawns_subagent": null
    }
  ],
  "tool_results": [
    { "tool_use_id": "tu_01", "is_error": false }
  ],
  "usage": {
    "input":        8420,
    "output":       312,
    "cache_create": 6100,
    "cache_read":   0
  },
  "has_thinking":     true,
  "stop_reason":      "tool_use",
  "spawned_subagents": []              // task IDs spawned by Agent calls in this turn
}
```

### 4.4 SubagentRef

```jsonc
{
  "task_id":          "ae2d458d533a32b59",
  "short_id":         "ae2d458d",
  "agent_name":       null,           // from agent-name record, if set
  "agent_color":      null,           // from agent-color record, if set
  "spawned_at_turn":  42,
  "spawned_at_segment": 1,
  "description":      "Explore codebase structure and test coverage",
  "ts_start":         "2026-05-17T18:48:27Z",
  "ts_end":           "2026-05-17T18:57:27Z",
  "jsonl_path":       "subagents/agent-ae2d458d533a32b59.jsonl",
  "tree":             { /* recursive ContextTree */ }
}
```

---

## 5. Reconstruction Algorithm

```
reconstruct(session_id, project_path):

  1. Load parent JSONL line-by-line → records[]

  2. Walk records in order:
     - On permission-mode  → open a new permission region
     - On user             → start a new turn (or append tool_results to current turn)
     - On assistant        → complete turn; extract tool_calls, usage, thinking flag
                             For each tool_use where name=Agent:
                               note task description; mark turn as spawning a subagent
     - On system/turn_duration → close turn with durationMs
     - On system/compact_boundary → close current segment; open next segment
     - On attachment/invoked_skills → annotate preceding turn with skill names
     - On ai-title         → set session ai_title

  3. Detect subagent linkage:
     - Scan user content for <task-notification> tags → extract task_id
     - Match task_id to tool_use id in parent turns → link spawn turn to subagent
     - For each subagent: load subagents/<task_id>.jsonl → recurse reconstruct()

  4. Build ContextTree from segments + subagents

  5. Compute totals (sum across all segments + all subagent trees)
```

**Key invariant:** Every subagent is reachable from the parent tree by following `spawned_subagents` → `SubagentRef.tree`. The tree is self-contained — no external lookups needed after JSONL files are loaded.

---

## 6. New API Endpoint

```
GET /api/trace/:session_id
```

**Response:** `ContextTree` JSON (as defined in §4.1)

**Server implementation** (`serve.mjs`):
- On request: locate `<session_id>.jsonl` in any project folder under `~/.claude/projects/`
- Run `reconstruct()` → return JSON
- Cache in memory; invalidate when the JSONL file's mtime changes

**Discovery:** If `session_id` is a UUID prefix (first 8 chars), resolve to the matching full filename.

---

## 7. Visualization

### 7.1 Entry Point

From the existing graph: clicking a session node opens `/trace/<session_id>` in a panel or new page.

### 7.2 Two Views

**A — Segment Timeline (default)**

Horizontal. Each segment is a lane. Turns are columns within the lane. Compact boundaries are hard breaks between lanes.

```
Segment 0 [default · kaaro/paint]
│ Turn 0 │ Turn 1 │ Turn 2 │ ... │
───────────────── compact ─────────────────
Segment 1 [default→plan · kaaro/paint]
│ Turn 19 │ Turn 20 ┬ Agent×3 │ ...  │
           │ ↓ ae2d458d │ ↓ a4ddeeeb │ ↓ a0ae854b │
           └── (collapsed subagent timelines) ──────
───────────────── compact ─────────────────
Segment 2 [acceptEdits · master]
│ Turn 38 │ Turn 39 ┬ Agent×5 │ ... │
```

Each turn card shows:
- Actor icon + timestamp
- Tool call chips (Bash, Read, Edit...)
- Token bar (output tokens, color-coded by cache_read ratio)
- Thinking indicator dot
- Duration label

**B — Tree View**

Vertical collapsible tree. Root = session. Children = segments. Grandchildren = turns. Subagents appear as subtrees branching from the spawning turn.

### 7.3 Visual Encoding

| Signal | Encoding |
|---|---|
| Permission mode | Background color per segment region (default=gray, plan=blue, acceptEdits=amber) |
| Git branch change | Thin vertical rule with branch label |
| Compact boundary | Double horizontal rule + "context reset" label + pre_tokens count |
| Subagent spawn | Downward arrow from parent turn → child timeline below |
| Token usage | Bar below turn card; stack = output / cache_create / cache_read |
| Tool error | Red chip on tool call |
| Thinking | Small pulsing dot on assistant turn |
| Context reset (compact) | Grey overlay + "summary injected" label |

---

## 8. Relation to WISHLIST.md

This RFC extends the Observe pillar without conflicting with the Policy/Report pipeline.

| WISHLIST item | Relation |
|---|---|
| W-OBS-01 (skill timeline) | Skill invocations annotate specific turns in the tree |
| W-OBS-02 (tool-to-skill attribution) | Attribution is richer when scoped to turn + segment |
| W-OBS-06 (compact_boundary extraction) | This RFC consumes compact_boundary as segment delimiters |
| W-REP-01 (signal overlay) | Signals from Policy can annotate turn nodes in the tree view |
| W-POL-05 (anomaly detection) | Anomalies like "zero cache on long session" are visible as turn-level overlays |

The `ContextTree` data model from this RFC can serve as the richer input for future policy rules that need turn-level or segment-level context (e.g., "ALERT if subagent depth > 2").

---

## 9. Open Questions

1. **Subagent depth limit** — how deep can subagent trees recurse in practice? Observed max in f1d13aab: 1 level. The model handles N levels but the UI may need a depth cap for rendering.

2. **Cross-day session identity** — f1d13aab spans 7 days. The `ts_start`/`ts_end` gap is real (idle time, not active). The UI should distinguish "session duration" from "active compute time" (sum of turn `duration_ms`).

3. **Compact summary content** — `system/compact_boundary` marks where a context reset happened but doesn't include the summary text itself. The summary is injected as a `user` system message at the start of the next segment (the "This session is being continued..." message). Should the tree surface this summary text as a segment annotation?

4. **Multi-project sessions** — a session can change `cwd` mid-session (observed: `kaaro/paint` branch on `D:\src\kaaroViewer` the whole time, but branch changes suggest different codebases). Detect and annotate `cwd` changes as region boundaries.

5. **Privacy** — subagent JSONL files may contain tool results with file contents. The `/api/trace` endpoint must strip `tool_result.content` by default; add a `?include_content=true` flag for local dev use only.

---

## 10. Implementation Order

| Phase | Deliverable |
|---|---|
| 1 | `reconstruct()` function: parent JSONL → ContextTree JSON (no subagents) |
| 2 | Subagent loading: recurse into `subagents/` directory, link to parent turns |
| 3 | `/api/trace/:session_id` endpoint in `serve.mjs` |
| 4 | Segment Timeline view (A) — static HTML + D3 |
| 5 | Tree View (B) — collapsible D3 tree |
| 6 | Integration: session node click in existing graph → opens `/trace/` panel |
