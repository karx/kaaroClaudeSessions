# Pi Coding Agent — Adapter Findings

**Surveyed:** 2026-05-07  
**Corpus:** 10 sessions / 4 project directories  
**Session root:** `C:\Users\karx0\.pi\agent\sessions\`  
**Agent package:** `@mariozechner/pi-coding-agent`

---

## Session directory layout

```
~/.pi/agent/
  auth.json
  models.json
  settings.json
  bin/
    fd.exe
    rg.exe
  sessions/
    --D--src-ebrain--/
      2026-04-26T14-22-51-638Z_019dca2b-f4f5-7609-96ae-fe883f7a03db.jsonl
      2026-04-26T15-11-11-924Z_019dca58-3633-74d1-8273-657e53183bfb.jsonl
      ...
    --D--src-karx.github.io--/
    --D--src-Minecraft-Overviewer--/
    --C--Users-karx0--/
```

**Project slug format:** `--<drive>--<path-segments>--` (double-dash prefix and suffix, dots preserved, no drive colon).  
Claude Code uses: `<drive>--<path-segments>` (no wrapping dashes, drive letter only).

**Filename format:** `<ISO-timestamp>_<uuid>.jsonl` — timestamp sorts chronologically without reading the file, unlike Claude Code's bare `<uuid>.jsonl`.

---

## JSONL record types

Only 4 types observed across all 10 sessions (290 records total):

| `type` | Count | Notes |
|---|---|---|
| `message` | 237 | User and assistant turns. Core data. |
| `model_change` | 24 | Provider + model switch events. |
| `thinking_level_change` | 19 | `"off"` \| `"medium"` \| `"high"` etc. |
| `session` | 10 | One per file — session metadata. |

No per-turn system records (no equivalent of `system/turn_duration`, `attachment`, `permission-mode`, etc.).

---

## Record shapes

### `session` — always first record
```jsonc
{
  "type":      "session",
  "version":   3,
  "id":        "019dca2b-f4f5-7609-96ae-fe883f7a03db",
  "timestamp": "2026-04-26T14:22:51.638Z",
  "cwd":       "D:\\src\\ebrain"
}
```

### `model_change`
```jsonc
{
  "type":      "model_change",
  "id":        "b52a32ac",
  "parentId":  "4c8a2fc9",
  "timestamp": "2026-04-26T15:11:56.604Z",
  "provider":  "google-antigravity",
  "modelId":   "gemini-3.1-pro-low"
}
```

### `thinking_level_change`
```jsonc
{
  "type":         "thinking_level_change",
  "id":           "35f97810",
  "parentId":     null,
  "timestamp":    "2026-04-26T14:22:51.669Z",
  "thinkingLevel":"off"
}
```

### `message` — user turn
```jsonc
{
  "type":     "message",
  "id":       "c73ace1b",
  "parentId": "c8b5a28c",
  "timestamp":"2026-04-26T15:07:47.047Z",
  "message": {
    "role":    "user",
    "content": [{ "type": "text", "text": "hey" }],
    "timestamp": 1777216067042
  }
}
```

### `message` — assistant turn (with tool calls)
```jsonc
{
  "type":     "message",
  "id":       "72b7f3d9",
  "parentId": "21136fd4",
  "timestamp":"2026-04-26T15:12:40.761Z",
  "message": {
    "role":    "assistant",
    "content": [
      { "type": "thinking", "thinking": "..." },
      {
        "type":      "toolCall",
        "id":        "s7g37kr7",
        "name":      "bash",
        "arguments": { "command": "cat ..." },
        "thoughtSignature": "..."
      },
      { "type": "text", "text": "" }
    ],
    "api":      "google-gemini-cli",
    "provider": "google-antigravity",
    "model":    "gemini-3.1-pro-low",
    "usage": {
      "input":       1047,
      "output":      308,
      "cacheRead":   0,
      "cacheWrite":  0,
      "totalTokens": 1355,
      "cost": {
        "input":     0.002094,
        "output":    0.003696,
        "cacheRead": 0,
        "cacheWrite":0,
        "total":     0.00579
      }
    },
    "stopReason":  "toolUse",
    "timestamp":   1777216354043,
    "responseId":  "ZyvuaamMBYuvjuMPpdDvmQw"
  }
}
```

---

## Tool names observed

Pi uses lowercase tool names. File operation tools use `path` (not `file_path`):

| Tool | Claude Code equivalent | Arg field |
|---|---|---|
| `bash` | `Bash` | `command` |
| `write` | `Write` | `path`, `content` |
| `read` | `Read` | `path` |
| `edit` | `Edit` | `path` (inferred) |

No equivalent of `Glob`, `Grep`, `Agent`, `WebFetch`, `Skill`, `TaskCreate`, etc. observed in this corpus.

---

## Schema mapping to NormalizedRecord

| NormalizedRecord field | Claude Code source | Pi source |
|---|---|---|
| `ts` | `rec.timestamp` | `rec.timestamp` |
| `type: "session_meta"` | `system/turn_duration` | `type: "session"` record |
| `type: "user_turn"` | `rec.type === "user"` | `rec.message.role === "user"` |
| `type: "assistant_turn"` | `rec.type === "assistant"` | `rec.message.role === "assistant"` |
| `type: "tool_use"` | `block.type === "tool_use"` | `block.type === "toolCall"` |
| `tool` name | `block.name` | `block.name` (lowercase) |
| `input` args | `block.input` | `block.arguments` |
| `tokens.input` | `usage.input_tokens` | `usage.input` |
| `tokens.output` | `usage.output_tokens` | `usage.output` |
| `tokens.cache_read` | `usage.cache_read_input_tokens` | `usage.cacheRead` |
| `tokens.cache_create` | `usage.cache_creation_input_tokens` | `usage.cacheWrite` |
| `session.cwd` | `rec.cwd` on user turns | `session.cwd` on session record |
| `session.model` | `rec.message.model` | last `model_change.modelId` before turn |
| `session.git_branch` | `rec.gitBranch` | **not available** |
| `session.version` | `rec.version` | **not available** |

**Extra data Pi provides (not in Claude Code):**
- `usage.cost` — per-turn USD cost broken down by token tier
- `provider` — model provider (openai, google-antigravity, etc.) separate from model ID
- `thinkingLevel` — thinking depth setting at time of turn
- Multi-model within a session (model switches tracked via `model_change` records)

---

## Gaps and adapter decisions

### 1. No `git_branch`
Pi does not write `gitBranch` to session records. The adapter should leave `git_branch: null`. Could potentially run `git rev-parse` against `session.cwd` at analysis time, but that's fragile (cwd may no longer be a git repo, or branch may have changed). **Decision: leave null, do not infer.**

### 2. `parentId` tree vs flat sequence
Pi records form a linked tree via `parentId`. For aggregate stats (token sums, tool counts) this doesn't matter — process all records sequentially. For turn ordering or tool attribution, walk `parentId` chain if needed. **Decision: flat sequential scan is sufficient for Phase 2.**

### 3. Project slug format
Claude Code: `D--src-ebrain` → `deriveLabel` strips drive prefix → `ebrain`  
Pi: `--D--src-ebrain--` → needs a separate branch in `deriveLabel` or a Pi-specific `derivePiLabel`:
```js
function derivePiLabel(projectDir) {
  // "--D--src-ebrain--" → "ebrain"
  // "--C--Users-karx0--" → "karx0" (home dir)
  return projectDir.replace(/^--[A-Za-z]--/, '').replace(/--$/, '').split('--').pop();
}
```

### 4. Tool name casing
Pi tool names are lowercase (`bash`, `write`, `read`). The adapter should normalize to title-case (`Bash`, `Write`, `Read`) so the shared `file_ops` and `bash_categories` logic works without modification, OR keep them lowercase and treat them as a separate namespace. **Decision: normalize to title-case in the adapter layer.**

### 5. Cost data
Pi's `usage.cost` is unique. It should be surfaced in the normalized session data as an optional `cost: { input, output, cacheRead, cacheWrite, total }` field (null for Claude Code sessions). The graph tooltip can show cost when available.

### 6. Session filename gives free timestamp
Pi's `<ISO-timestamp>_<uuid>.jsonl` format means `first_timestamp` can be read from the filename without opening the file — useful for fast sorting during directory scan. The adapter can extract this as an optimization.

---

## Architecture decision: where the adapter lives

Following W-OBS-04 Phase 2 convention:

```
analyze.mjs
  └─ detectHarness(sessionDir)  → "claude-code" | "pi"
  └─ parseSessionRecords(file, harness)
       ├─ parseClaudeCodeRecords(file)   → NormalizedRecord[]
       └─ parsePiRecords(file)           → NormalizedRecord[]
```

Discovery: `analyze.mjs` checks both `~/.claude/projects/` and `~/.pi/agent/sessions/`. Sessions from both are merged into the same `allSessions[]` array with a `harness` field added to each session object, so the graph shows them together.

The `harness` field propagates to graph nodes — enabling filter-by-harness in the visualization.

---

## Current corpus stats (2026-05-07)

| Project | Sessions | Notes |
|---|---|---|
| `ebrain` | 6 | Largest, 193 KB file observed |
| `karx.github.io` | 2 | |
| `Minecraft-Overviewer` | 2 | Most recent (today) |
| `--C--Users-karx0--` | 0 | Directory exists, no sessions yet |

Total: **10 sessions**, **290 records**, models used: `gpt-5.4` (OpenAI), `gemini-3.1-pro-low` (Google via google-antigravity), plus failed attempts with NVIDIA NIM.
