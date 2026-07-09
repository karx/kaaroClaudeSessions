# Google Antigravity Coding Agent — Adapter Findings

**Surveyed:** 2026-06-07  
**Corpus:** 7 sessions with `.system_generated` directories (35 total conversation dirs)  
**Brain root:** `C:\Users\karx0\.gemini\antigravity\brain\`  
**Agent:** Google Antigravity coding agent

---

## Session directory layout

```
~/.gemini/antigravity/
  brain/
    <conversationId>/                       ← one UUID per conversation
      .system_generated/
        logs/
          transcript.jsonl                  ← full record log (active sessions only)
          overview.txt                      ← compact record log (all sessions)
        messages/
        tasks/
          <task-id>.log
      <artifact>.md                         ← artifacts written by agent
      <artifact>.md.metadata.json
```

**File preference:** `transcript.jsonl` is preferred (richer, always-appended during session).
`overview.txt` is the fallback (compact form of the same JSONL records, space-saving).
Both use identical record schemas.

---

## JSONL Record types

| `type` | `source` | Count (c7f6b422 session) | Notes |
|---|---|---|---|
| `USER_INPUT` | `USER_EXPLICIT` | 2 | User turn; `content` holds full XML-tagged message |
| `CONVERSATION_HISTORY` | `SYSTEM` | 2 | History reload marker — skip |
| `PLANNER_RESPONSE` | `MODEL` | 34 | Model turn; `content` (text) + `tool_calls[]` |
| `LIST_DIRECTORY` | `MODEL` | 5 | Tool result for `list_dir` |
| `VIEW_FILE` | `MODEL` | 12 | Tool result for `view_file` |
| `GREP_SEARCH` | `MODEL` | 2 | Tool result for `grep_search` |
| `RUN_COMMAND` | `MODEL` | 13 | Tool result for `run_command` |
| `SYSTEM_MESSAGE` | `SYSTEM` | 1 | Background notifications — skip for stats |
| `GENERIC` | various | 1 | Catch-all — skip |

---

## Record shapes

### `USER_INPUT` — user turn
```jsonc
{
  "step_index": 0,
  "source": "USER_EXPLICIT",
  "type": "USER_INPUT",
  "status": "DONE",
  "created_at": "2026-06-07T00:15:33Z",
  "content": "<USER_REQUEST>\nDo the thing\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: ...\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.5 Flash (Medium). No need to comment on this change.\n</USER_SETTINGS_CHANGE>"
}
```

### `PLANNER_RESPONSE` — model turn (with tool calls)
```jsonc
{
  "step_index": 2,
  "source": "MODEL",
  "type": "PLANNER_RESPONSE",
  "status": "DONE",
  "created_at": "2026-06-07T00:15:34Z",
  "content": "I will list the files in the project workspace.",
  "tool_calls": [
    {
      "name": "list_dir",
      "args": {
        "DirectoryPath": "\"C:\\\\Users\\\\karx0\\\\...\"",
        "toolAction": "\"Listing workspace directory\"",
        "toolSummary": "\"Listing files in workspace\""
      }
    }
  ]
}
```

### Tool result records (VIEW_FILE, RUN_COMMAND, etc.)
```jsonc
{
  "step_index": 3,
  "source": "MODEL",
  "type": "VIEW_FILE",
  "status": "DONE",   // or "ERROR" for failed tool calls
  "created_at": "2026-06-07T00:15:40Z",
  "content": "File Path: ...\nTotal Lines: 59\n..."
}
```

---

## Critical: Arg value encoding

Tool call args are JSON-stringified values within the JSON record:

```
args.DirectoryPath = '"C:\\\\Users\\\\karx0\\\\..."'
```

After `JSON.parse(line)` (reading the JSONL), the value is still a JSON-encoded string:
```
args.DirectoryPath === '"C:\\Users\\karx0\\..."'   ← starts with "
```

A second `JSON.parse(args.DirectoryPath)` → `'C:\\Users\\karx0\\...'` (actual path).

`parseArgValue()` in the adapter handles this double-encoding.

---

## Schema mapping to NormalizedRecord

| NormalizedRecord field | Antigravity source |
|---|---|
| `session_id` | conversation UUID (directory name) |
| `project_id` | `deriveAntigravityProjectId(detectWorkspace(records))` |
| `project_label` | `deriveAntigravityLabel(cwd)` — last path segment |
| `first_timestamp` | `created_at` of first record |
| `last_timestamp` | `created_at` of last record |
| `duration_ms` | `last_timestamp - first_timestamp` |
| `user_turns` | count of `USER_INPUT` records (source: `USER_EXPLICIT`) |
| `assistant_turns` | count of `PLANNER_RESPONSE` records (source: `MODEL`) |
| `tool_calls` | sum of `tool_calls.length` across all `PLANNER_RESPONSE` records |
| `tool_errors` | count of tool result records (not `PLANNER_RESPONSE`) with `status === "ERROR"` |
| `tools` | map from `tool_calls[].name` → `{ calls, errors }` |
| `file_ops` | from `view_file` (read), `write_to_file` (write), `replace_file_content` / `multi_replace_file_content` (edit) |
| `bash_categories` | from `run_command.args.CommandLine` via `categorizeBash()` |
| `model` | from `USER_SETTINGS_CHANGE` block in `USER_INPUT.content` — last change wins |
| `first_user_message` | text inside `<USER_REQUEST>` block of first user turn ≥ 8 chars |
| `tokens.*` | **all 0** — not logged by Antigravity |
| `harness` | `"antigravity"` |
| `cwd` | dominant workspace path from tool call args |

**Not available from Antigravity logs:**
- `git_branch` — not logged → `null`
- Token counts — not logged → all zeros
- `slug` — falls back to first 8 chars of conversationId
- `permission_mode` — not applicable
- `skills` / `builtin_commands` — not applicable (Antigravity has no `<command-name>` tags)

---

## Tool name mapping

Antigravity uses `snake_case` tool names.

| Antigravity tool | file_ops op | Path arg |
|---|---|---|
| `view_file` | `read` | `AbsolutePath` |
| `write_to_file` | `write` | `TargetFile` |
| `replace_file_content` | `edit` | `TargetFile` |
| `multi_replace_file_content` | `edit` | `TargetFile` |
| `run_command` | bash category | `CommandLine`, `Cwd` |
| `list_dir` | (workspace detection only) | `DirectoryPath` |
| `grep_search` | (skipped for file_ops) | — |

---

## Project slug derivation

Antigravity has no built-in project naming. The adapter detects the workspace by:

1. Collect all `Cwd` args from `run_command` tool calls, plus directory portions of file-tool `AbsolutePath`/`TargetFile` args and `list_dir` `DirectoryPath` args.
2. Vote by frequency — most-called-from path wins.
3. Normalize to Claude-Code-compatible slug: `D:\src\ebrain` → `D--src-ebrain`.
4. Label = last path segment: `D:\src\ebrain` → `ebrain`.

This means **Antigravity sessions working in the same directory as a Claude Code session will share the same project node** in the graph — intentional and desirable.

---

## Session sizing (tool_count proxy)

Antigravity does not log token counts. The graph builder normally sizes session nodes by `tokens_work = output + cache_create`. Since this is always 0 for Antigravity:

- `lib/graph-pipeline.mjs` computes `MAX_TOOL_CALLS` alongside `MAX_WORK`
- When `tokens_work === 0`, `sizeNorm = sqrt(tool_calls / MAX_TOOL_CALLS)`
- Timeline `tokens_work` fallback: `(output + cache_create) || tool_calls`

Antigravity sessions are sized by activity (tool calls) rather than compute (tokens).

---

## Architecture

```
analyze-antigravity.mjs
  detectWorkspace(records)       → dominant cwd path
  parseAntigravityRecords()      → NormalizedSession
  analyzeAntigravitySession()    → enriched session (calls enrichSession from analyze.mjs)
  main()                         → writes sessions-data.json
```

Run standalone:
```bash
node analyze-antigravity.mjs
```

---

## Current corpus stats (2026-06-07)

| Conversations | With log files | Notable |
|---|---|---|
| 35 total | 7 have `.system_generated/` | Only 1 has `transcript.jsonl` (current session) |

Sessions without any log file (no `transcript.jsonl`, no `overview.txt`) are silently skipped.
