---
published: false
title: "Review — kaaro/feat/pages-landing vs master"
tags: [kaaro-sessions, pipeline, review, pages, daw, audio]
description: "Architect / tech-lead / security / analyst / product-lead review of the Pages landing + DAW replay branch. Human comment sheet — tick a decision per issue and write under Comment."
date: 2026-08-25
layer: L2-Eval
maturity: BUDDING
para: Pipeline
branch: kaaro/feat/pages-landing
base: origin/master
merge_base: c7296ba5eb941ff6acd46b1ff787a827ec6a1284
diff: 20 files, +2652 / -72
verdict: SHIP WITH FIXES
---

# Review — `kaaro/feat/pages-landing` vs master

Reviewed 2026-08-25. Diff is 20 files, 2652 insertions / 72 deletions.

**How to use this file:** pick a decision in the tracker, then write under each issue’s `Comment` line. Do not edit the Description / Suggestion unless you are correcting a factual error — put disagreement in Comment.

| Decision | Meaning |
|---|---|
| fix now | Blocks merge, or blocks demo of that surface |
| later | Real, not this cut |
| wontfix | Disagree or out of scope — say why in Comment |
| done | Landed on the branch |

---

## Verdict

**SHIP WITH FIXES.**

The branch does two mostly independent things:

1. A GitHub Pages marketing site under `public/` — sound topology, static copy only, no session artifacts.
2. A local DAW session-replay path (`/api/audio` + polyphony coalescing + now-playing).

Ship the landing. Fix the replay contract before calling DAW playback multi-harness.

If replay must ship in the same cut: gate the SIM tab to harnesses whose adapters actually run, and reject ids `locateSession` cannot resolve.

**Product call:**

- [ ] Agree — merge Pages, hold replay demo until bugs 1–3
- [ ] Disagree — ship as-is / hold the whole branch / other
- Comment:

---

## Decision tracker

| # | Sev | File | One-liner | Decision |
|---|---|---|---|---|
| 1 | bug | `experience/audio/audio-sim.mjs:199` | `/api/audio` falls back to Claude Code adapter for opencode/copilot/command-code | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 2 | bug | `hooks/session-locators.mjs:109` | 8-char slug lookup exists only for Grok | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 3 | bug | `experience/client/19-daw-builder.js:816` | Replay hijacks the live audio scheduler while SSE is still connected | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 4 | bug | `experience/client/19-daw-builder.js:163` | DAW playhead always pinned to `W-1` after scrub | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 5 | suggestion | `surface/audio-service.mjs:10` | Surface imports `experience/audio`; `/api/audio` ships full pulse data with CORS `*` | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 6 | suggestion | `experience/client/19-daw-builder.js:826` | One `setTimeout` per replay event | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 7 | suggestion | `experience/client/16-beat-overlay.js:230` | “Heard” outline uses a hardcoded 0.55 s window | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 8 | suggestion | `public/index.html:8` | Google Fonts undercuts “nothing leaves the machine”; favicon still navy | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 9 | suggestion | `experience/client-core.mjs:189` | `coalesceVoices` comment restates the algorithm; `ghosts` unused | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 10 | nit | `experience/client/19-daw-builder.js:863` | “unmute first” / `60× (~1.5 min)` copy lies | [ ] fix now [ ] later [ ] wontfix [ ] done |
| 11 | nit | `surface/http-routes.mjs:33` | Query-string routing incomplete; uncaught `decodeURIComponent` | [ ] fix now [ ] later [ ] wontfix [ ] done |

---

## Persona notes

### Architect

Pages vs live is the right split: `deploy-pages.yml` uploads only `./public`, so transcripts, `graph.html`, and `/api/*` cannot leak onto GitHub Pages, and `serve.mjs` still binds `127.0.0.1` with the Register A `home.html` tiles. Do not merge those two homes — they answer different jobs.

The audio work does not respect the same boundary. Surface importing `experience/audio/*`, which then hard-codes four adapters, is the inverse of `trace-service` and will rot as harnesses are added (the registry checklist will not mention it). Replay also punches a global hole in the live pulse engine (`_audioImmediate`, shared `_beatRing`) instead of a replay-scoped scheduler.

**Verdict:** deploy topology is sound; the replay feature is coupled through the wrong layer and the wrong globals.

- Comment:

### Tech Lead

TDD mapping is strong where the code is pure: `coalesceVoices` / `fmtSoundingLine` in `test/client-core.test.mjs`, and `test/viz-pulse-audio.test.mjs` actually pinning the visualizer to engine tables. HTTP tests cover 400/404/200 and the `/daw?session=` regression.

Gaps: no `buildAudio` case for grok/opencode/copilot/command-code, no slug-prefix test except Grok, no test that `/api/audio` uses `found.sessionId`, and zero coverage of `playReplay` (browser module, known hole). `audio-service` follows the trace mtime-cache pattern but never evicts, and the 501 “audio not wired” branch is untested. Comment quality in `coalesceVoices` is over the repo bar.

**Verdict:** land the Pages workflow and the coalesce tests; do not treat replay as done until adapter + slug tests exist.

- Comment:

### Security

The Pages artifact is clean: no `sessions-data.json`, no SSE, workflow `contents: read` + `pages: write` + `id-token: write` is the standard deploy-pages recipe, `robots.txt` is an allow for a public brochure. `public/index.html` has no session content.

The new local endpoint is the sensitive surface. `/api/audio/:id` returns full pulse `data` (prompts, bash, assistant previews) with `Access-Control-Allow-Origin: *`. Bind-to-localhost stops LAN clients, not a malicious website in the same browser. Prefix lookup uses `readdir` names (good); the pre-existing exact-id `path.join(..., sessionId, ...)` walk is unchanged. Uncaught `decodeURIComponent` can throw. Actions are major-pinned, not SHA-pinned — acceptable for this repo, not a blocker.

**Verdict:** Pages is safe to enable; lock down `/api/audio` body + CORS before advertising replay.

- Comment:

### Analyst

The landing story is complete enough to ship: incident → reframe → seven harnesses → privacy grid → `npx kaaro-sessions` (package is on npm as `kaaro-sessions@0.9.0`). The three tiles now match local `/` (graph / now / daw), which is the right product map. Shortcuts `g`/`n`/`d` are local-home only and correctly absent on Pages.

Replay is the dishonest bit if the page implies “hear your sessions”: slug paste works for Grok, full UUID works for CC/Pi/Antigravity, and three harnesses 200 with silence. Live DAW still needs `/events`; on Pages there is no DAW, so no broken shortcuts there. `60× (~1.5 min)` and “unmute first” are small copy lies. Google Fonts vs “nothing leaves the machine” is the only claim that is false for the visitor of the landing page itself.

- Comment:

### Product Lead

The brochure is ready: it does not pretend to be the app, it does not upload transcripts, and the install command works. The DAW now-playing / chord-collapse work is real and the viz guardrail is a good investment. Session replay is not a seven-harness feature yet — it will 404 on the slug every other view shows, or load “successfully” and play nothing for opencode/copilot/command-code, and it fights live pulses if an agent is running.

**SHIP WITH FIXES.** Merge/deploy Pages as soon as favicon/font privacy nits are acceptable; do not demo `/daw?session=` as the multi-harness magic moment until Issues 1–3 are fixed.

- Comment:

---

## Issues

### 1 — bug — adapter fallback on `/api/audio`

- File: `experience/audio/audio-sim.mjs:199`
- Status: open
- Decision: [ ] fix now  [X] later  [ ] wontfix  [ ] done

**Description.** `/api/audio` is wired for every harness via `createAudioService` → `simulateSession`, but `simulateSession` picks `NR_ADAPTERS[harness] ?? ccNorm`. That map only has `claude-code`, `pi`, `antigravity`, and `grok`. opencode, copilot, and command-code records are parsed with the Claude Code adapter, which does not understand those shapes, so the HTTP handler returns 200 with an empty or nonsense `events[]`. The DAW then reports a successful load and PLAY does nothing useful. `HARNESS_CAPS` has the same four-harness hole (`?? { tokens: true }`), so tokenless harnesses would also be mis-accounted if they ever reached a matching adapter. Tests in `test/audio-service.test.mjs` only exercise a Claude Code Read record, so this never fails CI.

**Suggestion.** Mirror `trace-service.mjs`: `const nrs = harness.adapter(records)` from the registry, then pulse+sonic. Teach `simulateSession` to accept NRs (or take `adapter`/`capabilities` as arguments) and delete the hardcoded `NR_ADAPTERS` fallback. Add one golden `buildAudio` test per remaining harness.

- Comment:

---

### 2 — bug — slug lookup is Grok-only

- File: `hooks/session-locators.mjs:109`
- Status: done
- Decision: [X] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** Prefix lookup for the DAW's 8-char slug (`placeholder="01a03426"`, graph/Mission Control `slug = session_id.slice(0, 8)`) was added only inside `locateGrokSession`. Claude Code / Pi / Copilot / opencode / command-code locators still require an exact id, so pasting the slug the rest of the UI shows 404s `session not found`. Because `resolveSessionFile` is shared, this also makes `/api/trace/<8-char>` start working for Grok only, while `http-routes.mjs` still passes the URL prefix into `buildTrace(...)` instead of `found.sessionId`.

**Suggestion.** Do prefix resolution once in `resolveSessionFile` (or in every `locateSession`) for ids ≥ 8 chars, return the canonical `sessionId`, and have both `/api/audio` and `/api/trace` stamp `found.sessionId`. If multiple matches, 409 with the candidates rather than first `readdir` win.

- Comment: Added a shared `findByPrefix` helper in `hooks/session-locators.mjs` and wired the same case-insensitive 8-char prefix fallback into `locateClaudeCodeSession`, `locatePiSession`, `locateOpencodeSession`, `locateCopilotSession`, `locateCommandCodeSession` (Grok's locator untouched — same behavior). `/api/audio` already stamped `found.sessionId`; `surface/http-routes.mjs:93` was passing the raw URL param into `buildTrace` — fixed to pass `found.sessionId`. Multi-match 409 handling not implemented — kept parity with Grok's existing "first `readdir` win"; flag as a follow-up if slug collisions become a real problem. TDD: prefix-match test added per locator in `test/session-resolver.test.mjs`, plus a regression test in `test/http-routes.test.mjs` asserting `buildTrace` gets the resolved id, not the URL slug. Full suite: 1611/1611 passing.

---

### 3 — bug — replay hijacks live audio

- File: `experience/client/19-daw-builder.js:816`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** `playReplay` sets the process-global `window._audioImmediate = true`, wipes `window._beatRing`, and leaves `connectLive()` attached. Live SSE pulses that arrive during replay therefore (a) skip the 80 ms beat grid and join the 24 ms replay cohort (`14-pulse-audio.js:409`), and (b) mix into the same ring the replay just cleared. `stopReplay` restores the flag but does not drop in-flight `_batchTimer` work in the audio engine.

**Suggestion.** Disconnect or gate SSE while `S.replay.playing`; keep live vs replay rings separate; set `_audioImmediate` only around replay flushes (or pass it per-voice). `stopReplay` should cancel the pulse-audio batch timer / buffer, not only `S.replay.timers`.

- Comment: Does the replay cohort logic not flow in the forceGraph page via the

---

### 4 — bug — playhead pinned after scrub

- File: `experience/client/19-daw-builder.js:163`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** The new playhead is always drawn at `W - 1`, unlike the graph beat overlay which gates on `_isLive`. After the user scrubs (`setLive(false)`), the amber triangle still sits on the right edge while blocks have scrolled left, so “playhead = audio-now” is false in the mode the DAW already supports.

**Suggestion.** Draw the playhead only when `S.isLive`, matching `16-beat-overlay.js:260`. In scrub mode, if a voice is sounding, map `heardAt` through `evTimeX` instead of pinning to the right edge.

- Comment:

---

### 5 — suggestion — surface imports experience; CORS `*` on full pulse data

- File: `surface/audio-service.mjs:10`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** The surface layer now imports `experience/audio/audio-sim.mjs` and `audio-presets.mjs`. That inverts the documented boundary (surface exposes HTTP/SSE; experience consumes it) and reuses a helper that already reaches into `hooks/adapters/*` by name. `trace-service.mjs` stayed harness-agnostic via `getHarness().adapter`; audio did not. `data: e.data` is then shipped wholesale (user `text`, bash `why`/`command`, assistant `preview`, scaffold previews) under the existing `Access-Control-Allow-Origin: *` JSON headers (`surface/http-routes.mjs:15` and `:113`). The server binds `127.0.0.1`, but any browser page can still read this endpoint while `serve.mjs` is running.

**Suggestion.** Keep sonic resolution on the surface with registry adapters + `pulse-transformer` (or move `simulateSession` next to it and stop importing `experience/`). Strip or cap `data` to what `playPulse` needs (`tool`, `where`, `word_count`, token fields, `relMs`) and drop `*` on `/api/audio` (and ideally the other JSON routes). Bound the mtime cache — payloads are far larger than traces.

- Comment:

---

### 6 — suggestion — one timer per replay event

- File: `experience/client/19-daw-builder.js:826`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** Replay creates one `setTimeout` per event plus a done timer. A long session (thousands of pulses) schedules that many timers up front; at 1× this can cover hours. Combined with Issue 1's unfiltered `events` array, a large Claude Code transcript can also be a multi-megabyte JSON parse on the client before those timers exist.

**Suggestion.** Walk the list with a single scheduler (`setTimeout` to the next `relMs`, or a `requestAnimationFrame` loop against `performance.now()`). Cap or paginate `/api/audio` if event count is huge.

- Comment:

---

### 7 — suggestion — heard window ignores instrument duration

- File: `experience/client/16-beat-overlay.js:230`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** The new “heard” outline uses a hardcoded 0.55 s window (`19-daw-builder.js:122` does the same). `voicesSoundingAt` / `INST_DUR` already know real durations (hat 0.04 s, bell 2.5 s), so the now-playing line and the block outline disagree: hats stay hot long after they click, bells go cold while still ringing.

**Suggestion.** Stamp `dur` on `ringEv` in `_flushBatch` and highlight with `heardAt + dur` (or reuse `voicesSoundingAt` keyed by event).

- Comment:

---

### 8 — suggestion — Google Fonts vs privacy claim; navy favicon

- File: `public/index.html:8`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** The marketing page’s privacy claim is “nothing leaves the machine”, and the privacy grid says HOSTING none. The same document loads IBM Plex Mono from `fonts.googleapis.com` / `fonts.gstatic.com` (`public/index.html:32-33`). That is fine for a public site, but it is the first network call a visitor makes and it undercuts the claim the rest of the page is selling. `public/favicon.svg:6-8` also uses the retired navy `#4455cc` / `#00aaff` while the page chrome is Register A orange/amber.

**Suggestion.** System-stack or self-host the font; restyle the Pages favicon to `--k-accent` / `--k-label`. Keep the 127.0.0.1 story scoped to the npx app, not the landing document’s own requests.

- Comment:

---

### 9 — suggestion — design-leaking comment; unused `ghosts`

- File: `experience/client-core.mjs:189`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** The `coalesceVoices` block comment restates the algorithm and embeds design rationale (unison-to-chord, salience, oscillator cap, what ghosts are for). `_flushBatch` never uses `ghosts` — originals already go to the ring — so the comment also describes a contract the production path does not implement. Same class of comment at `14-pulse-audio.js:356-358`.

**Suggestion.** One line: why bursts are collapsed (amp/stacking). Drop the policy essay; if ghosts stay unused, stop returning them or start using them.

- Comment:

---

### 10 — nit — replay status copy

- File: `experience/client/19-daw-builder.js:863`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** Load status tells the user to “click PLAY (unmute first)”, but `playReplay` already calls `_setAudioMuted(false)` and flips `#btn-mute`. The `60× (~1.5 min)` label also assumes a ~90 minute session.

**Suggestion.** “PLAY starts audio” and derive the wall-time hint from `payload.duration_ms` after load.

- Comment:

---

### 11 — nit — query-string routing + decode

- File: `surface/http-routes.mjs:33`
- Status: open
- Decision: [ ] fix now  [ ] later  [ ] wontfix  [ ] done

**Description.** `pathOnly` was added so `/daw?session=` and `/events?...` stop 404ing, but `/`, `/home`, `/graph`, `/now` still exact-match `req.url`. `/now?x` and `/?utm=` 404. `decodeURIComponent` on `/api/audio/` (`:105`) is also uncaught — a lone `%` throws out of the request handler.

**Suggestion.** Route every path on `pathOnly`. Wrap `decodeURIComponent` in try/catch → 400, same as a missing id.

- Comment:

---

## Changed files

```
.github/workflows/deploy-pages.yml
experience/client-core.mjs
experience/client/14-pulse-audio.js
experience/client/16-beat-overlay.js
experience/client/19-daw-builder.js
experience/pages/daw-template.html
hooks/session-locators.mjs
public/favicon.svg
public/index.html
public/og-image.png
public/robots.txt
serve.mjs
surface/audio-service.mjs
surface/http-routes.mjs
test/audio-service.test.mjs
test/client-core.test.mjs
test/http-routes.test.mjs
test/session-resolver.test.mjs
test/viz-pulse-audio.test.mjs
viz-the-pulse-audio.html
```

Scratch copy of the machine review (not for comments): `C:\Users\karx0\AppData\Local\Temp\grok-karx0\grok-review-4a2952e4.md`
