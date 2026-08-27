# RFC: Calendar Timeline — Polish Follow-ups

**Project:** kaaroSessions
**Status:** Draft (not yet implemented)
**Date:** 2026-08-28
**Relates to:** [RFC-timeline-daytick-perf.md](./RFC-timeline-daytick-perf.md) (implemented — root-cause fix, 2024 floor + left-clamp, adaptive ticks, collapse-by-default, `t` shortcut)
**Grounding:** nitpicks/delight/industry-standard gaps surfaced while reviewing the shipped timeline work; none block correctness or performance, all are optional follow-ups.

---

## 1. Keyboard accessibility on `#tl-hint`

`#tl-hint` (`experience/pages/template.html`) is a `<div onclick="toggleTimeline()">` — not a tab stop, no `Enter`/`Space` activation, no `aria-expanded`. This mirrors the pre-existing `.widget-toggle` spans elsewhere in the file (not a regression introduced by the timeline work), but it's the one real industry-standard miss in this path.

**Fix:** add `role="button" tabindex="0" aria-expanded="true|false"` and a keydown handler for `Enter`/`Space`, or swap the `<div>` for a `<button>` with the click handler unchanged. Worth doing for `.widget-toggle` at the same time if this gets picked up, so the fix isn't timeline-only.

## 2. Clamped-dot collision at scale

`buildTimeline()` (`experience/client/12-controls.js`) renders every pre-2024/unparseable-date session at the exact same x pixel (`clampX`), with only 5 possible y-offsets (`idx % 5`). Fine for the rare one-off bad record; illegible if a data-quality regression ever produces more than a handful at once — they'd stack invisibly on top of each other.

**Fix:** once the clamped count exceeds a small threshold (e.g. 5), replace the individual dots with a single "◂ N pinned" badge (click → list, or just a tooltip enumerating them) instead of one `<circle>` per session.

## 3. Instant collapse/expand

`#timeline.collapsed` toggles via a hard CSS `display:none`/`display:flex` swap — functional, but abrupt next to the rest of the chrome's feel.

**Fix:** a `max-height`/`opacity` CSS transition on the expand/collapse (respecting `prefers-reduced-motion`, per the existing `.pring` pattern in the same stylesheet) would read as an intentional reveal rather than a layout snap.

## 4. Collapse state isn't remembered per-widget

Only a coarse `kaaro-chrome-collapsed` "were all widgets collapsed" boolean persists today (`persistChromeCollapsed()` in `12-controls.js`). If a user deliberately expands the timeline, a reload silently reverts it to its default-collapsed state, since there's no widget-specific persistence — this is a pre-existing limitation of the collapse system, not new.

**Fix:** a dedicated `kaaro-timeline-collapsed` localStorage key, read on boot the same way `kaaro-chrome-collapsed` is, so the timeline behaves like a real settings toggle rather than always reverting to default. Could be generalized to all `.widget`s at once if that's wanted, but the timeline is the one that matters most since it's the only widget with a non-default initial state.

## 5. Untested pure logic

The 2024-floor / left-clamp / adaptive-tick-target math added in the perf pass is pure (no DOM), but it lives inline in `buildTimeline()` inside `experience/client/12-controls.js` — part of the already-documented `experience/client/*.js` coverage gap (see CLAUDE.md "Known coverage gaps"). It's easy to extract and this repo's stated convention is TDD.

**Fix:** pull `computeTimelineDomain({ timestamps, floorMs, now })` (returns `{ domainMinMs, domainMaxMs, spanDays }`) and `timelineTickTarget(viewportWidth)` into `experience/client-core.mjs` (Node-tested, injected as `%%CLIENT_CORE%%` per the existing pattern), with `12-controls.js` calling into them. Regression tests would pin: pre-2024 dates get floored, all-invalid-input falls back sanely, tick target stays bounded 6–40 regardless of viewport extremes.

---

## Non-goals

- Fixing the pre-existing `.widget-toggle` accessibility gap everywhere it appears, unless item #1 is picked up (scope it to the timeline's own control unless asked to go wider).
- Generalizing per-widget collapse persistence to legend/controls/glyph-dock (item #4) unless asked — they don't have a non-default initial state, so the current coarse flag already behaves correctly for them.

## Priority if picked up

1 (accessibility, cheap) → 5 (test coverage, cheap, protects the perf fix) → 2 (collision, only matters at data-quality-regression scale) → 4 (persistence) → 3 (transition polish).
