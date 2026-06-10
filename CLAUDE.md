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
- `GET /daw` (or `/builder`, `/audio`) — dedicated **Live Pulse DAW Builder** page (pure event stream, no graph). Full sonic axis mapping, simulator, timbre lab, rule-based audio profiles, large interactive DAW canvas. Works only when served (needs /events).
- `GET /now` (or `/mission`, `/active`) — **Mission Control** page (`src/now.html`, static, Register A terminal style): live active-session board with per-harness rollup, session cards (status, last tool, token burn, errors), ai_title/branch enrichment from graph-data.
- `GET /events` — SSE stream; emits lifecycle events (`status`, `updated`, `error`) AND live pulse events (`tool_call`, `tokens`, `words`, …) on every JSONL change, plus throttled `now` snapshots (≤1/s) of the active-session state
- `GET /api/active` — Mission Control snapshot from `lib/active-state.mjs` (`{ generated_at, sessions[], by_harness, totals }`)
- `GET /graph-data.json` — current graph payload for incremental updates
- `GET /status` — JSON `{ rebuilding, lastBuilt, clients, port }` (debug)
- `GET /api/trace/:session_id` — reconstructed context tree for one session (mtime-cached)

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

**`serve.mjs`** owns the runtime: runs `analyze.mjs` then `build.mjs` as child processes via `execFile`, watches `~/.claude/projects/` for `.jsonl` changes (1500 ms debounce), and pushes `event: updated` over SSE so the browser calls `window.updateGraph(newData)` without a full reload. Also tails new JSONL bytes on every change and emits live pulse SSE events. Also watches `PI_SESSIONS_ROOT` if present.

**`analyze.mjs`** walks every `~/.claude/projects/<projectId>/*.jsonl` file (one JSONL = one session). Extracts token usage, tool calls, file ops (Read/Write/Edit with paths), bash categories, skills (from `<command-name>` tags), first user message, git branch, and model. Also extracts: `context_resets` (compact_boundary count), `ai_title` (from `<ai-title>` tags), `subagent_count` (Agent tool_use count), `branches[]` (all git branches seen). Outputs `sessions` array + `rollup` object (global aggregates). Skills from `BUILTIN_COMMANDS` are stored under `builtin_commands`, not `skills`.

**`analyze-pi.mjs`** — Pi harness adapter. Same output shape as `analyze.mjs` for Pi session files. **Does not yet extract** `context_resets`, `ai_title`, `subagent_count`, or `branches` — these are CC-only for now.

**`analyze-opencode.mjs`** — opencode Harness Hook. Reads `~/.local/share/opencode/storage/{session,message,part}/` JSON trees; assembles info + messages (chronological) with parts embedded as `_parts`; adapter in `adapters/opencode.mjs`. Watch uses `read_mode: 'json'` (whole-file JSON parse, not JSONL tail). Tool parts emit only on `completed`/`error` status; `step-finish` tokens silenced (message envelope is authoritative).

**`analyze-copilot.mjs`** — GitHub Copilot (VS Code) Harness Hook. Scans per-workspace `chatSessions/*.jsonl` op-logs (kind 0=snapshot, 1=set, 2=append) + old `*.json` dumps; project attribution from `workspace.json`; optional title enrichment from `state.vscdb` SQLite (`readChatSessionIndex`, zero-dep via `node:sqlite`, graceful `{}` fallback). Adapter in `adapters/copilot.mjs`; pure URI/tool helpers in `lib/copilot-helpers.mjs`. Tokens are output-only (`completionTokens`).

**`lib/active-state.mjs`** — Mission Control core. Pure live per-session activity store fed by pulse objects: `createActiveState()`, `applyPulse(state, pulse, now)`, `snapshotActive(state, now)` (active/idle status, burn rate over 60s window, per-harness rollups, eviction). No `Date.now()` inside — caller supplies `now`.

**`lib/graph-data.mjs`** — pure functions with no I/O: `calcRecencyScore`, `calcRecencyLevel`, `assignProjectColors`, `buildFileNodesAndEdges`, `isSessionInFlight`, `filterSessionsByDateRange`. Re-exported from `build.mjs` for backward-compat test imports.

**`lib/graph-pipeline.mjs`** — exports `buildGraph(data, opts)`. Pure transform: takes a parsed `sessions-data.json` object, returns `{ nodes, edges, timeline, stats, PROJECT_COLORS, COLOR_TO_INDEX }`. Session nodes include `context_resets`, `ai_title`, `subagent_count`, `branches`, and `tools_top` (top-10 tools by call count). No file I/O; fully unit-testable.

**`lib/sessions-schema.mjs`** — canonical contract for `sessions-data.json`. `validateSessionsData()` returns `{ ok, errors[] }`. Any new adapter (Pi, opencode, Copilot) must produce data satisfying this schema. Optional fields are enumerated in `OPTIONAL_SESSION_FIELDS` — graph builder consumes them when present, skips when absent.

**`lib/pulse-transformer.mjs`** — converts `NormalizedRecord[]` (adapter output) into typed pulse objects for `resolveSonic`. Every NR emits ≥1 pulse (catch-all `unknown` if unmapped). Key derivation (`read`/`bash_git`/…) from `nr.tool + nr.category` happens here via `toolNameToKey` — adapters are sonic-unaware. Replaces the archived `lib/pulse-adapters.mjs`.

**`lib/jsonl-tail.mjs`** — reads only new bytes from a JSONL file given a byte offset. Returns `{ records[], newOffset }`. Used by `serve.mjs` to tail active sessions without re-parsing the whole file.

**`lib/context-tree.mjs`** — pure reconstruction of a session's context tree from raw JSONL records. `reconstructContextTree(records)` returns `{ ai_title, segments[] }`. Each segment spans between `compact_boundary` events and tracks: user/assistant turns, tool call counts by name, subagent count, thinking count, permission modes, branches, and tokens. Used by the `/api/trace/:session_id` endpoint.

**`lib/beat-clock.mjs`** — pure BPM math: `bpmToInterval`, `beatPosition`, `eventsInWindow`, `pushBeatEvent`. No I/O, no AudioContext.

**`lib/ticker-store.mjs`** — pure immutable store for the pulse ticker: `createStore`, `addEntry`, `toggleSticky`, `clearEntries`. No DOM.


**`build.mjs`** is a thin orchestrator: reads `sessions-data.json`, calls `buildGraph`, concatenates `src/client/01-*.js` in numeric order, then calls `applySubstitutions()` to inject JSON into the template. `applySubstitutions(template, subs)` is a single-pass regex replace — the callback form prevents injected data from matching a subsequent `%%PLACEHOLDER%%` and prevents `$&`/`$1` backreference corruption.

**`src/template.html`** — HTML skeleton with `%%PLACEHOLDER%%` markers. `%%CLIENT_JS%%` receives the concatenated + data-injected browser JS. `%%MIN_FILE_SESSIONS%%` sets the range slider default.

**`src/client/`** — browser JS split into 17 numbered modules, concatenated in order by `build.mjs`. `01-data.js` receives injected data (`%%GRAPH_JSON%%`, `%%TIMELINE_JSON%%`, `%%COLOR_INDEX_JSON%%`, `%%IN_FLIGHT_COLOR%%`) and defines global `GRAPH`, `TIMELINE`, `W`, `H`. Key constants: `TL_H = 154` (total bottom chrome height; graph canvas avoids this), `TIMELINE_H = 60` (height of `#timeline` strip; draw coordinates inside it). These two constants serve different purposes — do not conflate.

Layout modules and their responsibilities:
- `06-force-layout.js` — D3 force simulation
- `07-swimlane.js` — Gantt-style bars; branch sub-rows; 8 configurable axes
- `08-arc.js` — temporal coupling map; file co-access arcs; hub list
- `09-matrix.js` — file × session co-occurrence matrix
- `10-3d.js` — 3d-force-graph integration
- `11-layout-manager.js` — switches between layouts, manages active controls panel

Live and audio modules:
- `13-live-updates.js` — SSE client; consumes `updated/status/tool_call/tokens/words` events; calls `window.playPulse(event, data)` and `window.updateGraph(newData)`
- `14-pulse-audio.js` — beat ring buffer (`window._beatRing`, cap 1000, mutate in-place), instrument synthesis, BPM scheduler with 80ms batch coalescing
- `15-audio-settings.js` — audio settings panel DOM; reads/writes `window.AUDIO_SETTINGS` to localStorage
- `16-beat-overlay.js` — DAW Feed Widget; 80px canvas, LIVE/SCROLL mode, block-per-event rendering, hover → graph highlight

**Live SSE pulse events** (emitted by `serve.mjs`, consumed by `13-live-updates.js`):
- `tool_call` — `{ slug, project, tool, where, why, category, ts }` — every tool_use block seen in new JSONL bytes
- `tokens` — `{ slug, project, input, output, cache_create, cache_read, ts }` — every usage record
- `words` — `{ slug, project, preview, word_count, ts }` — assistant text blocks (≥3 words)
- `status` — `"rebuilding"` — pipeline started
- `updated` — ISO timestamp — pipeline complete, client should fetch `/graph-data.json`

`slug` in pulse events = `session_id.slice(0, 8)` (UUID prefix, NOT the human-readable slug). Session node IDs are full UUIDs. To match: `node.id.startsWith(ev.slug)`. `node.label` is the human-readable slug — do NOT compare against `ev.slug`.

**Beat ring mutability contract**: `window._beatRing` is initialised once by `14-pulse-audio.js` and referenced by `16-beat-overlay.js`. The array must be mutated in-place (`push` / `shift`) — never reassigned. Reassignment breaks the shared reference.

**File path normalisation**: JSONL `file_path` fields on Windows contain backslashes. Graph file node IDs use forward slashes (normalised by `analyze.mjs`). When matching `ev.where` against a file node ID: `.replace(/\\/g, '/')`.

**Node sizing**: session nodes scale by `√(tokens_work / MAX_WORK)` where `tokens_work = output + cache_create`. File nodes scale by `√((write + edit) / MAX_FILE_W)`.

**Project ID format**: Claude Code names dirs as path-derived slugs, e.g. `D--src-kaaroViewer`. `deriveLabel()` in `analyze.mjs` strips the drive/path prefix to get the short label.

## Test conventions

Tests use `node:test` + `node:assert/strict`. Each test file targets one module. Fixtures are inline factory functions (`makeData()`, `makeFile()`, `makeSess()`). TDD is the expected workflow — write failing tests before implementing.

Test files map to modules:
- `test/analyze.test.mjs` → `analyze.mjs` (core extraction)
- `test/analyze-bash-jsonl.test.mjs` → `analyze.mjs` (bash categorisation)
- `test/analyze-session-ops.test.mjs` → `analyze.mjs` (file ops)
- `test/analyze-session-tokens.test.mjs` → `analyze.mjs` (token accounting)
- `test/analyze-timeline.test.mjs` → `analyze.mjs` (date/timeline fields)
- `test/analyze-session-metadata.test.mjs` → `analyze.mjs` (context_resets, ai_title, subagent_count, branches)
- `test/analyze-pi.test.mjs` → `analyze-pi.mjs`
- `test/build.test.mjs` → `build.mjs`
- `test/build-template.test.mjs` → `build.mjs` (template substitution)
- `test/build-live.test.mjs` → `build.mjs` (live update path)
- `test/build-features.test.mjs` → `build.mjs` / `lib/graph-data.mjs`
- `test/graph-pipeline.test.mjs` → `lib/graph-pipeline.mjs`
- `test/schema.test.mjs` → `lib/sessions-schema.mjs`
- `test/pulse-transformer.test.mjs` → `lib/pulse-transformer.mjs`
- `test/jsonl-tail.test.mjs` → `lib/jsonl-tail.mjs`
- `test/context-tree.test.mjs` → `lib/context-tree.mjs`
- `test/beat-clock.test.mjs` → `lib/beat-clock.mjs`
- `test/ticker-store.test.mjs` → `lib/ticker-store.mjs`
- `test/audio-sim.test.mjs` → `lib/audio-sim.mjs` + `lib/audio-presets.mjs` (resolveSonic, resolveHz, simulateSession, all 3 presets; Grok tool aliases; web key)
- `test/grok-helpers.test.mjs` → `lib/grok-helpers.mjs` (grokToolWhere path extraction, grokRecordTs, grokSessionUpdate)
- `test/active-state.test.mjs` → `lib/active-state.mjs` (Mission Control store: pulses, burn rate, status, rollups)
- `test/opencode-adapter.test.mjs` → `adapters/opencode.mjs` (+ toolNameToKey opencode/task aliases)
- `test/analyze-opencode.test.mjs` → `analyze-opencode.mjs` (read/analyze/scan over temp storage tree)
- `test/copilot-adapter.test.mjs` → `adapters/copilot.mjs` + `lib/copilot-helpers.mjs` (op-log mapping, URI decode, aliases)
- `test/analyze-copilot.test.mjs` → `analyze-copilot.mjs` (workspace attribution, both formats, real SQLite index fixture)

## Known coverage gaps

- **`serve.mjs`** — HTTP routes, `ctxFromCcPath`, `resolveSessionFile`, trace cache, rebuild pipeline untested
- **`src/client/*.js`** — browser JS; pure logic (e.g. `blockGeom`, `_toolBars`) testable but not yet extracted
- **`analyze-pi.mjs`** — does not extract `context_resets`, `ai_title`, `subagent_count`, or `branches`; graph-pipeline tests do not verify passthrough of these new fields
- **`lib/graph-pipeline.mjs`** — `tools_top`, `context_resets`, `ai_title`, `subagent_count`, `branches` passthrough not yet covered by `test/graph-pipeline.test.mjs`
