# RFC: Master Volume Control

**Project:** kaaroSessions
**Status:** Proposed
**Date:** 2026-08-25
**Relates to:** Live Pulse audio engine (`experience/client/14-pulse-audio.js`), audio settings panel (`15-audio-settings.js`), DAW mixer strips (`19-daw-builder.js`)
**Grounding:** current source on `kaaro/feat/pages-landing`

---

## 1. Problem

The audio engine has a master bus (`_masterGain → _masterFilter → destination`) but **no user-facing level control on it**:

| Control that exists today | What it actually does |
|---|---|
| ♪ ON/OFF button (`14-pulse-audio.js` bottom) | Hard mute — stops the scheduler entirely. Binary, no level. |
| Per-instrument-family mixer gain (`window.MIXER_GAINS`, DAW page only) | Relative balance between file/system/ai/context lanes. Not an overall level. |
| Click-track volume slider (`15-audio-settings.js`) | Only affects the metronome tick, not pulse voices. |
| `_masterGain.gain.value = 0.75` (`14-pulse-audio.js:263`) | Hardcoded at bus setup. No slider, no persisted field, no live update path. |

Consequence: a user who finds the pulse audio too loud/quiet relative to their system volume has exactly one lever — mute it entirely. There is no "turn it down," and the two pages (`/graph` settings panel vs `/daw` mixer strips) don't even agree on what a volume control would look like, because neither has one.

This is a small, self-contained gap: the bus, the settings-persistence plumbing (`window.updateAudioSettings` → `localStorage['kaaro-audio-settings']`), and the fader UI pattern (`.ch-fader` on the DAW mixer strips) all already exist. Master volume is the missing field plus two thin UI hookups.

---

## 2. Goals

1. **One persisted setting**, `AUDIO_SETTINGS.masterVolume` (0–1, default `0.75` — matches today's hardcoded value so existing users hear no change on upgrade).
2. **Live-updates the real gain node** (`_masterGain.gain`) with a short ramp (`setTargetAtTime`, matching the existing cognitive-pressure filter automation style) — no zipper noise, no need to reopen the AudioContext.
3. **A slider on both pages that already have audio chrome**:
   - `/graph` (and `/now`, wherever `15-audio-settings.js` runs) — new "◆ MASTER" row at the top of the gear-icon settings panel, above METRONOME.
   - `/daw` — a fifth mixer strip, styled identically to the existing `.ch-strip` file/system/ai/context faders, placed first and visually set apart (it is not a fourth family, it is *the* output).
4. Since both pages read/write the same `localStorage['kaaro-audio-settings']` key, **the level set on one page is honored on the other** the next time that page's engine boots (no cross-tab live sync needed — out of scope, see §5).
5. **Reset to defaults** (`_apReset` in `15-audio-settings.js`) must also push the restored value into the live gain node, not just the settings object — today's reset already has this class of gap for anything holding live node state; volume is the first setting where it's observable.

Non-goals:

- Per-family *overall* level — the DAW mixer strips already do relative balance between families; this RFC only adds the one output-stage fader.
- Automation curves for master volume in the DAW automation editor (that editor targets per-rule sonic parameters, not the bus).
- A log/dB-taper fader. Linear 0–1 gain, consistent with `clickVol` and `MIXER_GAINS` today.
- Cross-tab/cross-page live push (e.g. graph page open in one tab, DAW in another, move one slider and see the other move). Both read `localStorage` on load; that's enough.
- Changing what the ♪ mute button does. Mute and volume stay independent, as in any mixer: volume at 50% and muted is still silent; un-muting comes back at 50%.

---

## 3. Design

### 3.1 Settings field

`14-pulse-audio.js` `DEFAULT_SETTINGS`:

```js
const DEFAULT_SETTINGS = {
  ...
  masterVolume: 0.75,   // NEW — output stage level, independent of mute
  ...
};
```

`_load()` merge already spreads `...DEFAULT_SETTINGS, ...s` so old `localStorage` blobs missing the field fall back to `0.75` for free — no migration code needed.

### 3.2 Engine wiring

`_setupMasterBus` currently does:

```js
_masterGain.gain.value = 0.75;
```

Change to read the setting at setup:

```js
_masterGain.gain.value = window.AUDIO_SETTINGS.masterVolume ?? 0.75;
```

New setter, alongside `window.updateMasterPressure` (same file, same pattern — persist + live-ramp):

```js
window.setMasterVolume = function (v) {
  const vol = Math.max(0, Math.min(1, v));
  window.updateAudioSettings({ masterVolume: vol });
  if (_masterGain && _ac) _masterGain.gain.setTargetAtTime(vol, _ac.currentTime, 0.05);
};
```

`0.05` matches the smoothing constant already used for filter cutoff automation (`_updatePressure`) — short enough to feel immediate, long enough to avoid a click.

### 3.3 UI — `/graph` settings panel (`15-audio-settings.js`)

New section, inserted before `metronome` in the template string:

```js
const mvol = Math.round((S.masterVolume ?? 0.75) * 100);
const master = `
  <div class="ap-sec">◆ MASTER</div>
  <div class="ap-row">
    <input id="ap-master-slider" class="ap-range" type="range" min="0" max="100" step="1"
           value="${mvol}" oninput="window._apMasterVol(this.value)">
    <span id="ap-master-val" class="ap-bpm-val">${mvol}</span>
  </div>`;
```

Callback (same file, alongside `_apClickVol`):

```js
window._apMasterVol = function (val) {
  const el = document.getElementById('ap-master-val');
  if (el) el.textContent = val;
  if (window.setMasterVolume) window.setMasterVolume(parseInt(val, 10) / 100);
};
```

`_apReset` gains one line so the live node actually follows the reset settings object:

```js
window._apReset = function () {
  const d = window.AUDIO_DEFAULTS;
  window.AUDIO_SETTINGS = JSON.parse(JSON.stringify(d));
  try { localStorage.removeItem('kaaro-audio-settings'); } catch {}
  if (window.setMasterVolume) window.setMasterVolume(d.masterVolume); // NEW
  if (window.setClickTrack) window.setClickTrack(false);
  ...
```

Reuses `.ap-range` / `.ap-bpm-val` classes already styled — zero new CSS.

### 3.4 UI — `/daw` mixer (`19-daw-builder.js`)

`buildMixerStrips()` currently loops `FAMILY_LANES` (file/system/ai/context) building one `.ch-strip` each. Add one more strip *before* that loop, same markup, no solo/mute buttons (master isn't a lane to solo against):

```js
function buildMasterStrip() {
  const mixer = document.getElementById('mixer'); if (!mixer) return;
  const v = Math.round((window.AUDIO_SETTINGS?.masterVolume ?? 0.75) * 100);
  const strip = document.createElement('div');
  strip.className = 'ch-strip ch-strip-master'; strip.dataset.family = 'master';
  strip.innerHTML = `
    <div class="ch-label" style="color:${KAARO_TOKENS.accent}">MASTER</div>
    <div class="ch-fader-wrap">
      <input class="ch-fader" type="range" min="0" max="1" step="0.01" value="${v/100}">
      <span class="ch-fader-val">${v}</span>
    </div>`;
  strip.querySelector('.ch-fader').oninput = (e) => {
    const gv = parseFloat(e.target.value);
    strip.querySelector('.ch-fader-val').textContent = Math.round(gv * 100);
    if (window.setMasterVolume) window.setMasterVolume(gv);
  };
  mixer.appendChild(strip);
}
```

Called once, first, in the same place `buildMixerStrips()` is called (`init()`, near line 1238). `.ch-strip-master` is a hook for a thin visual separator (border-left) in the existing mixer CSS block — no new layout system.

No VU meter, solo, or mute wiring on the master strip: those are per-lane debugging aids, not meaningful on the summed output the same way (a VU on master is a real feature but is its own RFC — see §5).

### 3.5 Data flow recap

```
slider (graph panel)  ──┐
                         ├─→ window.setMasterVolume(v)
fader (DAW mixer)     ──┘        │
                                  ├─→ updateAudioSettings({masterVolume: v})  → localStorage['kaaro-audio-settings']
                                  └─→ _masterGain.gain.setTargetAtTime(v, …)  → audible immediately, this page only
```

---

## 4. Alternatives rejected

| Option | Why not |
|---|---|
| Fold volume into the existing ♪ mute button (e.g. long-press for a popup slider) | Hidden, undiscoverable; the gear panel and mixer strips are where users already look for audio controls. |
| dB-scaled fader (`-60dB..0dB`) | Every other level control in this codebase (`clickVol`, `MIXER_GAINS`) is linear 0–1; mixing tapers is inconsistent for no real benefit at this project's scale. |
| A single shared "audio settings" page/panel used by both `/graph` and `/daw` | Bigger refactor (the DAW page deliberately loads a curated module subset, no `15-audio-settings.js`, per `build.mjs` `dawModules`); out of scope for one fader. |
| BroadcastChannel / storage-event live sync between open tabs | Real feature, but nobody has asked for it and it adds a listener + reconciliation path for a case (two tabs open simultaneously) that isn't today's pain point. |
| Master volume as just another `MIXER_GAINS` entry (`MIXER_GAINS.master`) | `MIXER_GAINS` is keyed by instrument family and consumed in `schedVoice` per-voice; master must scale the *summed* bus once, at `_masterGain`, not per-voice — reusing the same map would be semantically wrong (double-multiplies, and only DAW page reads `MIXER_GAINS`, but `/graph` page's mute button needs master volume too). |

---

## 5. Out of scope / follow-ups

- **Master VU meter** on the DAW master strip (visual feedback for the fader) — natural follow-up, not required for the control to work.
- **Cross-tab live sync** (§3, non-goals).
- **Log-taper / dB fader** if linear ever feels wrong in practice.

---

## 6. Files

| File | Role |
|---|---|
| `experience/client/14-pulse-audio.js` | `masterVolume` default field, `_setupMasterBus` read, `window.setMasterVolume` |
| `experience/client/15-audio-settings.js` | MASTER section + slider, `_apMasterVol`, `_apReset` live-push |
| `experience/client/19-daw-builder.js` | `buildMasterStrip`, called once in `init()` |

No `hooks/` or `surface/` changes — this is purely a browser-side engine + two UI hookups, consistent with the existing coverage-gap note that `experience/client/*.js` is untested browser JS.

---

## 7. Key decisions

1. **One field, `AUDIO_SETTINGS.masterVolume`**, default `0.75` (matches today's hardcoded gain — no audible change on upgrade).
2. **Independent from mute.** Volume trims level; mute is the hard on/off. Both already exist as separate concepts in every mixer; don't conflate them here either.
3. **Linear 0–1 gain**, consistent with `clickVol` / `MIXER_GAINS`.
4. **Two UI surfaces, one settings key.** No new shared-state channel; `localStorage` already does the job across page loads.
5. **Reset must touch the live node**, not just the settings object — the first place this gap becomes audible, but not the last (worth a grep for other `_ap*Reset`-adjacent live-node gaps later, not blocking this RFC).

---

## 8. Success

- Moving the MASTER slider in the `/graph` gear panel audibly changes pulse volume immediately, with no click/pop.
- Moving the MASTER fader on `/daw`'s mixer strip does the same.
- Setting it on one page, reloading the other, shows the same percentage and the same audible level.
- Reset to defaults on `/graph` puts the level back at 75% audibly, not just in the settings object.
- Muting (♪ OFF) still silences regardless of the slider position; un-muting returns at whatever level the slider was left at.
