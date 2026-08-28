---
published: false
title: "Improvement set — audio coverage P0"
tags: [kaaro-sessions, pipeline, audio, coverage]
description: "Classify every RECORD_KIND as sonic, silent, or unknown. unknown is only a real hole."
date: 2026-08-26
layer: L2-Eval
maturity: BUDDING
para: Pipeline
---

# Improvement set — audio coverage P0

**Branch:** `kaaro/fix/audio-coverage`  
**Evidence:** `docs/LIVE-FEED-KNOWN-MAP.md` (339s / 454 SSE / 105 `unknown`, 95 false)  
**Hear-drop:** `notes/pipelines/cognitive-eval-hear-drop.md` (preset `nr_kind` off-rules never fired)

## Target

Every NormalizedRecord emits exactly one pulse. `unknown` is only a coverage hole.

| Disposition | Pulse `event` | Meaning |
|---|---|---|
| sonic | named registry type | live signal |
| silent | `silent` (`instrument: 'off'`) | known NR — envelope, snapshot, or duplicate |
| unknown | `unknown` | adapter hole or unclassified `block_type` |

## P0 kinds (this set)

| NR | Was | Becomes | Reason |
|---|---|---|---|
| `assistant_turn` (tokens capable) | `unknown` | `silent` | envelope — tokens NR already fired |
| `session_meta` | `unknown` | `silent` | snapshot |
| `branch_change` | `unknown` | `silent` | snapshot |
| `skill_invoke` | `unknown` | `silent` | snapshot (kind table, not just the capture) |
| `content_block` `tool_use` | `unknown` | `silent` | duplicate of the `tool_use` NR |
| `unknown_record` | `unknown` | `unknown` | real alarm |
| unclassified `content_block.block_type` | `unknown` | `unknown` | real alarm |
| `assistant_turn` + `tokens: false` | synthetic `tokens` | unchanged | |

Out of this set: P1 playable aliases (landed), P2 subscribe `thinking` (landed), P3 `tool_result.tool`, P4 adapter holes (`atis-latch` …), P5 opencode slug / DAW playhead.

## Contract

- Table `hooks/pulse-map.mjs` is 1:1 with `RECORD_KINDS`. Missing row fails CI.
- Transformer builds payload; it does not invent dispositions.
- Canonical action keys stay in `hooks/action-keys.mjs`, derived in the transformer.
- Adapters stay sonic-unaware.
- Presets do not silence by `unknown` + `nr_kind`. Registry default is `off`.
- SSE still emits `silent`. Live client does **not** subscribe it (or `unknown`).
- `experience/` does not import `hooks/`. Join tests live in `test/`.

## Done

A new `/events` capture in the same window: `unknown` ≈ real adapter holes; `silent` carries `reason` in `{envelope, snapshot, duplicate}`; live mix unchanged (these pulses were already wire-only).
