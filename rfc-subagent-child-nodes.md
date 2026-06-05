# RFC: Subagent Child Nodes
**Status:** Proposed
**Date:** 2026-06-05
**Relates to:** W-OBS-03 (tool argument sampling), W-OBS-06 (new record types)

---

## Summary

Claude Code sessions can spawn sub-agents via the `Agent` tool. Sub-agents write their own JSONL files into a `subagents/` subdirectory alongside the parent session file. Today `analyze.mjs` performs a flat directory scan and never enters `subagents/` — those files are invisible to the visualizer. This RFC proposes scanning subagent JSONL files, linking them to their parent session, and rendering them as **child nodes** in the graph.

---

## Problem Statement

When a session spawns a sub-agent (via the `Agent` tool), the agent's work is tracked in a separate JSONL file:

```
~/.claude/projects/<projectId>/
  <sessionId>.jsonl           ← parent session  (scanned today)
  <sessionId>/
    subagents/
      agent-<id>.jsonl        ← sub-agent       (invisible today)
      agent-<id>.jsonl
```

Sub-agent JSONL files are format-compatible with parent sessions (same record types: `user`, `assistant`, `tool_use`, `system/turn_duration`, etc.) plus three identifying fields:

```jsonc
{
  "isSidechain": true,
  "sessionId":   "4118cbd5-e5a5-4bd9-b109-ffa10219d844",  // parent session ID
  "agentId":     "a9fe230",                                 // short unique ID
  ...
}
```

### What is currently missing

From the modelDLC project (confirmed by manual inspection):

| Session | Sub-agents | Subagent JSONL size | Status |
|---|---|---|---|
| `4118cbd5` | 4 (`a7f84ba`, `a8adb97`, `a8da76a`, `a9fe230`) | ~365 KB total | Invisible |

The `agent-a9fe230.jsonl` alone is 354 KB — the largest file in the project — and contains tool calls, file reads/writes, and token usage that are entirely absent from the current graph.

### Impact

- **Token counts are understated.** Sub-agent token usage is not rolled into the parent or project summary.
- **File operations are missing.** Files touched exclusively by a sub-agent don't appear as file nodes.
- **Delegation depth is invisible.** No way to tell from the graph that a session used the `Agent` tool productively.
- **`agent-name` and `agent-color` records** (observed in real JSONL; see WISHLIST.md §JSONL schema reference) are extracted from sub-agent sessions but never surfaced.

---

## Existing signals already in the schema

`WISHLIST.md` notes two record types emitted by sub-agent sessions that are already observed in real JSONL:

| Record type | Field | Notes |
|---|---|---|
| `agent-name` | `agentName` | Set when a named sub-agent runs (13 observed) |
| `agent-color` | `agentColor` | Sub-agent UI colour (7 observed) |

These provide a `name` and `color` per subagent that can be used directly as node labels/colors in the graph.

The `Agent` tool is also already counted: 26 `tool_use` blocks with `name: "Agent"` are observed across the session corpus. The `input.description` field (W-OBS-03) is the human-readable task description passed to the sub-agent — valuable as a node label.

---

## Proposed Solution: Child Nodes

Add sub-agent sessions as **child nodes** in the graph, visually linked to their parent session node.

### Node types after this change

| `node.type` | Existing? | Description |
|---|---|---|
| `project` | yes | Project grouping node |
| `session` | yes | Root Claude Code / Pi session |
| `file` | yes | File touched in a session |
| `subagent` | **new** | Sub-agent spawned by a session |

### Edge types after this change

| `edge.type` | Existing? | Description |
|---|---|---|
| `membership` | yes | session → project |
| `branch` | yes | session → session (same git branch) |
| `write` / `edit` / `read` | yes | session/subagent → file |
| `spawned` | **new** | session → subagent (delegation link) |

### Visual treatment (proposal)

- Sub-agent nodes: smaller than session nodes, same project color, dashed border or inner ring.
- `spawned` edges: dashed line, directional arrow from parent to child.
- Tooltip on sub-agent node: `agentName` (if available), `agentId`, token count, tool call count, `Agent` tool `description` from parent's `tool_use` block.

---

## Implementation Plan

### 1. `analyze.mjs` — scan subagents directory

**Function to add:** `scanSubagents(projectId, sessionId, sessionDir)`

```
~/.claude/projects/<projectId>/<sessionId>/subagents/*.jsonl
```

Called from `scanClaudeCodeSessions` after analyzing each parent session. Sub-agent sessions are passed through `analyzeSession()` unchanged (format is identical). The result gets two extra fields before being pushed to `allSessions`:

```js
{
  ...analyzedSession,
  source:         'claude-code-subagent',   // new source value
  parent_session: sessionId,                 // back-reference
  agent_id:       agentId,                  // short ID from first record's agentId field
  agent_name:     agentName || null,         // from agent-name record (if present)
}
```

**Detection of `agentId` and `agentName`:** Read from the first JSONL record that contains `isSidechain: true` (carries `agentId`). `agentName` comes from the first `agent-name` type record in the file.

**No incremental update path** for subagents in this phase — on any `.jsonl` change in a session's `subagents/` dir, trigger a full session rebuild (same behavior as Pi today).

### 2. `lib/sessions-schema.mjs` — schema additions

New optional fields on session objects:

```js
// OPTIONAL_SESSION_FIELDS additions
'source',          // already exists: 'claude-code' | 'pi'
                   // new value: 'claude-code-subagent'
'parent_session',  // string | undefined — session_id of spawning session
'agent_id',        // string | undefined — short agent ID (e.g. "a9fe230")
'agent_name',      // string | null | undefined — from agent-name record
```

`validateSession()` gains a check: if `source === 'claude-code-subagent'` then `parent_session` must be present.

### 3. `lib/graph-pipeline.mjs` — new node + edge type

**`buildGraph(data, opts)`** changes:

- Subagent sessions (`source === 'claude-code-subagent'`) produce `type: 'subagent'` nodes instead of `type: 'session'` nodes.
- Node sizing: same formula as session nodes — `√(tokens_work / MAX_WORK)` — but capped at session node minimum size to keep them visually subordinate.
- New edge: for each subagent node, emit `{ source: parent_session_id, target: subagent_node_id, type: 'spawned' }`.
- Subagent nodes still produce `write` / `edit` / `read` edges to file nodes (file ops from sub-agents are tracked, potentially creating file nodes that didn't appear before).
- `stats` gains `subagent` count.

**`buildFileNodesAndEdges`** — no change needed; already operates on any session with `file_ops`.

### 4. `src/client/` — visualization

Changes confined to:

- **`01-data.js`** — `GRAPH.nodes` already contains all node types; no data-layer change needed.
- **`06-force-layout.js`** — give subagent nodes a stronger attraction to their parent session (higher link strength on `spawned` edges).
- **`11-layout-manager.js`** — add `subagent` to the node-type color/shape dispatch. Render as smaller circle with dashed stroke.

Tooltip additions (wherever session tooltips are rendered):
- If node is `subagent`: show `Agent task: <description>`, parent session slug, `agentName`.
- If node is `session` with subagent children: show "Spawned N sub-agents" with total delegated tokens.

### 5. `build.mjs` — stats output

Add `subagent` count to the console summary line:

```
Graph: 144 nodes (2 project · 6 session · 4 subagent · 132 file)
Edges: 192 (6 membership · 4 spawned · 6 branch · 47 write ...)
```

---

## Schema diff summary

```diff
// sessions-data.json — session object
  {
    "session_id":     "a9fe230...",
    "project_id":     "-Users-...-modelDLC",
+   "source":         "claude-code-subagent",
+   "parent_session": "4118cbd5-...",
+   "agent_id":       "a9fe230",
+   "agent_name":     "Explore agent",      // null if no agent-name record
    "tokens": { ... },
    "file_ops": { ... },
    ...
  }
```

All new fields are **optional** — `validateSession()` does not require them for `source: 'claude-code'` or `source: 'pi'` sessions. Backward compatibility is preserved.

---

## Test Plan

### Unit tests (`test/analyze-pi.test.mjs` pattern → new `test/analyze-subagent.test.mjs`)

- `parsesSubagentIdentifiers` — given a JSONL with `isSidechain: true` and `agentId`, extracts correct `agent_id` and `parent_session`.
- `extractsAgentName` — given an `agent-name` record, sets `agent_name`.
- `missingAgentNameIsNull` — session without `agent-name` record → `agent_name: null`.
- `subagentSourceField` — output has `source: 'claude-code-subagent'`.
- `subagentTokensRollup` — token counts from sub-agent JSONL are summed correctly.
- `subagentFileOps` — file ops in sub-agent JSONL appear in `file_ops`.

### Unit tests (`test/graph-pipeline.test.mjs`)

- `subagentNodeType` — session with `source: 'claude-code-subagent'` produces a `type: 'subagent'` node.
- `spawnedEdge` — subagent node produces a `spawned` edge to its `parent_session`.
- `subagentFileEdges` — file ops from subagent produce `read`/`write`/`edit` edges.
- `statsIncludesSubagentCount` — `stats.subagent` reflects correct count.
- `subagentWithNoParentInData` — if parent session was filtered out (e.g. `--project=` filter applied mid-session), subagent node is still rendered without a `spawned` edge (no crash).

### Schema tests (`test/schema.test.mjs`)

- `subagentSessionValid` — session with all new fields passes `validateSession`.
- `subagentMissingParent` — `source: 'claude-code-subagent'` without `parent_session` → validation error.
- `regularSessionUnchanged` — existing `claude-code` session without new fields still passes.

### Integration smoke test

```bash
node analyze.mjs
# expect: "[claude-code] ... 4118cbd5: 4 subagents" in output
node build.mjs --project=modelDLC
# expect: "Graph: ... 4 subagent ..."
```

---

## Out of scope for this RFC

- **Pi subagent support** — Pi session dirs don't currently have a `subagents/` convention. Add when Pi harness emits sub-agent files.
- **Merging subagent stats into parent** — the "merge" approach (alternative to child nodes). Tracked as a separate option in `open-feature-requests.md`.
- **Incremental update for subagent files** — full session rebuild on subagent change is sufficient for now.
- **Subagent nesting depth > 1** — sub-agents spawning further sub-agents. The JSONL `parentUuid` field (observed as `null` in current data) may track this in future.

---

## Open Questions

1. **Node placement** — should subagent nodes be force-attracted to their parent session only, or also to the project node? Attraction to both may cause visual crowding when a session has many subagents.

2. **Project token rollup** — should `project.tokens` include subagent tokens? Currently project summaries are built from `sessions[]` via `buildProjectSummary`. If subagent sessions are included in `sessions[]`, they will be double-counted (subagent tokens are already part of the parent session's token stream). **Decision needed before implementing `buildProjectSummary` changes.**

3. **`--min-sessions` filter** — file nodes that appear only in subagent sessions should count toward the `minSessions` threshold the same as any other session. No special case needed.

4. **`agent_name` extraction** — the `agent-name` record type has 13 observations in the full corpus but 0 in the modelDLC subagent files. Confirm whether `agentId` (from `isSidechain` record) is always sufficient as a fallback label before relying on `agent_name`.
