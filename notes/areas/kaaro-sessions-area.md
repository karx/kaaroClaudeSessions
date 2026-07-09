---
published: false
title: "kaaroSessions — System Area"
tags: [kaaro-sessions, area, visualization, multi-harness, personal-tool]
description: "Live observability surface over 7 AI coding agent harnesses (Claude Code, Pi, Antigravity, Grok, opencode, Copilot, Command Code). Answers what was worked on (graph), what's happening now (Mission Control), and how it unfolded (thread view). Zero npm deps, pure Node.js built-ins + D3 from CDN."
date: 2026-07-09
layer: L2-System
maturity: EVERGREEN
para: Area
---

# kaaroSessions — System Area

A maintained personal tool. I run `node serve.mjs` and see my entire AI coding agent
history — across 7 harnesses, not just Claude Code — as an interactive force graph:
projects, sessions, files, token flows, live updates as sessions run. One command, no
install, no cloud.

→ Architecture detail lives in `[[CLAUDE.md]]` (co-located with the code).
→ Harness-by-harness support matrix: `[[docs/harnesses.md]]`.
→ How to add a new harness: `[[harness-architecture]]` (crystallized, worked example: Command Code).

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

Two layers, split 2026-06 (see `[[CLAUDE.md]]` for the full diagram):

```
harness transcripts (7 roots: ~/.claude/projects/, ~/.commandcode/projects/, ...)
    ↓ hooks/          adapters → NormalizedRecord[] → session-reducer, pulse-transformer, trace-tree
    ↓ surface/        http-routes.mjs + sse-hub.mjs — the Observability Surface (HTTP + SSE)
    ↓ experience/      client-core.mjs + client/00–19 (browser JS) — consumes ONLY the surface
```

Live path: `fs.watch` → `jsonl-tail` → adapter → `pulse-transformer` → SSE → browser (no reload).
Graph path: `fs.watch` → debounce 1500ms → `execFile(analyze)` → `execFile(build)` → SSE `updated`.

The experience layer never reaches into harness specifics — new harnesses are
localized additions entirely inside `hooks/` (see `[[harness-architecture]]`).

---

## Current capabilities (as of 2026-07-09)

- 7 harnesses: Claude Code, Pi, Antigravity, Grok, opencode, GitHub Copilot, Command Code
- 5 layouts: force, swimlane, arc, matrix, 3D
- Context tree + Thread View: full conversation replay with tool call arguments
- Mission Control (`/now`): per-harness live rollup, session cards, recent actions
- DAW Builder (`/daw`): dedicated live pulse view + rule-based audio profile editor
- Live pulse: sub-second SSE tool_call/tokens/words events
- Register A design tokens flow into every page artifact
- Pi harness: partial (missing context_resets, ai_title, subagent_count, branches)
- Test suite: **1436 tests**, zero external deps, runs in <4s

---

## Known gaps / next

See `[[TODO]]` and CLAUDE.md's "Known coverage gaps". Top items:
1. `analyze-pi.mjs` parity (still the main harness gap)
2. Token arithmetic computed in multiple places (reducer → enrich → graph-pipeline)
3. `docs/harnesses.md` and this vault need to stay resynced after each architectural pass — the 2026-06 two-layer split went a month without a doc garden pass before this one

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
