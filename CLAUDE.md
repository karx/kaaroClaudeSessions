# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
node serve.mjs              # full pipeline: analyze + build + serve + watch (port 3333)
node serve.mjs --port=3334  # alternate port
node serve.mjs --no-open    # skip auto browser open
node analyze.mjs            # scan ~/.claude/projects/ → sessions-data.json
node build.mjs              # sessions-data.json → graph.html + graph-data.json
node build.mjs --min-sessions=3  # hide file nodes appearing in fewer than N sessions (default: 2)
```

No `npm install` needed — the project uses only Node.js built-ins. D3 v7 is loaded from CDN inside the generated HTML.

**HTTP endpoints** (served by `serve.mjs`):
- `GET /` — serves `graph.html` (no-cache)
- `GET /events` — SSE stream; emits `status: rebuilding` then `updated: <iso>` after each pipeline run
- `GET /graph-data.json` — current graph payload for incremental updates
- `GET /status` — JSON with `{ rebuilding, lastBuilt, clients, port }` (useful for debugging)

## Architecture

Three-stage pipeline, each stage a standalone script:

```
~/.claude/projects/**/*.jsonl
        ↓ analyze.mjs
  sessions-data.json          (intermediate — gitignored)
        ↓ build.mjs
  graph.html                  (self-contained, data inlined — gitignored)
  graph-data.json             (SSE incremental update payload — gitignored)
```

**`serve.mjs`** owns the runtime: it runs `analyze.mjs` then `build.mjs` as child processes via `execFile`, starts an HTTP server bound to `127.0.0.1`, watches `~/.claude/projects/` for `.jsonl` changes (1500 ms debounce), and pushes `event: updated` over SSE (`/events`) so the browser calls `window.updateGraph(newData)` without a full reload.

**`analyze.mjs`** walks every `~/.claude/projects/<projectId>/*.jsonl` file. Each JSONL file is one session. It extracts token usage, tool calls, file ops (Read/Write/Edit with paths), bash categories, skills (from `<command-name>` tags), first user message, git branch, and model. Outputs one `sessions` array and a `rollup` object (global aggregates). Skills from `BUILTIN_COMMANDS` (exit, compact, review, etc.) are stored separately under `builtin_commands`, not `skills`.

**`build.mjs`** converts sessions-data.json into a force-directed graph. Nodes are: project (one per project dir), session (one per JSONL), file (files touched in ≥ `MIN_FILE_SESSIONS` sessions with at least one write/edit). Edges are: membership (session→project), branch lineage (consecutive sessions on the same branch), write/edit/read (session→file). The entire graph JSON is inlined into `graph.html` as JS variables — no fetch needed when opening the file directly. `graph-data.json` is the same payload served by `/graph-data.json` for live updates.

**Project ID format**: Claude Code names project dirs as path-derived slugs, e.g. `D--src-kaaroViewer`. `deriveLabel()` in `analyze.mjs` strips the drive/path prefix to get the short label.

**Node sizing**: session nodes scale by `√(tokens_work / MAX_WORK)` where `tokens_work = output + cache_creation`. File nodes scale by `√((write + edit) / MAX_FILE_W)`.
