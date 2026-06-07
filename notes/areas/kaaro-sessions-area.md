---
published: false
title: "kaaroSessions — System Area"
tags: [kaaro-sessions, area, visualization, claude-code, personal-tool]
description: "Live graph visualizer for Claude Code session history. Answers what was worked on (graph) and how it unfolded (thread view). Zero npm deps, pure Node.js built-ins + D3 from CDN."
date: 2026-06-07
layer: L2-System
maturity: EVERGREEN
para: Area
---

# kaaroSessions — System Area

A maintained personal tool. I run `node serve.mjs` and see my entire Claude Code
history as an interactive force graph — projects, sessions, files, token flows, live
updates as sessions run. One command, no install, no cloud.

→ Architecture detail lives in `[[CLAUDE.md]]` (co-located with the code).

---

## What it does

| Layer | Answer |
|---|---|
| Graph view | What files/projects were touched across sessions? What's the shape of my work? |
| Timeline strip | When did sessions happen? What's the cadence? |
| Session panel | How long, what tools, what branch, what was the first message? |
| Context strips | How many context resets? Where did most tokens go? |
| Thread view | What exactly happened — turn by turn, tool call by tool call? |
| Live pulse | What is the agent doing *right now*? |
| DAW widget | Sensory layer — hear and see tool events as they happen |

---

## Architecture (summary)

```
~/.claude/projects/**/*.jsonl
    ↓ analyze.mjs  (extract → sessions-data.json)
    ↓ lib/graph-pipeline.mjs  (pure transform → nodes/edges)
    ↓ build.mjs  (inject into template → graph.html)
    ↓ serve.mjs  (HTTP + SSE + fs.watch + live pulse)
    ↓ src/client/01–18 (browser JS, concatenated)
```

Live path: `fs.watch` → `tailRead` → `parsePulse` → `SSE` → browser (no reload).
Graph path: `fs.watch` → debounce 1500ms → `execFile(analyze)` → `execFile(build)` → SSE `updated`.

---

## Current capabilities (as of 2026-06-07)

- 5 layouts: force, swimlane, arc, matrix, 3D
- Context tree: segment-level aggregates + per-turn detail
- Thread view: full conversation replay with tool call arguments
- Live pulse: sub-second SSE tool_call/tokens/words events
- DAW: BPM-synced audio synthesis mapped to tool families
- Pi harness: partial (missing context_resets, ai_title, subagent_count, branches)
- Test suite: **907 tests**, zero external deps, runs in <10s

---

## Known gaps / next

See `[[TODO]]`. Top 3:
1. `serve.mjs` trace resolver untested
2. `analyze-pi.mjs` parity
3. Token arithmetic centralization

---

## Skill surfaces active in this system

- `[[pending-asst-pattern]]` — tool-result pairing via deferred flush
- `[[sse-jsonl-live-reload]]` — incremental file read → SSE hot-reload
- `[[proportional-strip-ui]]` — token-weighted strip visualization

---

## Links

- [[kaaroViewer]] — sibling tool, the visual knowledge graph for files
- [[kaaroClaudeSessions]] — original garden note with repo link
- [[Compute Theory]] — the conceptual layer this tool explores (what does agent work look like structurally?)
