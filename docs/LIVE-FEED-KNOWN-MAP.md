# Live feed — known map

Evidence: `live-feed-capture.json` (2026-08-24, 339s, 454 SSE events, Cognitive Flow).
Source: `GET /events`. Encode: `resolveSonic`. Sinks: same rules as `13-live-updates.js` + `playPulse`.

```
327 non-lifecycle pulses
 ├─ 183  viz + audio   (playPulse would run)
 ├─  94  ticker        (subset of viz)
 └─ 144  wire-only     (on the Stream, no client subscriber)
```

---

## A. False `unknown` — 95 of 105 catch-alls are not gaps

All 105 `unknown` pulses in this window came from Claude Code `56e8fd50`. Breakdown:

| n | What the transformer did | Actual NR | Verdict |
|---:|---|---|---|
| 36 | `assistant_turn` → `unknown` | envelope; real `tokens` NR already emitted | **duplicate / silent** |
| 22 | `branch_change` → default `unknown` | snapshot field | **silent** |
| 20 | `content_block` / `tool_use` → `unknown` | duplicate of the `tool_use` NR | **duplicate / silent** |
| 17 | `session_meta` → default `unknown` | snapshot | **silent** |
| 8 | `unknown_record` `atis-latch` | adapter does not map it | **real gap** |
| 1 | `unknown_record` `file-history-delta` | adapter does not map it | **real gap** |
| 1 | `unknown_record` `system` | adapter does not map it | **real gap** |

Catch-all currently means “envelope + snapshot + duplicate blocks,” not “coverage hole.” You cannot subscribe `unknown` until this is true. Real gaps in this window: **10**.

Rule in `pulse-transformer.mjs`: every NR still emits ≥1 pulse. The fix is a dedicated silent/off mapping for the four false kinds, not dropping the NR.

---

## B. Real pulses the live client never takes — 39

| n | Pulse | Encode | Why wire-only |
|---:|---|---|---|
| 21 | `thinking` | `pad` | not in `13-live-updates.js` subscribe list (playPulse already handles it) |
| 17 | `tool_result` | `harp`; `data.tool` is `"unknown"` | not subscribed; adapter not stamping tool name |
| 1 | `connected` | none | handshake, ignore |

`thinking` is the only one that is both real cognition and cheap to surface (one event name on the existing cognition loop).

---

## C. Viz events that harp at play time — 62 of 183 (34%)

Registry name is not a Playable Instrument. Live `startVoice` does `INSTS[name] \|\| harp`.

| n | Pulse | Encoded as | Live actually plays |
|---:|---|---|---|
| 25 | `attachment` | `click` | harp |
| 21 | `human_turn` | `pad` | harp |
| 8 | `mode_shift` | `chime` | harp |
| 8 | `permission` | `tick` | harp |

These already reach the beat ring. They just all sound like reads.

Playable today: `harp · bass · bell · flute · bit · pling · snare · kick · hat · buzz · off`.

---

## D. Mix shape (what you would hear if unmuted)

| n | Pulse | Voice |
|---:|---|---|
| 64 | `tokens` (36 real CC + 28 Grok synthetic) | flute |
| 26 | reads / other | harp (plus the 62 harp-fallbacks above) |
| 25 | `attachment` | intended click |
| 21 | `human_turn` | intended pad |
| 12 | bash | hat |
| 8 | grep | bit |
| 5 | `words` | bell |
| 3 | `tool_error` | buzz |
| 2 | write | bass |
| 1 | git | snare |

Tokens + harp-fallback dominate. Words are almost absent (5). Synthetic Grok tokens still flute with `output: 0`.

---

## E. Still open from the branch review (not in this capture)

| Item | Why it did not show here |
|---|---|
| Opencode 8-char slug vs `ses_` filename | no opencode pulses in the window |
| DAW playhead / leftover navy glow | viz of `/daw`, not SSE |
| Pages `fallbackInst` vs live harp | `public/index.html`, not `/events` |

---

## Priority (pick one)

Impact = (how much of this window it changes) × (whether the live feed/ear notices) × (whether it unblocks the next row).

| Pri | Fix | Window impact | Ear / feed | Unblocks |
|---|---|---|---|---|
| **P0** | Transformer: map `assistant_turn` (tokenful), `session_meta`, `branch_change`, `content_block/tool_use` to a silent/off pulse — not `unknown` | 95 false catch-alls gone; 10 real gaps remain | none (already wire-only) | honest `unknown`; safe to subscribe leftovers |
| **P1** | Playable table: `pad→bell`, `click→pling`, `chime→bell`, `tick→hat`, `woodblock→pling`, `sweep→kick` (or write the synths) in live `startVoice` + registry | 62 of 183 viz events stop being harp | **yes — this is the live mix** | Pages/live parity; CONTEXT.md Playable Instrument policy |
| **P2** | Subscribe `thinking` in `13-live-updates.js` | 21 events enter viz | yes, after P1 (else they harp too) | cognition layer on the feed |
| **P3** | Stamp `tool` on `tool_result` NRs; decide if success results belong on the feed | 17 rows currently `tool: unknown` | maybe (noisy 1:1 with tool_call) | — |
| **P4** | Adapter: `atis-latch` / `file-history-delta` / leftover `system` | 10 real unknowns | none until subscribed | catch-all stays a real alarm |
| **P5** | Opencode slug prefix; DAW playhead | not in this window | lookup / scrub | branch review bugs |

**P0 landed** on `kaaro/fix/audio-coverage` (2026-08-26): `hooks/pulse-map.mjs` classifies envelope/snapshot/duplicate as `silent`. `unknown` is the alarm. See `notes/pipelines/2026-08-26-audio-coverage.md`.

**P1 landed** (same branch): registry + presets name Playable Instruments only; `playableInstrument()` aliases leftover pad/click/chime/tick/woodblock/sweep at encode time. Live mix no longer harps human_turn/attachment/mode_shift/permission.

**P2 landed** (same branch): `LIVE_COGNITION_EVENTS` in `experience/client-core.mjs` includes `thinking`. Graph/DAW subscribe it; the live encoder names `bell` (not harp fallback). Ticker stays empty — thinking is a pad on the ring. Do not subscribe `unknown` until a post-P0 capture confirms the 10 real holes. Next pick: **P3** (`tool_result.tool`).
