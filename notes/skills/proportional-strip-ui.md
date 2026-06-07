---
published: false
title: "Proportional Strip UI — Token-Weighted Context Window Visualization"
tags: [pattern, ui, visualization, cognitive-design, kaaro-design, skill]
description: "A row of variable-width strips where width encodes relative token weight, color encodes dominant tool category, and badges surface exceptions. Gives instant gestalt of where effort was spent without numbers."
date: 2026-06-07
layer: L3-Principle
maturity: BUDDING
para: SkillSurface
---

# Proportional Strip UI

## What it is

A horizontal composition of colored strips where each strip represents one
context window (segment between `compact_boundary` events). The strip's
**width** is proportional to its token weight; its **color** is the dominant
tool family; small **badges** flag exceptions (subagent spawned, extended
thinking, branch change).

```
┌────────────────┐ ⟲ ┌──────────┐ ⟲ ┌────────────────────────────────┐
│  W1            │   │  W2      │   │  W3  (current — open border)   │
│  Bash          │   │  Edit    │   │  Agent ↳2  ◉12                 │
│  14t   22k     │   │  8t  9k  │   │  31t                    112k   │
└────────────────┘   └──────────┘   └────────────────────────────────┘
```

Width conveys: "most of the work happened in window 3."
Color conveys: "window 1 was shell-heavy, window 2 was editing, window 3 was agents."

---

## Design principles (from [[kaaro-design]])

- **Width = relative weight, not absolute** — strips scale to fill the container.
  A minimum width (5%) prevents single-turn windows from vanishing.
- **Color = semantic, not decorative** — one color per tool family, shared with
  the DAW widget and the thread view's composition bar. `TOOL_COLORS` is a single
  global constant.
- **Current segment gets special treatment** — `border-left-width: 3px` vs 2px,
  no `compact_trigger` set — visually anchors "this is the live window."
- **Lazy load** — strips are computed on first expand; the `/api/trace/` result
  is cached in `window._traceCache` and shared with the thread view.

---

## Implementation

```javascript
const totalTok = segs.reduce((s, g) => s + g.tokens.output + g.tokens.cache_read, 0) || 1;

segs.map((seg, i) => {
  const tok = seg.tokens.output + seg.tokens.cache_read;
  const pct = Math.max(5, (tok / totalTok) * 100);       // width %
  const [domName] = Object.entries(seg.tool_summary)
    .sort((a, b) => b[1] - a[1])[0] ?? [null];
  const color = TOOL_COLORS[domName] || sessionColor || '#2a3a8a';
  // render strip at pct width, color bg at 10% opacity, border in full color
});
```

Key: the `|| 1` guard on `totalTok` prevents division by zero on empty segments.
Key: `Math.max(5, ...)` keeps strips legible even for near-zero-token windows.

---

## The composition bar (thread view variant)

A variant of the same idea rendered at full width inside the thread view's segment
header. Each bar segment's width is its *proportion of total tool calls* in that
window — useful when token counts are similar across windows but tool mix differs.

---

## Cognitive design rationale

The strip gives the reader a **pre-attentive** answer to "where was the work?"
before they read a single number. Color chunking lets them identify mode-shifts
(write → bash → agent) across windows at a glance. This follows the [[kaaro-design]]
principle: *data before chrome; color is grammar, not decoration.*

---

## Links

- [[kaaro-sessions-area]] — where this is implemented
- [[kaaro-design]] — the design language this follows
- [[2026-06-session-intelligence]] — the sprint that produced this pattern
