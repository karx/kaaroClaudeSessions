# kaaro-sessions

A live observability surface for your AI coding agent sessions.

Reads transcripts from seven harnesses — Claude Code, Pi, Google Antigravity, Grok,
opencode, GitHub Copilot, and Command Code — normalizes them into a common record
vocabulary, and serves an interactive force-directed graph of projects, sessions, and
files plus live Mission Control and DAW views, all from a local HTTP server with
live hot-reload.

<img width="2510" height="1315" alt="Screenshot 2026-04-28 at 11-19-17 Claude Code Sessions — kaaro-sessions" src="https://github.com/user-attachments/assets/d43cf02f-feb2-4eb1-8fc3-5fd6802a9a75" />

## Requirements

- [Node.js](https://nodejs.org/) ≥ 18
- At least one supported harness installed (e.g. [Claude Code](https://claude.ai/code),
  sessions live in `~/.claude/projects/`) — see `docs/harnesses.md` for the full list
  and default roots

No `npm install` needed — zero external dependencies.

## Quick start

```bash
node serve.mjs
```

Opens `http://localhost:3333` automatically. The server watches for session changes
and pushes live updates to the browser via SSE.

- `/` — landing page: pick Graph, Mission Control, or DAW
- `/graph` — the history view (force graph, swimlane, arc, matrix, 3D)
- `/now` — Mission Control: per-harness live rollup, session cards, recent actions
- `/daw` — Live Pulse DAW Builder: pure event stream + audio rule editor

## Scripts

| Command | What it does |
|---|---|
| `node serve.mjs` | Analyze + build + serve + watch (main entry point) |
| `node serve.mjs --port=3334` | Alternate port |
| `node serve.mjs --no-open` | Skip auto browser open |
| `node analyze.mjs` | Scan `~/.claude/projects/` → `sessions-data.json` |
| `node build.mjs` | `sessions-data.json` → `graph.html` + `graph-data.json` |
| `node build.mjs --min-sessions=3` | Hide files appearing in fewer than N sessions |
| `node --test` | Run all unit tests (zero npm deps, <10s) |

## What you see

**Graph nodes**
- **Project nodes** (ringed circles) — one per `~/.claude/projects/` directory
- **Session nodes** (filled circles, sized by AI work tokens) — one per JSONL session file
- **File nodes** (diamonds, sized by edits) — files touched across multiple sessions

**Bottom chrome**
- **Timeline strip** — every session chronologically, scrub to filter by date
- **DAW Feed Widget** — live scrolling feed of tool calls as they happen, with audio synthesis

**Layouts** (keyboard: `1`–`5`)
- Force graph, Swimlane/Gantt, Arc diagram, Matrix, 3D

**Session detail panel** (click any session node)
- Token usage, tool call bar chart, branch history
- Context Windows strip — proportional view of each context reset
- **Thread View** — full conversation replay: every USER/ASST turn, tool calls with
  arguments, error indicators, turn durations, thinking flags

**Live pulse**
- SSE stream pushes `tool_call`, `tokens`, `words` events as sessions update
- Pulse ticker shows a scrolling live feed; pin it to keep history
- Audio engine maps tool families to instruments (BPM-synced)

## Privacy

All data is read locally from your machine and served only to `127.0.0.1`.
Nothing is sent to any external service. The generated `sessions-data.json`,
`graph.html`, and `graph-data.json` are gitignored — don't commit them.
