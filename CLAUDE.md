# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
node serve.mjs              # full pipeline: analyze + build + serve + watch (port 3333)
node serve.mjs --port=3334  # alternate port
node serve.mjs --no-open    # skip auto browser open
node analyze.mjs            # scan ~/.claude/projects/ → sessions-data.json
node build.mjs              # sessions-data.json → graph.html + graph-data.json
node build.mjs --min-sessions=3  # hide file nodes appearing in fewer than N sessions (default: 1)
```

**Tests** (Node.js built-in test runner, no install needed):
```bash
node --test                          # run all tests
node --test test/build.test.mjs      # single file
node --test test/graph-pipeline.test.mjs test/schema.test.mjs  # multiple files
```

No `npm install` needed — zero external dependencies. D3 v7 and 3d-force-graph are loaded from CDN inside the generated HTML.

**HTTP endpoints** (served by `serve.mjs`):
- `GET /` — serves `graph.html` (no-cache)
- `GET /events` — SSE stream; emits `status: rebuilding` then `updated: <iso>` after each pipeline run
- `GET /graph-data.json` — current graph payload for incremental updates
- `GET /status` — JSON `{ rebuilding, lastBuilt, clients, port }` (debug)

## Architecture

Four-layer pipeline, each stage independently testable:

```
~/.claude/projects/**/*.jsonl
        ↓ analyze.mjs
  sessions-data.json              (intermediate — gitignored)
        ↓ lib/graph-pipeline.mjs  (pure data transform)
  { nodes, edges, timeline }
        ↓ build.mjs               (thin orchestrator: I/O + template injection)
  src/template.html + src/client/01-*.js
        ↓
  graph.html                      (self-contained, data inlined — gitignored)
  graph-data.json                 (SSE incremental update payload — gitignored)
```

**`serve.mjs`** owns the runtime: runs `analyze.mjs` then `build.mjs` as child processes via `execFile`, watches `~/.claude/projects/` for `.jsonl` changes (1500 ms debounce), and pushes `event: updated` over SSE so the browser calls `window.updateGraph(newData)` without a full reload.

**`analyze.mjs`** walks every `~/.claude/projects/<projectId>/*.jsonl` file (one JSONL = one session). Extracts token usage, tool calls, file ops (Read/Write/Edit with paths), bash categories, skills (from `<command-name>` tags), first user message, git branch, and model. Outputs `sessions` array + `rollup` object (global aggregates). Skills from `BUILTIN_COMMANDS` are stored under `builtin_commands`, not `skills`.

**`lib/graph-data.mjs`** — pure functions with no I/O: `calcRecencyScore`, `calcRecencyLevel`, `assignProjectColors`, `buildFileNodesAndEdges`, `isSessionInFlight`, `filterSessionsByDateRange`. Re-exported from `build.mjs` for backward-compat test imports.

**`lib/graph-pipeline.mjs`** — exports `buildGraph(data, opts)`. Pure transform: takes a parsed `sessions-data.json` object, returns `{ nodes, edges, timeline, stats, PROJECT_COLORS, COLOR_TO_INDEX }`. No file I/O; fully unit-testable.

**`lib/sessions-schema.mjs`** — canonical contract for `sessions-data.json`. `validateSessionsData()` returns `{ ok, errors[] }`. Any new adapter (Pi, opencode, Copilot) must produce data satisfying this schema. Optional fields are enumerated in `OPTIONAL_SESSION_FIELDS` — graph builder consumes them when present, skips when absent.

**`build.mjs`** is a thin orchestrator: reads `sessions-data.json`, calls `buildGraph`, concatenates `src/client/01-*.js` in numeric order, then calls `applySubstitutions()` to inject JSON into the template. `applySubstitutions(template, subs)` is a single-pass regex replace — the callback form prevents injected data from matching a subsequent `%%PLACEHOLDER%%` and prevents `$&`/`$1` backreference corruption.

**`src/template.html`** — HTML skeleton with `%%PLACEHOLDER%%` markers. `%%CLIENT_JS%%` receives the concatenated + data-injected browser JS. `%%MIN_FILE_SESSIONS%%` sets the range slider default.

**`src/client/`** — browser JS split into 13 numbered modules, concatenated in order by `build.mjs`. `01-data.js` receives injected data (`%%GRAPH_JSON%%`, `%%TIMELINE_JSON%%`, `%%COLOR_INDEX_JSON%%`, `%%IN_FLIGHT_COLOR%%`) and defines global `GRAPH`, `TIMELINE`, `W`, `H`. Subsequent modules depend on these globals.

Layout modules and their responsibilities:
- `06-force-layout.js` — D3 force simulation
- `07-swimlane.js` — Gantt-style bars; branch sub-rows; 8 configurable axes
- `08-arc.js` — temporal coupling map; file co-access arcs; hub list
- `09-matrix.js` — file × session co-occurrence matrix
- `10-3d.js` — 3d-force-graph integration
- `11-layout-manager.js` — switches between layouts, manages active controls panel

**Node sizing**: session nodes scale by `√(tokens_work / MAX_WORK)` where `tokens_work = output + cache_create`. File nodes scale by `√((write + edit) / MAX_FILE_W)`.

**Project ID format**: Claude Code names dirs as path-derived slugs, e.g. `D--src-kaaroViewer`. `deriveLabel()` in `analyze.mjs` strips the drive/path prefix to get the short label.

## Test conventions

Tests use `node:test` + `node:assert/strict`. Each test file targets one module. Fixtures are inline factory functions (`makeData()`, `makeFile()`, `makeSess()`). TDD is the expected workflow — write failing tests before implementing.

Test files map to modules:
- `test/analyze*.test.mjs` → `analyze.mjs`
- `test/build*.test.mjs` → `build.mjs` / `lib/graph-data.mjs`
- `test/graph-pipeline.test.mjs` → `lib/graph-pipeline.mjs`
- `test/schema.test.mjs` → `lib/sessions-schema.mjs`
