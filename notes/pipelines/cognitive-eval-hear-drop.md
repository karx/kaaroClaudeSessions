---
published: false
title: "Cognitive eval — what we hear, skip, and drop"
tags: [kaaro-sessions, pipeline, audio, cognitive-flow, eval]
description: "Eval of the Cognitive Flow pipeline against this Grok session (01a03426) and the latest Claude Code session (d614c475). Three drop layers: mapper, live SSE, Web Audio polyphony."
date: 2026-08-24
layer: L2-Eval
maturity: BUDDING
para: Pipeline
---

# Cognitive eval — what we hear, skip, and drop

**Sessions:** Grok `01a03426` (this kaaroSessions session, 553 pulses) · Claude Code `d614c475` (src-ebrain, 333 pulses)  
**Preset:** Cognitive Flow · major pentatonic · path-hash · 100 BPM  
**Method:** `dump-pulses.mjs --group` + per-tool tallies + live SSE subscriber list + `coalesceVoices` policy  
**Not in this dump:** Web Audio chord-coalesce (DAW/`playPulse` only). CLI transcript is still one oscillator-intent per pulse.

Three independent filters sit between disk and ear. A pulse can pass the mapper, miss the SSE subscription, then lose its oscillator in a burst. They look like one “silence” if you only listen.

```
JSONL
  → adapter → NormalizedRecord[]     [1. never becomes an NR]
  → pulse-transformer → pulse        [2. wrong event / no nr_kind]
  → resolveSonic → instrument        [3. off-rules that never match]
  → SSE /events  (live only)         [4. Graph/DAW live subscriber]
  → coalesceVoices → ≤4 oscillators  [5. DAW/Graph speaker only]
  → ear
```

---

## 1. What we can hear

### Grok `01a03426` — tool-dense, token-blind, late file identity

| Instrument | n | Source |
|---|---|---|
| harp | 212 | 128 `read_file` + 84 `other` (see drop list) |
| pad | 140 | 126 thinking + 14 human_turn |
| pling | 57 | `search_replace` (path-hash: 261.6 / 293.7 / 329.6 / 392 Hz) |
| bit | 41 | grep / list_dir |
| bell | 40 | words (the spoken arc) |
| tick | 39 | unknown / session_meta (should often be off — §3) |
| flute | 14 | fake tokens from `assistant_turn` (`out=0 cr=0%`, bri=5000) |
| buzz | 6 | tool_error |
| bass | 4 | `write` (the only real file-create voice) |

**The session as music:** harp walls of reads and shell, thinking pads under them, bells at turn closes, a bass at the OOM note (`t+1771s`), pling clusters when the DAW/playhead/coalesce work landed (`t+5485`–`6087`). Path-hash on Write/Edit is working. Human pads mark the 13 prompts.

### Claude Code `d614c475` — token-warm, human-heavy, few tools

| Instrument | n | Source |
|---|---|---|
| tick | 129 | **39% of the mix** — structural NRs leaking as unknown (§3) |
| flute | 54 | real tokens, **cr=99–100%**, bri ~808 (warm/cached) |
| pad | 52 | 30 human_turn + 22 thinking |
| harp | 34 | 5 Read + 25 tool_result + 4 `other` |
| click | 29 | attachments |
| hat | 14 | Bash → `bash_other` (left, system) |
| chime | 11 | mode_shift |
| bell | 5 | words (few, long) |
| bit | 4 | Grep |
| buzz | 1 | one tool_error |

**The session as music:** chime + attachment clicks at the open, a dull flute bed (cache-saturated), many human pads, almost no file mutation. One hat near the end. This is a conversation-with-artifacts session, not a coding-thrash session.

### Shared — what the preset is good at

- **File mutation vs observation:** bass/pling vs harp, stereo left vs centre.
- **Human presence:** pad on user_turn.
- **Failure:** buzz, oct-1, unmistakable.
- **CC cache weather:** flute brightness tracks hit rate. Grok cannot (no usage on records).
- **CC bash family:** hat/snare/kick when the tool is actually `Bash`.

---

## 2. Missed / skipped (should sound, or should sound *as something else*)

These pulses exist. They are either the wrong instrument, the wrong family, or never reach live `/events`.

### Mapper — Grok tools that fall through to `other → harp`

`toolNameToKey` has no aliases for Grok Build’s snake_case **agent** tools. This session:

| Raw tool | n | Key today | Should be |
|---|---|---|---|
| `run_terminal_command` | 60 | other / harp | `bash_*` (git/run/other from command) |
| `use_tool` | 11 | other / harp | MCP / agent (or its own key) |
| `todo_write` | 5 | other / harp | scaffold or click |
| `search_tool` | 5 | other / harp | grep_glob or web |
| `get_command_or_subagent_output` | 2 | other / harp | other is honest; maybe chirp |
| `kill_command_or_subagent` | 1 | other / harp | system |

**84 / 314 tool_calls (27%)** are harp-C4 “AI” that should be hats, snares, or a distinct MCP voice. That is why Grok *sounds* like one instrument even when the work is git, tests, and GitHub.

`read_file` / `search_replace` / `write` / `grep` / `list_dir` **are** mapped. File identity works when the agent uses those names.

### Mapper — Grok tokens are a lie

14 `tokens` pulses come from `assistant_turn` NRs, not usage blocks. `out=0 cr=0%` → flute at C3, brightness 5000 (the “no cache data” default). The Cognitive Flow *weather* layer is silent in meaning even though it occupies 14 slots.

CC’s 54 token pulses are real (`output` 194–229, cache ~100%). That contrast is the eval: **same preset, only CC has a flute climate.**

### Mapper — CC events with no voice of their own

| NR | n | Pulse today |
|---|---|---|
| `skill_invoke` | 1 | unknown tick |
| `branch_change` | 1 | unknown tick |
| `content_block/tool_use` | 27 | unknown tick (duplicate of the following `tool_call`) |
| `assistant_turn` | 54 | unknown tick (envelope; content is in child NRs) |

Skill and branch should be first-class (registry already has room; transformer does not emit `skill` / `branch` pulse events). Tool-use content_blocks and assistant_turn envelopes should be **off**, not ticks.

### Live SSE — Graph / live DAW never subscribe

`13-live-updates.js` (Graph) and the DAW live client play:

`tool_call` · `tokens` · `words` · `human_turn` · `compact` · `permission` · `mode_shift` · `tool_error` · `api_error` · `chirp` · `attachment` · `scaffold`

**Not subscribed (so live ear ≠ transcript ear):**

| Pulse | Grok n | CC n | Live? |
|---|---|---|---|
| `thinking` | 126 | 22 | **no** |
| `unknown` | 39 | 129 | **no** |
| `tool_result` | 0 | 25 | **no** |

On `/graph` with `♪ ON` you hear tools, words, humans, CC attachments/mode, errors. You do **not** hear the thinking bed or CC’s tool-result harps. Session replay (`/daw?session=`) uses `simulateSession` → `playPulse` for **every** event type, so replay is closer to the CLI transcript than live is.

---

## 3. Dropped (present, then removed)

### Off-rules that never fire (`nr_kind` not on the pulse)

Cognitive Flow maps these to `instrument: 'off'`:

```
unknown + nr_kind assistant_turn | content_block | session_meta
```

`ruleMatches` looks at `data.nr_kind`. `normRecordsToPulses` never sets it. Result: **silentCount = 0** on both sessions, and those NRs **tick**.

| Kind | Grok | CC | Intended | Actual |
|---|---|---|---|---|
| session_meta | 14 | 25 | off | tick |
| assistant_turn | 14 (as tokens!) | 54 unknown | off | flute / tick |
| content_block/tool_use | — | 27 | off | tick |

CC **129 ticks = 39% of audible events** is mostly this leak. Fix: stamp `nr_kind` on unknown pulses, or switch those NRs to `event` types the off-rules can see.

### Web Audio polyphony (DAW + Graph speaker only)

`coalesceVoices` — **max 4 oscillators per flush**:

- Same-family pile → 3-tone scale chord (write is the root if present)
- Mixed families → round-robin so FILE/AI/CONTEXT each get a slot
- Percussion pile → one hit
- Visual beat-ring still draws **every** pulse (`ghosts` have no oscillator)

At 60× replay, a `t+11s` wall of five `read_file` harps becomes a triad, not five C4s. The CLI transcript still lists five harps — **eval dumps overstate polyphony vs what `/daw` plays.**

Live still uses the 80 ms batch + beat grid, then the same cap. Dense Grok read bursts on `/graph` also chord.

### Adapter / JSONL (never a pulse)

- Grok `_x.ai/session/update` (19 rows this session) — dump marks silent at JSONL; no NR.
- CC `atis-latch`, `frame-link`, `artifact-comment-monitor` — silent JSONL, no NR.
- Grok has **no** `tool_result` success pulses (only 6 errors). CC has 25 result harps. Different harness contract, not a mapper hole.

---

## 4. Scorecard

| Question | Grok this session | CC latest |
|---|---|---|
| Can you hear file writes vs reads? | Yes, late (4 bass / 57 pling / 128 harp) | Barely (0 write, 0 edit, 5 read) |
| Can you hear the human? | 13 pads | 30 pads + 29 clicks |
| Can you hear thinking live? | No (126 in replay only) | No (22 in replay only) |
| Can you hear cache weather? | No (fake zero-token flutes) | Yes (dull flute, cr≈100%) |
| Can you hear shell vs file? | **No** — 60 shells are harp | Yes — 14 hats |
| How much is structural noise? | 39 ticks (7%) | **129 ticks (39%)** |
| Burst handling on DAW | chords, ≤4 osc | few tools, cap rarely hits |

---

## 5. Highest-leverage fixes (not this eval’s job)

1. **Stamp `nr_kind` on unknown pulses** so the existing off-rules actually silence assistant_turn / content_block / session_meta. CC mix changes overnight (ticks 129 → ~21 unknown_record).
2. **Alias `run_terminal_command` → bash_*** (and MCP names) in `action-keys.mjs`. Grok shell becomes hats/snares.
3. **Subscribe `thinking` (and optionally `tool_result`) on live SSE** so Graph matches replay.
4. **Don’t emit `tokens` from Grok `assistant_turn`.** Kill the fake flute.
5. **`skill_invoke` / `branch_change` as real pulse events** — already in the NR vocabulary.

Until (1)+(2), Grok will keep sounding like harp+pad+bell, and CC like tick+flute+pad, regardless of the needle or the chord cap.

---

## Links

- [[sse-jsonl-live-reload]] — two-clock live path (layer 4)
- [[oom-proof-transcript-io]] — size cap; not an audio issue
- `experience/audio/audio-presets.mjs` — off-rules
- `experience/client-core.mjs` `coalesceVoices` — layer 5
- `hooks/action-keys.mjs` — layer 2 aliases
- `experience/client/13-live-updates.js` — live subscriber set
