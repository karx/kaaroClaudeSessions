# analyze.mjs — Intelligence Report

A complete map of how raw Claude Code session logs become structured graph data.

---

## 1. Pipeline Overview

```
~/.claude/projects/
│
├── <projectId-A>/
│   ├── <sessionId-1>.jsonl   ←─ one session per file
│   ├── <sessionId-2>.jsonl
│   └── ...
│
└── <projectId-B>/
    └── ...
         │
         ▼
    parseJsonlFile()           reads file → splits on \n → JSON.parse each line
         │
         ▼
    analyzeSession()           one JSONL file → one session object
         │
         ├── enrichSession()   adds derived fields (cache_hit_rate, tool_diversity, …)
         │
         ▼
    buildProjectSummary()      N sessions → one project rollup (per project)
         │
         ▼
    buildGlobalRollup()        all sessions → cross-project aggregates
         │
         ▼
    sessions-data.json         { meta, projects[], sessions[], rollup }
```

---

## 1b. Architecture Note — Ground Truth from Raw JSONL (all harnesses)

The canonical data flow (updated for multi-harness):

```
Raw harness JSONL (source of truth)
  CC: assistant/user/system records + content[] blocks
  Pi: type=message role=user|assistant + usage
  Antigravity: USER_INPUT / PLANNER_RESPONSE etc.
  Grok: agent_*_chunk, tool_call updates on updates.jsonl
          │
          ▼  (harness-specific knowledge lives ONLY here)
  adapters/<harness>.mjs  recordsToNormalized()  → small common vocabulary of NormalizedRecord
          kinds: user_turn | assistant_turn | content_block | tool_use | tool_result | tokens | context_reset | session_meta | ...
          │
          ▼  (reducer owns aggregation rules that build the model the visual layer consumes)
  lib/session-reducer.mjs + enrichSession()
          → canonical Session { assistant_turns, content_blocks, message_count (prefer metadata), ... }
          │
          ├──▶ pulses / live (pulse-adapters.mjs) — independent, for SSE tool_call/tokens/words + beat overlay
          │
          ├──▶ graph / sessions-data (buildSessionsOutput + graph-pipeline) — main node/edge/timeline model
          │
          └──▶ trace / thread UI (/api/trace + reconstructContextTree*) — walks raw records again for rich per-segment detail (pendingAsst, tool results, etc.)
```

**Contract**: Adapters are the only place that understand a harness's raw JSONL shapes. Everything downstream (reducer, pulses, graph builder, context trees, UI) works on the normalized kinds or the final Session shape. Adding a new harness = one adapter (recordsToNormalized) + registry entry + scanner (optional context-tree variant only for trace).

This note makes the ontology explicit so future harness authors and UI work have one obvious mental model.

---

## 2. JSONL Record Type Catalog (CC historical)

Each line in a `.jsonl` file is one of these record types. The `analyzeSession` loop
dispatches on `rec.type`.

| `rec.type` | `rec.subtype` | What it carries | Used for |
|---|---|---|---|
| `system` | `turn_duration` | `durationMs`, `messageCount`, `slug`, `version`, `entrypoint`, `gitBranch`, `cwd` | Session metadata |
| `permission-mode` | — | `permissionMode` | Permission level |
| `user` | — | `message.content` (text or block array), `version`, `entrypoint`, `gitBranch`, `cwd` | User turns, skills, first message, tool errors |
| `assistant` | — | `message.model`, `message.usage`, `message.stop_reason`, `message.content` (blocks) | Tokens, tool calls, file ops |
| *(others)* | — | — | Ignored |

### Assistant content block subtypes

Within an `assistant` record's `message.content` array:

| `block.type` | Tracked as | Extra extraction |
|---|---|---|
| `tool_use` | `content_blocks.tool_use++`, `tool_calls++` | name → `tools` map; file_path → `file_ops`; command → `bash_categories` |
| `text` | `content_blocks.text++` | — |
| `thinking` | `content_blocks.thinking++` | — |
| *(anything else)* | `content_blocks[type]++` | — |

### User content block subtypes

Within a `user` record's `message.content` array:

| `block.type` | Action |
|---|---|
| `tool_result` with `is_error: true` | `tool_errors++` |
| `text` | joined for first_user_message extraction and skill scanning |

---

## 3. Session Object — Field Derivation Map

### Identity & metadata (set once, first-wins)

| Session field | Source | Rule |
|---|---|---|
| `session_id` | filename | `path.basename(filePath, '.jsonl')` |
| `project_id` | directory name | passed in from walker |
| `project_label` | `project_id` | `deriveLabel(projectId)` |
| `file_size_bytes` | `parseJsonlFile()` | `Buffer.byteLength(raw, 'utf8')` |
| `slug` | `system/turn_duration.slug` | fallback: `session_id.slice(0,8)` |
| `version` | `system/turn_duration.version` → `user.version` | first-wins |
| `entrypoint` | `system/turn_duration.entrypoint` → `user.entrypoint` | first-wins |
| `git_branch` | `system/turn_duration.gitBranch` → `user.gitBranch` | first-wins |
| `cwd` | `system/turn_duration.cwd` → `user.cwd` | first-wins |
| `duration_ms` | `system/turn_duration.durationMs` | last-wins (overwritten each turn_duration) |
| `message_count` | `system/turn_duration.messageCount` | last-wins |
| `permission_mode` | `permission-mode.permissionMode` | last-wins |
| `model` | `assistant.message.model` | first-wins |

### Timestamps

| Session field | Source | Rule |
|---|---|---|
| `first_timestamp` | any `rec.timestamp` | running min across all records |
| `last_timestamp` | any `rec.timestamp` | running max across all records |

### Counters (accumulated across all records)

| Session field | Incremented by |
|---|---|
| `user_turns` | each `user` record with `message` |
| `assistant_turns` | each `assistant` record with `message` |
| `tool_calls` | each `tool_use` block in any assistant turn |
| `tool_errors` | each `tool_result` block in user turns where `is_error === true` |

### Token buckets (summed across all assistant records)

| Session field | Source field in `message.usage` |
|---|---|
| `tokens.input` | `input_tokens` |
| `tokens.cache_create` | `cache_creation_input_tokens` |
| `tokens.cache_read` | `cache_read_input_tokens` |
| `tokens.output` | `output_tokens` |

### Maps (built up across all records)

| Session field | Key | Value | Built from |
|---|---|---|---|
| `tools` | tool name | `{ calls: N, errors: N }` | each `tool_use` block |
| `file_ops` | normalised file path | `{ read: N, write: N, edit: N }` | `Read`/`Write`/`Edit` tool calls |
| `bash_categories` | category string | count | `Bash` tool calls |
| `content_blocks` | block type string | count | all blocks in assistant turns |
| `stop_reasons` | stop reason string | count | `assistant.message.stop_reason` |

### Arrays (deduplicated, built from user turns)

| Session field | Source | Filter |
|---|---|---|
| `skills` | `<command-name>` tags in user text | name NOT in `BUILTIN_COMMANDS` |
| `builtin_commands` | `<command-name>` tags in user text | name IS in `BUILTIN_COMMANDS` |

### First user message extraction

```
for each user record:
  extract text from message.content
  strip all XML-like tags  (<foo>...</foo>  and  <foo/>)
  collapse whitespace
  if len >= 8
    AND does not start with "Base directory for this skill"
    AND does not start with "Caveat:"
  → take first 200 chars → session.first_user_message
  → stop (first match wins)
```

### Tool timeline

After the main loop, `extractToolTimeline(records)` produces a second pass:

```
for each assistant record (in order):
  turn++
  for each tool_use block:
    emit { ts, turn, name, where, why }

  where = file_path          for Read / Write / Edit
        = command[0..120]    for Bash / PowerShell
        = pattern            for Grep / Glob
        = null               otherwise

  why   = input.description  if present
        = null               otherwise
```

---

## 4. `enrichSession()` — Derived Fields

Called once after the main loop. Mutates the session object in place.

```
tokens.total     = input + cache_create + cache_read + output

inputSide        = input + cache_create + cache_read
cache_hit_rate   = (cache_read / inputSide * 100).toFixed(1)   [0 if inputSide = 0]

duration_min     = (duration_ms / 60000).toFixed(1)            [null if duration_ms is null]

tool_diversity   = Object.keys(tools).length                   [unique tool names used]

─── from first_timestamp (UTC) ───────────────────────
day_of_week      = 0 (Sun) … 6 (Sat)
hour_of_day      = 0 … 23
date_str         = first_timestamp.slice(0, 10)                "YYYY-MM-DD"
```

---

## 5. `categorizeBash()` — Decision Tree

Input: raw command string (after `trimStart()`).

```
starts with "git "     → "git"
starts with "npm "     → "npm"
starts with "npx "     → "npx"
starts with "node "    → "node"
starts with "py "
  or "python"          → "python"
matches /^(ls|cat|head|tail|mkdir|rm |cp |mv )/
                       → "fs"
starts with "curl "    → "curl"
─────────────────────────────
else                   → "other"
```

Note: rules are evaluated top-to-bottom, first match wins.
`null` / falsy input falls through to "other".

---

## 6. `BUILTIN_COMMANDS` — The Dividing Line

Skills extracted from `<command-name>` tags are split into two buckets:

```
BUILTIN_COMMANDS = {
  exit, clear, compact, context, model, help, voice,
  plan, fast, config, review, memory, doctor, status,
  rate-limit-options, mcp, cost, log
}

  name in BUILTIN_COMMANDS → session.builtin_commands[]
  name not in set          → session.skills[]
```

Both arrays are deduplicated (no repeated entries per session).

---

## 7. `deriveLabel()` — Project ID → Human Label

Transforms a Claude Code path-slug into a short display name.

```
"D--src-kaaroViewer"        →  "kaaroViewer"
"D--src-karx-github-io"     →  "karx-github-io"
"C--Users-karx0-foo"        →  "foo"
"my-project"                →  "my-project"   (no match, returned as-is)

Rule 1: strip leading  /^[A-Za-z]--src-/
Rule 2: strip leading  /^[A-Za-z]--Users-[^-]+-/
```

---

## 8. `normPath()` — Path Normalisation

Used before storing any file path in `file_ops`.

```
null / non-string            → null
whitespace-only              → null
backslash → forward slash    C:\foo\bar → C:/foo/bar
double slash collapse        //foo//bar → /foo/bar
trim whitespace
empty after trim             → null
```

---

## 9. Output: `sessions-data.json` Schema

```
{
  meta: {
    generated_at:   ISO timestamp     ← when analyze.mjs ran
    source_dir:     string            ← ~/.claude/projects path
    total_sessions: number
    total_projects: number
    date_range: { first, last }       ← ISO timestamps from session data
  },

  projects: [                         ← one per project directory
    {
      id, label, session_count,
      tokens: { input, cache_create, cache_read, output },
      tool_calls, tool_errors,
      skills[],                       ← union across sessions, sorted
      builtin_commands[],             ← union across sessions, sorted
      models: { modelId: count },
      git_branches[],                 ← union across sessions, sorted
      total_bytes, duration_ms,
    }
  ],

  sessions: [                         ← one per .jsonl file, sorted by first_timestamp
    {
      session_id, project_id, project_label, file_size_bytes,
      first_timestamp, last_timestamp,
      slug, duration_ms, duration_min, message_count,
      version, entrypoint, git_branch, cwd, permission_mode, model,
      user_turns, assistant_turns, tool_calls, tool_errors,
      tokens: { input, cache_create, cache_read, output, total },
      cache_hit_rate,                 ← %
      tool_diversity,                 ← unique tool count
      day_of_week, hour_of_day, date_str,
      tools:           { name: { calls, errors } },
      file_ops:        { normPath: { read, write, edit } },
      bash_categories: { category: count },
      content_blocks:  { type: count },
      stop_reasons:    { reason: count },
      skills[],
      builtin_commands[],
      first_user_message,             ← up to 200 chars, null if none
      tool_timeline: [                ← ordered tool call log
        { ts, turn, name, where, why }
      ],
    }
  ],

  rollup: {
    tools:  [{ name, calls, errors }]      ← sorted by calls desc
    skills: [{ name, count }]              ← sorted by count desc
    models: { modelId: count }
    tokens: { input, cache_create, cache_read, output }
    total_errors: number
    files: [                               ← sorted by (write+edit+read) desc
      { path, read, write, edit, sessions: [sessionId] }
    ]
  }
}
```

---

## 10. Incremental Update Path

`serve.mjs` can re-analyze a single session without a full scan using `--session=<projectId>/<sessionId>`.

```
parseSessionFlag(argv)
  → { projectId, sessionId }

analyzeSession(projectId, filePath)
  → updatedSession

mergeSessionIntoData(existingData, updatedSession)
  → replaces matching session in sessions[]
  → rebuilds project summary for that project only
  → rebuilds full global rollup
  → updates meta.total_sessions / total_projects
```

Full scan (`fullScan()`) is the fallback when no `--session` arg is given or when
`sessions-data.json` does not yet exist.

---

## 12. Sub-agent Session Storage (Current Gap)

When Claude Code spawns sub-agents via the `Agent` tool, the resulting sessions are **not** stored as top-level JSONL files in the project directory. Instead they nest two levels deep:

```
~/.claude/projects/<projectId>/
├── <parent-uuid>.jsonl                        ← main session (picked up by analyze.mjs)
└── <parent-uuid>/                             ← sibling directory (ignored by walker)
    ├── subagents/
    │   ├── agent-<id>.jsonl                   ← sub-agent session (MISSED)
    │   └── agent-<id>.meta.json               ← sub-agent metadata (MISSED)
    └── tool-results/
        └── <id>.txt                           ← serialised tool results (MISSED)
```

### Sub-agent meta.json schema

```json
{ "agentType": "general-purpose", "description": "Short description passed to Agent tool" }
```

### Sub-agent JSONL — extra top-level fields vs main sessions

| Field | Meaning |
|---|---|
| `agentId` | Unique identifier for this sub-agent invocation |
| `attributionAgent` | Links back to parent agent context |

All other record types (`user`, `assistant`, tool calls, etc.) follow the same schema as main sessions.

### How the parent session records Agent tool calls

In the parent JSONL, each `Agent` spawn appears as a `tool_use` block in an `assistant` record:

```json
{
  "type": "tool_use",
  "name": "Agent",
  "input": {
    "description": "Short task description",
    "subagent_type": "general-purpose",
    "prompt": "Full prompt text (can be very large)"
  }
}
```

What `analyze.mjs` currently captures from the parent session:
- `tools['Agent'] = { calls: N, errors: N }` — counted like any tool ✓
- `tool_calls` counter incremented ✓
- `tool_timeline` entry: `{ name: 'Agent', why: input.description, where: null }` ✓
- `input.subagent_type` — **silently dropped** ✗
- No link to the sub-agent's session JSONL ✗

### Why sub-agent sessions are missed

`fullScan()` uses `fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl'))`, which reads only the immediate children of the project directory. The sibling directory `<parent-uuid>/` is a directory (not a `.jsonl` file) and is skipped by the filter. Sub-agent JSONewlines are never reached.

### Ignored record types (all sessions)

Beyond the sub-agent gap, these record types appear in JSONL files but are not parsed:

| `rec.type` | What it carries |
|---|---|
| `ai-title` | Auto-generated session title |
| `last-prompt` | Snapshot of the last user prompt |
| `file-history-snapshot` | File state snapshots for context |
| `queue-operation` | Internal orchestration events |
| `attachment` | File/image attachments in user turns |

---

## 11. Key Invariants

- **File paths are always normalised** before storage: backslashes → forward slashes, double slashes collapsed.
- **Skills are per-session deduplicated**: a skill seen twice in one session appears once.
- **Token fields are always numbers ≥ 0**: the `|| 0` fallback guards against missing `usage` fields.
- **`first_timestamp` / `last_timestamp` track all records**, not just user/assistant — including system and permission-mode records.
- **`slug` falls back to first 8 chars of `session_id`** if the `turn_duration` system record never appears.
- **`cache_hit_rate` denominator excludes `output`** — it measures how much of the input side was served from cache.
- **Project colors are assigned alphabetically** by `project_id` in the build step, not in analyze — `sessions-data.json` carries no color data.
