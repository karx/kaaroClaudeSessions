---
published: false
title: "Harness Architecture — How kaaroSessions reads every coding agent"
tags: [kaaro-sessions, architecture, harness, adapter, normalized-record]
description: "The registry-driven harness system: how one local server reads 8 different AI coding agents, normalizes their transcripts into a common vocabulary, and serves live pulses + trace trees."
date: 2026-06-16
layer: L3-Architecture
maturity: CRYSTALLIZED
para: Architecture
---

# Harness Architecture — How kaaroSessions reads every coding agent

kaaroSessions watches 8 AI coding agent harnesses (Claude Code, Pi, Google Antigravity,
Grok, opencode, GitHub Copilot, Command Code, and Grok Bot), normalizes their transcripts into a
common record format, and serves live pulse events + trace trees over HTTP + SSE. This
note explains how a new harness is added and how the pieces connect.

---

## The Two-Layer Architecture

```
┌─ NORMALIZATION FLOW (backend) ──────────────────────────────┐
│  hooks/      registry.mjs (single source of truth)          │
│              adapters/       → raw transcripts →            │
│              │                 NormalizedRecord[]            │
│              session-locators → find log files by session ID │
│              analyzers/      → per-harness scan + stats     │
│              session-reducer → NRs → session stats          │
│              pulse-transformer → NRs → live pulse objects    │
│              trace-tree.mjs  → NRs → context tree           │
│                                                             │
│  surface/    http-routes.mjs, sse-hub.mjs (HTTP + SSE)     │
│              active-state.mjs (mission control)             │
│              trace-service.mjs (/api/trace/:session_id)    │
└────────────────── boundary = Observability Surface ─────────┘
┌─ COGNITIVE EXPERIENCE LAYER (UI) ───────────────────────────┐
│  experience/ consumes ONLY the surface (HTTP + SSE),        │
│              capability-driven — never touches harness      │
│              specifics                                      │
└──────────────────────────────────────────────────────────────┘
```

---

## The 5 Files You Need for a New Harness

Every harness is a localized addition. You need exactly 5 files (plus test updates):

### 1. `hooks/harness-paths.mjs` — Root directory constant

```js
export const NEWHARNESS_ROOT = path.join(os.homedir(), '.newharness', 'sessions');
```

### 2. `hooks/adapters/<harness>.mjs` — The NormalizedRecord adapter

The most important file. Exports `recordsToNormalized(records)` which takes raw
harness records and returns `NormalizedRecord[]`.

Every NR carries:
- `kind` — one of the 16 kinds in `hooks/normalized-record.mjs` (`user_turn`, `assistant_turn`,
  `tool_use`, `tool_result`, `tokens`, `context_reset`, `session_meta`, `branch_change`,
  `skill_invoke`, `permission_mode`, `content_block`, `mode_shift`, `attachment`, `scaffold`,
  `api_error`, `unknown_record`)
- `harness` — the harness id string
- `ts` — timestamp (ISO string or epoch number, optional)

The adapter must NOT import anything harness-specific — just pure transform logic.

### 3. `hooks/analyzers/analyze-<harness>.mjs` — Scanner + per-session analyzer

Two exports:
- `scanHarnessSessions(root)` — walks the harness root directory, yields session files
- `parseHarnessRecords(records, sessionId, projectId)` — adapter → reduce → session object

Uses `walkSessions` + `dirNames` from `hooks/scan-walk.mjs` for recursive directory
scanning. Delegates to `reduceSession(recordsToNormalized(records), meta)` from
`hooks/session-reducer.mjs`.

### 4. `hooks/session-locators.mjs` — `locateHarnessSession(sessionId, root?)`

Given a session ID, walks the harness root to find the log file path. Used by
`surface/session-resolver.mjs` for the `/api/trace/:session_id` endpoint.

### 5. `hooks/registry.mjs` — Harness descriptor entry

Add a descriptor object to `HARNESS_REGISTRY`:

```js
{
  id: 'my-harness',                // machine id, in HARNESS_IDS
  label: 'My Harness',             // human label for UI
  adapter: myAdapter,              // recordsToNormalized function
  scan: { module: './analyzers/analyze-myharness.mjs', export: 'scanMyHarnessSessions' },
  locateSession: locateMyHarnessSession,  // from session-locators.mjs
  readSessionRecords: readJsonlRecords,   // or custom reader
  roots: [MYHARNESS_ROOT],
  capabilities: {
    tokens: false,                 // does it have token data?
    pulse: true,                   // live SSE pulses?
    trace: true,                   // context tree?
    context_resets: false,         // compaction boundaries?
    ai_title: true,                // session titles?
    subagent_count: false,
    branches: true,
    size_proxy: 'tool_calls',      // 'tokens_work' or 'tool_calls'
  },
  watch: {
    matchLogFile(relPath) { ... }, // which files to watch?
    ctxFromPath(relPath) { ... },  // extract session context from path
    rebuildArg(relPath) { ... },   // incremental rebuild arg for analyze.mjs
  },
}
```

The `capabilities` block is the contract — the experience layer reads this to decide
what UI features to show. Never hard-code harness names in the UI.

### 6. Tests (mandatory)

- `test/adapters/nr-compliance.test.mjs` — add a golden session fixture + adapter to
  `ADAPTERS` map. This is the permanent guard: every NR must pass `validateNormalizedRecord`.
- Add a golden adapter test (example: `test/adapters/myharness.test.mjs`) with sample
  records → NR output assertions.

Update test expectations:
- `test/harness-registry.test.mjs` — update `HARNESS_IDS` and `HARNESS_REGISTRY.length`
- `test/analyze-orchestrator.test.mjs` — update `--all-harnesses` expected list
- `test/http-routes.test.mjs` — update `/api/harnesses` expected count

---

## How Live Pulse Works

When `serve.mjs` detects a file change in any harness root:

1. `surface/watch-handlers.mjs` → `processWatchFilename(harnessId, filename, root)`
   - Calls `harness.watch.matchLogFile(relPath)` to check if it's a log file
   - Calls `harness.watch.ctxFromPath(relPath)` to extract session_id, slug, project_id
2. `hooks/jsonl-tail.mjs` → reads only new bytes since last offset
3. Adapter → `recordsToNormalized(newRecords)` → `NormalizedRecord[]`
4. `hooks/pulse-transformer.mjs` → `resolveSonic(nrs)` → pulse objects
5. `surface/sse-hub.mjs` → SSE broadcast to all connected browsers

---

## How Trace Works

`GET /api/trace/:session_id` does:

1. `surface/session-resolver.mjs` → loops all harnesses' `locateSession` until found
2. `harness.readSessionRecords(filePath)` → raw records
3. Adapter → `recordsToNormalized()` → NormalizedRecord[]
4. `hooks/trace-tree.mjs` → `reconstructTraceFromNRs(nrs)` → context segments
5. Returns JSON with `{ ai_title, session_id, segments[] }`

Each segment spans between `context_reset` NRs and tracks: user/assistant turns,
tool call counts by name, subagent count, thinking count, permission modes,
branches, and tokens.

---

## Current Harness Session Counts (as of 2026-06-16)

To fetch Command Code sessions:

```
Total CC sessions found: 5 (across 2 projects)
  - users-arshigoyal-kaaro-src-kaaro-sessions: 5 sessions
  - users-arshigoyal-kaaro-src-kaaro-viewer: 0 sessions (project dir exists, no .jsonl files)
```

CC sessions are stored in `~/.commandcode/projects/<project-id>/<session-uuid>.jsonl`.
Each project dir also has `.checkpoints.jsonl` and `.meta.json` files. The scanner
skips checkpoint files automatically.

---

## Links

- [[CLAUDE.md]] — full architecture reference
- [[docs/harnesses.md]] — live compatibility matrix
- [[hooks/normalized-record.mjs]] — the NR contract (16 kinds, all validated)
- [[hooks/registry.mjs]] — THE single source of truth
