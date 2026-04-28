# kaaro-sessions

A live graph visualizer for your [Claude Code](https://claude.ai/code) session history.

Reads `~/.claude/projects/`, builds an interactive force-directed graph of projects, sessions, and files, and serves it on a local HTTP server. The graph hot-reloads whenever a session file changes.

## Requirements

- [Node.js](https://nodejs.org/) ≥ 18
- [Claude Code](https://claude.ai/code) installed (sessions live in `~/.claude/projects/`)

No `npm install` needed — zero external dependencies.

## Quick start

```bash
node serve.mjs
```

Opens `http://localhost:3333` automatically. The server watches for session changes and pushes live updates to the browser via SSE.

## Scripts

| Command | What it does |
|---|---|
| `node serve.mjs` | Analyze + build + serve + watch (the main entry point) |
| `node analyze.mjs` | Scan `~/.claude/projects/` → `sessions-data.json` |
| `node build.mjs` | `sessions-data.json` → `graph.html` + `graph-data.json` |

## Options

**`serve.mjs`**
```
--port=3333    HTTP port (default 3333)
--no-open      Don't open the browser on start
```

**`build.mjs`**
```
--min-sessions=2    Minimum sessions a file must appear in to show as a graph node (default 2)
```

## What you see

- **Project nodes** (ringed circles) — one per `~/.claude/projects/` directory
- **Session nodes** (filled circles, sized by AI work tokens) — one per JSONL session file
- **File nodes** (diamonds, sized by edits) — files touched across multiple sessions
- **Edges** — membership (session→project), branch lineage, write/edit ops (session→file)

**Timeline strip** along the bottom shows every session chronologically.

**Click** any node to highlight its neighbors and open a detail panel. **Drag** to rearrange.

## Privacy

All data is read locally from your machine and served only to `127.0.0.1`. Nothing is sent to any external service. The generated `sessions-data.json`, `graph.html`, and `graph-data.json` are gitignored and contain your personal session data — don't commit them.
