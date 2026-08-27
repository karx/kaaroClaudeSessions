---
name: grok-bot-pipe
description: Linux-side TRIGGER that packs sanitized Grok Bot transcripts and pushes them through the PIPE to kaaroSessions on the PC. Use when the user wants live grok-bot sessions on the Windows graph, or when agent-data lives at /home/box/agent-data.
---

# Grok Bot PIPE — Linux trigger

You are the box-side packer. The PC checkout cannot see `/home/box/agent-data`.

## Steps

1. Detect. If `/home/box/agent-data` exists, this machine is the box.
2. Pack. Prefer a kaaroSessions checkout on this machine:

   `node scripts/grok-bot-pipe.mjs box --watch`

   If this checkout is not on the box, pack with the same sanitize rules into `/workspace/kaaro-grok-bot-pipe` (CopyToBox the script from the PC repo if needed). Copy only `agent-transcripts/**/*.jsonl` and `agents/*/profile.json`.
3. Never copy secrets or sqlite (`box-secrets.json`, host/sand secrets, `*.db`, WAL, journal-mode).
4. Every ~5s, push grown jsonl + profile.json from staging to the user PC dest. CopyFromBox cannot write `D:/src` directly: land in user home, then move into `D:/src/kaaroSessions/.local/grok-bot-agent-data/` preserving relative paths.
5. The PC user runs package script `grok-bot:pc` (`node scripts/grok-bot-pipe.mjs pc --serve -- --port=3333`). Do not start or kill their serve on 3333 from this side.

Read `docs/PIPE-grok-bot.md` before inventing a new copy loop.
