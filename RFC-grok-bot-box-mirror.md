# RFC: Grok Bot box-tree mirror (view + hear live)

**PIPE status:** implemented as PIPE, see `docs/PIPE-grok-bot.md` (this RFC is history).

**Project:** kaaroSessions
**Status:** Proposed
**Date:** 2026-08-28
**Relates to:** `grok-bot` harness (`hooks/adapters/grok-bot.mjs`, `hooks/harness-paths.mjs`), live pulse (`surface/pulse-emitter.mjs`), `serve.mjs` watch + SSE
**Grounding:** `kaaro/feat/add-grok-bot` (harness in working tree, uncommitted); live Grok Bot agent-data inspected 2026-08-28

---

## 1. Problem

We can ingest Grok Bot sessions (`grok-bot` is harness 8). We cannot yet **see or hear the session that is running right now** from the Windows kaaroSessions checkout.

Two facts collide:

1. `serve.mjs` runs on Windows (`D:/src/kaaroSessions`), binds `127.0.0.1:3333`, watches harness roots, tails JSONL for pulses, and rebuilds the graph.
2. Grok Bot transcripts do **not** live on Windows. `%APPDATA%\Grok Bot` is Electron cache. The jsonl is on the Grok Bot Linux box at `/home/box/agent-data`.

Default root in code is `/home/box/agent-data`. That path does not exist on this Windows process, so the grok-bot watcher is skipped and the scanner returns nothing. `GROK_BOT_AGENT_DATA` is the override, but nothing has been copied there yet.

Ask: point serve at a copy of the box tree, then view + hear the current running session.

---

## 2. Ground truth

### 2.1 On-disk layout (box)

```
/home/box/agent-data/
  agents/<uuid>/profile.json          # {name, description, title} — ai_title
  agent-transcripts/<uuid>/<uuid>.jsonl
  agent-transcripts/sand-subagent-<uuid>/...   # sibling grok-bot sessions; also junctioned at .local/sand-subagent-*
```

This conversation's agent id: `348c59d5-3636-4efd-aac2-465d3881629c` (profile name `New Bot`).

Do **not** copy: `box-secrets.json`, `host-secrets.json`, `sand-secrets.json`, sqlite/WAL, `search-index.db*`, `*.journal-mode`, telemetry, plugin caches.

### 2.2 JSONL (what the adapter already maps)

One object per line, no top-level ts on most records:

- `role:user` text ? `user_turn` (hidden `[SAND_HIDDEN_PROMPT]` stripped from display)
- assistant `text` ? `content_block` thinking (scratchpad, not user-visible)
- `send_message` ? user-visible `assistant_turn` + text `content_block` (not a tool_use)
- `communicate_update` ? skipped
- real tools (`shell`, `read`, `get_mcp_tools`, `update_todos`, `task`, …) ? `tool_use` / `tool_result`

Capabilities: tokenless, `size_proxy: tool_calls`, pulse + trace, `ai_title` from profile, `project_id` bucket `grok-bot`. `rebuildArg` is `null` (full `--all-harnesses` rebuild on change, same as Grok / Antigravity / Command Code).

### 2.3 What serve already does

- Startup `rebuild()` runs `analyze.mjs --all-harnesses` then `build.mjs`.
- `getEnabledHarnesses()` watches **every** registry root, including grok-bot, if the directory exists.
- JSONL change ? `tailAndPulse` (SSE, audio) + debounced full rebuild (because grok-bot has no incremental `--session=`).
- UI: `http://127.0.0.1:3333` ? `graph.html`. Pulse audio is the existing graph engine (`14-pulse-audio.js`); browser needs a click to start AudioContext.

So the missing piece is **bytes on a Windows path**, not new ingest code.

---

## 3. Goals

1. A **sanitized mirror** of box `agent-data` on Windows that `GROK_BOT_AGENT_DATA` can point at.
2. `node serve.mjs` on this checkout shows grok-bot sessions on the graph, including **this** running session.
3. **Live enough to hear:** as the current jsonl grows on the box, the Windows copy updates so the watcher tails new lines and SSE pulses fire.
4. Secrets never land in the checkout. Mirror dir is gitignored.

Non-goals (this pass):

- Reading `%APPDATA%\Grok Bot` (no transcripts there).
- Parent-child graph edges for sand-subagent (they appear as sibling grok-bot sessions).
- Incremental `--session=` rebuild for grok-bot.
- Running `serve.mjs` on the Linux box (no port to the Windows browser).
- Committing harness work or the mirror.

---

## 4. Proposed mirror

**Windows root (gitignored):**

```
D:/src/kaaroSessions/.local/grok-bot-agent-data/
  agent-transcripts/<uuid>/<uuid>.jsonl
  agents/<uuid>/profile.json
```

**Env** (process that runs serve/analyze):

```
GROK_BOT_AGENT_DATA=D:/src/kaaroSessions/.local/grok-bot-agent-data
```

`.gitignore` gains `.local/`.

### 4.1 Bootstrap (once)

From the box, pack only the safe subset (jsonl + profile.json), copy the archive onto Windows via the existing box?host file push, extract into `.local/grok-bot-agent-data`.

Verify:

```
%GROK_BOT_AGENT_DATA%/agent-transcripts/348c59d5-3636-4efd-aac2-465d3881629c/348c59d5-3636-4efd-aac2-465d3881629c.jsonl
%GROK_BOT_AGENT_DATA%/agents/348c59d5-3636-4efd-aac2-465d3881629c/profile.json
```

### 4.2 Live sync (the current session)

The jsonl is append-mostly and still being written. A one-shot copy is a snapshot; pulses would freeze.

Loop (few seconds, or on size change): recopy

```
/home/box/agent-data/agent-transcripts/348c59d5-3636-4efd-aac2-465d3881629c/348c59d5-3636-4efd-aac2-465d3881629c.jsonl
```

onto the matching Windows path. `fs.watch` on the grok-bot root should then fire ? tail/pulse ? debounced graph rebuild.

If watch misses overwrite-in-place, touch or write-tmp-rename so mtime/size changes. Recopy other agents' jsonl only on bootstrap unless we decide we care about sibling sessions live too.

### 4.3 Serve

From `D:/src/kaaroSessions`:

```
$env:GROK_BOT_AGENT_DATA = "D:/src/kaaroSessions/.local/grok-bot-agent-data"
node serve.mjs --port=3333
```

Expect log line `Watching [grok-bot]: D:\src\kaaroSessions\.local\grok-bot-agent-data`. Open `http://127.0.0.1:3333`. Click the graph once so audio can start. Find the Grok Bot / New Bot session node; `/now` and trace should resolve `348c59d5-3636-4efd-aac2-465d3881629c`.

Hear = pulse voices on `tool_use` / `send_message` / user turns as new jsonl lines arrive. View = graph node + trace panel.

---

## 5. Sequence (do not skip)

1. Add `.local/` to `.gitignore`.
2. Bootstrap sanitized copy (jsonl + profiles only).
3. Export `GROK_BOT_AGENT_DATA`, run `node serve.mjs`.
4. Confirm grok-bot watch + this session on the graph (screenshot / `/api` if needed).
5. Start the live jsonl recopy loop for agent `348c59d5-…`.
6. Trigger a few more turns in this chat; confirm new pulses + graph update.

Stop if step 3 does not watch the mirror or the session is missing from analyze output. Do not widen into subagent walking or AppData archaeology.

---

## 6. Risks

- **Overwrite vs append:** CopyFromBox/replace may not look like an append to `fs.watch`. Mitigate with temp-file + rename, or a short poll of size.
- **Full rebuild on every sync:** grok-bot `rebuildArg` is null, so each change schedules `--all-harnesses`. Fine for a handful of grok-bot sessions; do not also recopy huge unrelated trees.
- **AudioContext:** silence until a user click on the graph tab. Not a harness bug.
- **Hidden first turn:** the `[SAND_HIDDEN_PROMPT]` line is still a `user_turn` with null display_text; the visible first user message is the next real line.

---

## 7. Done when

- Mirror exists, gitignored, no secrets.
- `serve.mjs` with `GROK_BOT_AGENT_DATA` shows this session on the graph.
- New lines from this chat produce pulses (hear) and a graph/trace refresh (view) without a manual recopy.

---

## 8. Out of scope follow-ups

- Durable sync (scheduled copy while away) — only if this loop works.
- Parent-child graph edges (subagents are siblings under project `grok-bot` for now).
- grok-bot incremental `--session=` rebuild.
- Landing-page tape samples for grok-bot.
