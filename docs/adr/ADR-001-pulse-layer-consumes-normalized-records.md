# ADR-001: Pulse Layer Consumes NormalizedRecord, Not Raw JSONL

**Status:** Accepted — 2026-06-09
**Deciders:** kartik (owner)

## Context

The audio simulation pipeline (`lib/pulse-adapters.mjs` → `resolveSonic`) previously re-parsed raw JSONL independently of the analysis adapter pipeline (`adapters/*.mjs` → `NormalizedRecord[]` → `reduceSession`). Both pipelines extracted the same information from the same files, with separate per-harness logic duplicated in each.

Adding harness support (opencode, Copilot, Cursor) would have required implementing two adapters per harness: one for analysis and one for audio.

`CONTEXT.md` stated the intent: *"All downstream reconstruction (sessions, ContextTree, **pulses**) consumes this vocabulary [NormalizedRecord]."* The implementation had not caught up.

## Decision

The pulse layer consumes `NormalizedRecord[]` produced by the analysis adapters. Raw JSONL is parsed exactly once.

```
raw JSONL → adapters/*.mjs → NormalizedRecord[]
                                   ├─→ reduceSession     → Session / Graph
                                   └─→ pulse-transformer → resolveSonic → audio
```

`lib/pulse-adapters.mjs` is replaced by `lib/pulse-transformer.mjs`. `lib/pulse-adapters.mjs` is moved to `ARCHIVE/`.

## Consequences

**Positive:**
- Adding a harness = one `adapters/<name>.mjs` file. Audio, analysis, and OTLP layers inherit automatically.
- NormalizedRecord is the single boundary. Tool name normalization (raw → canonical key) happens once in the adapter; `resolveSonic` never sees raw tool names.
- The catch-all `unknown` event type guarantees no harness activity is silently dropped at the audio layer.

**Negative / trade-offs:**
- `NormalizedRecord` must carry more data than it did for analysis alone: `tool_use` gains a `key` field (canonical action key); `content_block` gains `text?` for text blocks.
- The transformer adds a layer. Previously a single `parsePulse()` call went directly to `resolveSonic`. Now: adapter → NR → transformer → sonic.

## Alternatives Considered

**Keep pulse-adapters.mjs alongside adapters/*.mjs** — rejected: perpetuates duplication; every new harness is double work.

**Central TOOL_ALIASES table in audio-sim.mjs** — rejected: normalization still happened in the audio layer, just in a table rather than if/else. Adapters still wouldn't own their own translation.

## Later refinement (2026-08)

The decision stands: pulses consume `NormalizedRecord[]`, never raw JSONL.

Where the Canonical Action Key is derived does **not**. This ADR said the adapter stamps `key` and `resolveSonic` never sees raw tool names. The code that landed puts key derivation in `hooks/action-keys.mjs`, called by the Pulse Transformer. Adapters emit `nr.tool` + `nr.category` only and stay sonic-unaware. That is the better separation: adapters do the harness hop; the transformer produces Stream vocabulary; the Sonic Encoder must not grow a third alias ladder.
