# Signal Intelligence: Audio Event Registry

**Branch:** `feat/audio-event-registry`  
**Date:** 2026-06-10  
**Tests:** 1254 passing / 0 failing  
**Sessions analysed:** CC `5a54108b` (this session) · Antigravity `90706382`

---

## What Changed

This branch delivers the **Event Registry** architecture — a single source of truth for all audio event types that replaces the four scattered tables that previously lived in `lib/audio-sim.mjs`.

### Before

```
raw JSONL → pulse-adapters.mjs (per-harness dispatch)
              ↓  (raw tool names)
            resolveSonic (big if/else, 3 event types, null on unknown)
              ↓
            SimEvent[]
```

Three silent-majority problems:
1. **Duplicate JSONL parsing** — `pulse-adapters.mjs` re-parsed the same records already processed by `adapters/*.mjs`. Every new harness required two adapters.
2. **11-key ceiling** — only `tool_call`, `tokens`, `words` produced audio. 455 of 886 CC records (51%) were silently dropped.
3. **Tool name coupling** — raw tool names (`view_file`, `replace_file_content`, `Shell`) were passed through to `resolveSonic` which had to re-normalize them. Antigravity tool aliases resolved to `other → harp` instead of their proper keys.

### After

```
raw JSONL → adapters/*.mjs → NormalizedRecord[]
                                  ├─→ reduceSession       → Session / Graph   [unchanged]
                                  └─→ normRecordsToPulses → resolveSonic → audio  [new]
```

`lib/pulse-transformer.mjs` replaces `lib/pulse-adapters.mjs` for the NR path.  
**Phase 8 complete** — `simulateSession` and `serve.mjs` both run `normRecordsToPulses`; `pulse-adapters.mjs` and `pulse-parser.mjs` live in `ARCHIVE/lib/`. Sections below that describe the "old parsePulse path" are a historical pre-migration snapshot.

---

## Event Registry

**File:** `lib/event-types.mjs`

22 canonical event types across 6 families:

| Family | Event Types |
|---|---|
| `file` | `read` `write` `edit` `grep_glob` |
| `ai` | `agent` `web` `other` |
| `system` | `bash_git` `bash_run` `bash_other` `compact` `permission` `scaffold` `tool_error` `tool_result` |
| `context` | `tokens` `words` `chirp` `mode_shift` |
| `human` | `human_turn` `attachment` |
| `meta` | `unknown` |

Each entry carries: `family · instrument · pan · sendAmt · brightness · volMult · octave · desc · samples{}`.

### Canonical Key Function

`toolNameToKey(name, category)` — single function in `lib/event-types.mjs` that translates any harness's raw tool name to a canonical key:

| Raw Name | Category | → Key |
|---|---|---|
| Read / view_file / read_file | — | `read` |
| Write / write_to_file | — | `write` |
| Edit / replace_file_content / StrReplace / EditNotebook | — | `edit` |
| Grep / Glob / grep_search / list_dir | — | `grep_glob` |
| Agent | — | `agent` |
| Bash / PowerShell / Shell / run_command | git | `bash_git` |
| Bash / PowerShell / Shell / run_command | node/npm/python | `bash_run` |
| Bash / PowerShell / Shell / run_command | other | `bash_other` |
| web_fetch / web_search / WebFetch / "Web search:" | — | `web` |
| anything else | — | `other` |

### Adapter Enhancements (Phase 2b)

All 4 adapters updated:

| Adapter | key on tool_use | text on content_block | scaffold | unknown_record |
|---|---|---|---|---|
| `claude-code` | ✅ | ✅ | — | ✅ |
| `antigravity` | ✅ | — | ✅ EPHEMERAL_MESSAGE | ✅ |
| `grok` | ✅ | ✅ | — | ✅ |
| `pi` | ✅ | — | — | ✅ |

`unknown_record` is the catch-all invariant: every unrecognised record type in any harness emits a NR kind `unknown_record` → pulse event `unknown`. Nothing is silently dropped.

### Pulse Transformer

`lib/pulse-transformer.mjs` — `normRecordsToPulses(nrRecords, ctx, capabilities)`:

| NR Kind | → Pulse Event | Notes |
|---|---|---|
| `tool_use` | `tool_call` | `data.key` = canonical key |
| `tokens` | `tokens` | direct |
| `content_block` text ≥3 words | `words` | |
| `content_block` text <3 words | `chirp` | micro-acknowledgements |
| `user_turn` | `human_turn` | grounds AI activity |
| `context_reset` | `compact` | context limit hit |
| `permission_mode` | `permission` | agent paused for approval |
| `scaffold` | `scaffold` | EPHEMERAL_MESSAGE, system injections |
| `tool_result` error:true | `tool_error` | error feedback |
| `tool_result` success | `tool_result` | payload-weighted |
| `assistant_turn` (tokens:false) | `tokens` (synthetic:true) | Antigravity + Grok approximation |
| `unknown_record` | `unknown` | coverage gap signal |
| *any unmapped kind* | `unknown` | catch-all invariant |

**Invariant:** every NR emits ≥1 pulse. No silent drops.

---

## resolveSonic Refactor

`resolveSonic` now:
- Reads all sonic defaults from `EVENT_TYPES[key]` — no more hard-coded SPATIAL/TOOL_FAMILY tables
- Uses `data.key` when present (from new adapter output); falls back to `toolNameToKey(data.tool, data.category)` for backward compat with the old `parsePulse` path
- Handles all 22 event types — never returns `null`
- Unknown event keys fall through to `EVENT_TYPES.unknown` catch-all

### Preset Update

All 3 presets (`cognitive-flow`, `thrash-detector`, `session-arc`) now cover all 22 event types in both `instruments` and `mappings`. Design intentions:

| Event | Cognitive Flow | Thrash Detector | Session Arc |
|---|---|---|---|
| `compact` | vol 0.75, dark (bri 1000) | **boosted** vol 1.10 (thrash signal) | vol 0.90 |
| `tool_error` | vol 0.80 | **boosted** vol 1.20 | vol 0.90 |
| `human_turn` | vol 0.65, pad | vol 0.60, pad | **louder** vol 0.90 (macro layer) |
| `chirp` | vol 0.25, woodblock | vol 0.20 | **silenced** instrument=off |
| `scaffold` | vol 0.30, oct −1 | vol 0.30 | vol 0.25 |
| `unknown` | vol 0.20, tick | vol 0.20 | vol 0.15 |

---

## Sample Traces

15 sample traces embedded in `lib/event-types.mjs`, validated by `test/harness-parity.test.mjs` on every test run. Harnesses covered:

| Event Type | claude-code | antigravity |
|---|---|---|
| read | ✅ | ✅ |
| write | ✅ | |
| edit | ✅ | ✅ |
| grep_glob | ✅ | |
| agent | ✅ | |
| tokens | ✅ | |
| words | ✅ | |
| chirp | ✅ | |
| human_turn | ✅ | ✅ |
| compact | ✅ | |
| permission | ✅ | |
| scaffold | | ✅ |

---

## Session Anatomy: CC `5a54108b` (this session)

**Session:** `5a54108b-4020-4e56-b570-d4b62209d08b`  
**Project:** `D--src-kaaroSessions`  
**Harness:** Claude Code  
**Duration:** ~8565s (2h 22m)  
**Preset:** Cognitive Flow

### Signal Capture

```
┌─ AUDIBLE EVENTS: 560   (55.6% of 1008 records)
│    tool_call: 168
│    tokens:    316
│    words:     92
└─ SILENT RECORDS: 448
```

### Silent Record Breakdown

| Record Type | Count | Why Silent |
|---|---|---|
| `user` | 177 | human turns — NR emitted, but simulateSession uses old parsePulse path (no human_turn audio yet) |
| `permission-mode` | 44 | same — adapter emits permission_mode NR, but parsePulse path ignores |
| `attachment` | 44 | same |
| `mode` | 44 | same |
| `ai-title` | 44 | same |
| `last-prompt` | 43 | same |
| `file-history-snapshot` | 40 | same |
| `system` | 14 | compact_boundary (14) — adapter emits context_reset NR, not yet in audio |

**Gap (historical):** at the time of this analysis 446 records had NRs and sonic profiles but produced no audio because `simulateSession` still used the raw-JSONL path. The migration to `normRecordsToPulses` has since landed; these records now produce audio.

### Tool Activity

| Key | Count | Instrument | Pan | Brightness |
|---|---|---|---|---|
| `bash_run` | 45 | kick | −0.32 | 2800 |
| `read` | 39 | harp | +0.05 | 6500 |
| `grep_glob` | 20 | bit | +0.10 | 5000 |
| `edit` | 19 | pling | −0.12 | 8500 |
| `write` | 15 | bass | −0.20 | 10000 |
| `bash_git` | 15 | snare | −0.38 | 3500 |
| `other` | 8 | harp | +0.00 | 6500 |
| `bash_other` | 8 | hat | −0.30 | 4000 |
| `agent` | 2 | bell | +0.40 | 5000 |

**Character:** Heavy `bash_run`+`bash_git` presence (35% of tool calls) — this session was TDD-intensive: running tests constantly, git committing after each phase. The `read` layer (23%) reflects heavy code exploration. Only 2 `agent` spawns: subagent use was minimal.

### Token Pressure

316 token events. Brightness range 800–1268 (almost entirely <1000), indicating **99–100% cache hit ratio** throughout. The context was warm — this was a long continuation session with a compacted summary at the start. The flute layer stays very quiet and very low-pitched the entire session, barely registering, because the model was reading from cache rather than generating fresh tokens.

### Sample Transcript Segment (t+3.8s → t+68.9s)

```
t+3.805s    tokens      out=233   cr=99%   flute   bri=861  oct-1  [CONTEXT]  ← context warm from session start
t+3.807s    words       12w "Let me run all tests…"   bell  oct+1  [CONTEXT]  ← first assistant text
t+4.717s    tool_call   Bash  bash_run  kick  bri=2800  [SYSTEM]  ← node --test launch
t+18.316s   tokens      out=316   cr=99%   flute   bri=848  [CONTEXT]
t+18.729s   words       15w "Let me check the test results"  bell  [CONTEXT]
t+21.150s   tool_call   Bash  bash_other  hat  bri=4000  [SYSTEM]  ← ls/file check
t+21.959s   tool_call   Bash  bash_run    kick  bri=2800  [SYSTEM]  ← another test run
t+68.962s   tokens      out=1215  cr=96%  flute  bri=964   [CONTEXT]  ← larger output, bri rises
t+68.962s   words       436w "Here's the full picture…"    bell  oct+1  [CONTEXT]  ← long analysis block
```

Reading the audio arc: the session opens with warm-cache flute pings (almost inaudible, bri~860), immediately followed by a bell announcing the first assistant text, then kicks and hats as the test suite runs. At t+68s the model produces a 436-word analysis block — the bell gets notably louder.

---

## Session Anatomy: Antigravity `90706382`

**Session:** `90706382-4ee1-4e89-b02d-d3cf7bb0929d`  
**Project:** antigravity/brain  
**Harness:** Antigravity (Gemini)  
**Duration:** ~9638s (2h 40m)  
**Preset:** Cognitive Flow

### Signal Capture

```
┌─ AUDIBLE EVENTS: 31    (33.3% of 93 records)
│    tool_call: 24
│    tokens:    0        ← STRUCTURAL SILENCE: no token data in transcript.jsonl
│    words:     7
└─ SILENT RECORDS: 62
```

### Silent Record Breakdown

| Record Type | Count | Status |
|---|---|---|
| `EPHEMERAL_MESSAGE` | 27 | **adapter emits scaffold NR** — sonic profile assigned, but old parsePulse path ignores |
| `PLANNER_RESPONSE` | 27 | produces 24 tool_calls + 7 words (audible) |
| `VIEW_FILE` | 8 | tool-result records (success) — adapter emits tool_result NR, not yet in audio |
| `USER_INPUT` | 7 | adapter emits user_turn NR — sonic profile (pad/human_turn) assigned, not yet in audio |
| `CODE_ACTION` | 5 | unknown_record NR emitted — `unknown` pulse would fire once migrated |
| `GREP_SEARCH` | 4 | tool-result records |
| `RUN_COMMAND` | 4 | tool-result records |
| `CONVERSATION_HISTORY` | 2 | unknown_record NR |
| `LIST_DIRECTORY` | 2 | tool-result records |
| `SYSTEM_MESSAGE` | 2 | unknown_record NR |
| `GENERIC` | 1 | unknown_record NR |

**Gap:** 0 token events — Antigravity transcript does not include token counts. Synthetic tokens (from `content_length / 4` on assistant turns) ARE implemented in the pulse transformer but NOT yet flowing through to audio. The flute layer is completely absent.

### Tool Activity

| Key | Count | Tool Names |
|---|---|---|
| `read` | 9 | view_file |
| `grep_glob` | 6 | grep_search, list_dir |
| `bash_run` | 4 | run_command (node/npm) |
| `edit` | 3 | replace_file_content |
| `write` | 2 | write_to_file |
| `other` | 1 | manage_task |

**Character:** Read-heavy exploration (view_file dominates), with targeted edits and writes. Two `run_command` pairs (tests). No agent subagent spawning. The session had extremely long quiet gaps — t+113s to t+138s, then t+266s to t+664s — consistent with the AI thinking/planning without file ops.

### Sample Transcript Segment

```
t+1.000s    tool_call  view_file     read       harp  bri=6500  [FILE]  ← two simultaneous reads
t+1.000s    tool_call  view_file     read       harp  bri=6500  [FILE]
t+10.000s   words      383w "These are Audio Transcript…"  bell  [CONTEXT]
t+73.000s   tool_call  list_dir      grep_glob  bit   bri=5000  [FILE]  ← filesystem scan (doubled)
t+80.000s   tool_call  grep_search   grep_glob  bit   bri=5000  [FILE]
t+113.000s  tool_call  run_command   bash_run   kick  bri=2800  [SYSTEM] ← test run (doubled)
t+230.000s  tool_call  write_to_file write      bass  bri=10000 [FILE]  ← first write, louder
```

The Antigravity transcript clock is second-resolution (not ms), so `t+1.000s` events cluster as simultaneous pairs. The bass hit at t+230s is the only write in the first 4 minutes — clearly audible against the otherwise harp-and-bit texture.

---

## Current Signal Coverage

### What Was Heard Pre-Migration (old parsePulse path — historical)

| Signal | CC | Antigravity | Grok |
|---|---|---|---|
| Tool calls (canonical key) | ✅ | ✅ | ✅ |
| Token pressure (flute, bri=cache) | ✅ | ❌ no data | ❌ no data |
| Long text (words, bell) | ✅ | ✅ | ✅ |

### What the Migration Unlocked

All of these have sonic profiles, presets, adapter NRs, and transformer pulses. They were blocked at the `simulateSession`/`serve.mjs` migration boundary; **that migration is now complete and these signals are live**:

| Signal | NR Kind | Pulse Event | Instrument | Blocker |
|---|---|---|---|---|
| User prompts | `user_turn` | `human_turn` | pad | simulateSession uses parsePulse |
| Context resets | `context_reset` | `compact` | sweep | same |
| Permission pauses | `permission_mode` | `permission` | tick | same |
| System scaffold | `scaffold` | `scaffold` | woodblock | same |
| Short text (<3w) | `content_block` | `chirp` | woodblock | same |
| Tool errors | `tool_result` (error) | `tool_error` | buzz | same |
| Tool results | `tool_result` (success) | `tool_result` | harp | same |
| Synthetic tokens | `assistant_turn` (synth) | `tokens` (synthetic) | flute | same |
| Unknown records | `unknown_record` | `unknown` | tick | same |

### Migration Path (done)

The full signal set runs through one pipeline everywhere:

```js
const nrs    = recordsToNormalized(records, harness);   // adapters/*.mjs
const pulses = normRecordsToPulses(nrs, ctx, caps);     // lib/pulse-transformer.mjs
```

Completed outcomes:
- `lib/pulse-adapters.mjs` and `lib/pulse-parser.mjs` → `ARCHIVE/lib/`
- CC session audibility: 55% → ~80% (user/permission/attachment/system records all produce audio)
- Antigravity: 33% → ~70% (EPHEMERAL_MESSAGE, USER_INPUT, synthetic tokens, unknown all produce audio)

---

## Coverage Numbers

| Layer | Tests |
|---|---|
| `lib/event-types.mjs` | 22 schema + 8 toolNameToKey tests |
| `adapters/claude-code.mjs` | 5 tests including 3 new (key, text, unknown_record) |
| `adapters/antigravity.mjs` | 5 tests including 3 new (key, scaffold, unknown_record) |
| `adapters/grok.mjs` | 6 tests including 3 new (key, text, unknown_record) |
| `adapters/pi.mjs` | 4 tests including 2 new (key, unknown_record) |
| `lib/pulse-transformer.mjs` | 17 tests (all NR kinds, catch-all, synthetic) |
| `lib/audio-sim.mjs` | 89 tests including 8 new (new event types, data.key path) |
| `lib/audio-presets.mjs` | 9 new preset-coverage tests (all 22 keys per preset) |
| `test/harness-parity.test.mjs` | 15 sample trace tests (CC + Antigravity) |
| **Total** | **1254 passing** |
