# RFC: Calendar Timeline — Correctness + Performance

**Project:** kaaroSessions
**Status:** Draft (not yet implemented)
**Date:** 2026-08-27
**Relates to:** `experience/client/12-controls.js` (`buildTimeline`), `experience/graph-pipeline.mjs` (TIMELINE build), `hooks/helpers/grok-helpers.mjs`, `hooks/adapters/opencode.mjs`
**Grounding:** the bottom day-tick strip (`#timeline` / `#tl-svg`) occasionally shows sessions dated 1970, and its render cost scales with calendar span rather than session count — both trace to the same class of bug.

---

## 1. Problem

`buildTimeline()` (`experience/client/12-controls.js:261-301`) draws the bottom calendar strip on **every** initial load and **every** SSE `updated` event (`13-live-updates.js:21`). Today it:

1. Computes `tMin`/`tMax` from `TIMELINE.map(d => new Date(d.ts))` with no sanity filtering.
2. Sizes the SVG to `max(3000px, 40 + spanDays * 20)`.
3. Draws one `<line>` (+ one `<text>` per 3rd) **per calendar day** in `[tMin, tMax]` via `d3.timeDay.range(...)`.

Cost is `O(spanDays)`, not `O(session count)`. A single corrupted timestamp anywhere in the dataset can widen the span from ~90 days to ~20,000+ days, producing tens of thousands of DOM nodes on a strip nobody may even be looking at.

## 2. Root cause of the 1970 entries

Two harness adapters share the same flawed fallback for converting a raw numeric timestamp to ISO:

```js
// hooks/helpers/grok-helpers.mjs:22-28 (grokRecordTs)
if (typeof record?.timestamp === 'number')
  return new Date(record.timestamp * 1000).toISOString();

// hooks/adapters/opencode.mjs:27-29 (toIso)
function toIso(ms) {
  return typeof ms === 'number' ? new Date(ms).toISOString() : null;
}
```

`typeof 0 === 'number'` is `true`, so a sentinel/uninitialized `0` ("no timestamp available") is silently converted into `"1970-01-01T00:00:00.000Z"` — a **truthy string**. Downstream, `trackTs()` (`hooks/session-reducer.mjs:88-92`) only rejects falsy `ts` values, so this fabricated string is accepted as a legitimate `first_timestamp`.

These are not real 1970 sessions — they're "date unknown" mis-encoded as epoch. This is also mechanically why the render blows up: one such session anchors the domain 56 years in the past.

## 3. Decisions

| # | Decision |
|---|---|
| 1 | **Fix the encoding bug at the source.** `grokRecordTs`/`toIso` return `null` (not an epoch string) for non-positive numeric timestamps. TDD, with regression tests pinned to the exact `timestamp: 0` / `ms: 0` inputs. |
| 2 | **Aggressive floor at 2024-01-01.** The timeline domain never extends before `2024-01-01T00:00:00Z`, regardless of what's in the data. Any session dated earlier (bad encoding, or a genuinely ancient import) is **not excluded** — it renders as a dot **clamped to the leftmost pixel** of the strip, visually distinct (dimmed/pinned), so it stays discoverable without being able to stretch the scale. This is a render-layer floor, independent of and in addition to fix #1 — it also protects against any *future* harness introducing the same class of bug. |
| 3 | **Decouple render cost from calendar span.** Stop generating one DOM node per calendar day. Use the scale's own adaptive tick generator (`xScale.ticks(n)` with a width-derived target count, e.g. `max(6, floor(availableWidth / 90))`) instead of `d3.timeDay.range(tMin, tMax)`. `d3.scaleTime` picks "nice" day/week/month/year boundaries for however many ticks are asked for — the tick count becomes a small constant (~6–15 nodes) whether the span is 10 days or 10 years. Format each tick with `xScale.tickFormat()` (adaptive granularity) instead of a fixed `%m/%d`. Cap the scrollable width at a sane maximum so pathological spans can't reintroduce runaway width. |
| 4 | **Memoize the expensive parts.** Cache `{tMin, tMax, timelineLen}` from the last render; when unchanged (a live update that doesn't touch the visible date range), skip scale/tick/width recomputation entirely and only let d3's keyed `.join()` on `circle.tl-dot` (already keyed by `d.id`) add/remove the sessions that actually changed. |
| 5 | **Collapsed by default.** `#timeline` becomes a `.widget`-style collapsible strip (reusing `toggleWidget`/`persistChromeCollapsed`), collapsed on first load. While collapsed, `buildTimeline()` is **not invoked at all** — the expensive DOM build is deferred until the user actually expands it (real lazy-render, not CSS-hide-after-build). State persists in `localStorage` like the other chrome widgets. |
| 6 | **Keyboard shortcut.** Add `t` → "Toggle calendar timeline strip" to `SHORTCUTS_DEF` in `12-controls.js`, following the existing `f/s/a/m/g/p/h` convention (auto-registers in the `?` help panel, gets the same enable/disable + flash-row behavior for free). `t` is currently unused. |

## 4. Non-goals (this pass)

- Re-deriving `first_timestamp` for already-corrupted historical `sessions-data.json` — fix #1 only prevents *new* corruption; a one-time data repair (if wanted) is a separate, optional follow-up.
- Auditing every other adapter for the same `typeof x === 'number'` pattern beyond grok/opencode (command-code and antigravity were checked and don't share this exact defect — command-code uses `??` and downstream falsy-guards correctly; antigravity sources `created_at` as a string, not epoch ms/s).
- Resizing the force-graph canvas in lockstep with timeline collapse/expand (canvas keeps its current reserved height either way, for this pass).

## 5. Implementation order

1. `grokRecordTs` / `toIso` null-on-non-positive fix + tests (`test/grok-helpers.test.mjs`, `test/opencode-adapter.test.mjs`).
2. `buildTimeline()`: 2024-01-01 floor + left-edge clamp for earlier dots; swap per-day ticks for `xScale.ticks()`/`tickFormat()`; cap max width; add the domain-unchanged memo guard.
3. Template + CSS: make `#timeline` a collapsible widget, default collapsed; wire lazy invocation (`buildTimeline()` only runs if expanded; expanding for the first time triggers the initial build).
4. `SHORTCUTS_DEF`: add the `t` entry.
5. Tests for the pure logic that can be extracted (tick-count targeting, clamp behavior) — DOM-heavy bits stay manually verified via `node serve.mjs`.
