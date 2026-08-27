---
title: Grok Bot PIPE
tags: [grok-bot, pipe, sync, live]
description: Operational note for the sanitized Grok Bot box-to-PC pipe.
date: 2026-08-28
---

# Grok Bot PIPE (ops)

Canonical flow: `docs/PIPE-grok-bot.md`.

## Scripts

- `grok-bot:init` — detect side, print next command, mkdir dest on PC
- `grok-bot:box` — pack jsonl + profile.json onto `/workspace/kaaro-grok-bot-pipe` every 5s
- `grok-bot:pc` — land `.local/grok-bot-agent-data`, set `GROK_BOT_AGENT_DATA`, spawn serve on :3333

CLI: `node scripts/grok-bot-pipe.mjs [init|box|pc]`

## pipe-status.json

Written by the box packer into the staging dest each cycle:

- `side` (box)
- `copied` / `skipped` / `jobs`
- `src`, `dest`, `ts`
- `files[]` of `{rel, size}` for present safe files

Secrets and sqlite are never packed. Do not copy live `/home/box/agent-data` wholesale.
