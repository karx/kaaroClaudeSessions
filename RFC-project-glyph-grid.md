# RFC: Project Glyph Grid

**Project:** kaaroSessions
**Status:** In progress (PR #13, after G1–G6 hex identity)
**Date:** 2026-08-27
**Relates to:** [RFC-project-glyphs.md](./RFC-project-glyphs.md) · brand identity · `/graph` history view · landing `/`
**Grounding:** live graph after canonical project unify; 24-ish project nodes; left dock was a packed 3-col field with no camera

---

## 1. Problem

RFC-project-glyphs gave each workspace a **hex mark** (silhouette ≠ session disk, harness fill, consumption size). That mark still lived only on the force graph.

Three things were missing for it to become identity, not decoration:

1. **The fill was a quiet 0.35 cell.** Edges showed through. Solid colour is the language we want — but only while the project is live. Stale hexes stay hollow so the grid can sit in the chrome without screaming.
2. **Placement was an auto-pack.** `glyphGrid(n)` packed `n` hexes into a tight lattice. There was no empty canvas, no user arrangement, no zoom.
3. **The left dock was a second copy of the pack**, not a camera onto a larger board. Click opened the project panel on the force graph; it did not take you to a place on a grid.

The grid is the brand surface. The force graph stays the history view. They share the mark; they do not share the layout.

---

## 2. Goals

1. **One mark language everywhere.** Same `hexPath` + harness wedges. Solid fill iff `isProjectGlyphActive` (`recencyLevel ≥ 1` or `inFlight`). Idle = hollow (canvas fill + stroke).
2. **An unbounded lattice.** The board is infinite in every direction (negative col/row). Lattice cells are drawn for the current camera, not a finite `cols × rows` sheet.
3. **Default seats are radial.** Origin first, then hex rings (first available). Saved placements win; new projects take the next empty ring cell.
4. **A large board that zooms and pans.** Expandable overlay. Drag a glyph; it snaps to a cell (no edge). Occupied cell → swap.
5. **Pin to location.** Optional: force-view project nodes use the hex relatives (scaled into the viewport). Sessions still orbit.
6. **The left dock is the minimap.** Same lattice at `r = 7`, viewport rectangle, click-through (glyph → open board on that project + panel; empty cell → pan the board there).
7. **The mark also appears** on the project detail panel (hero) and the landing page (field → `/graph#grid`).

Non-goals (this pass):

- Opaque `KAARO_TOKENS.bg` underfill under solid wedges (let the silhouette breathe; solid fill already stops see-through).
- Multi-device sync of placements (local only).

---

## 3. Mark

| State | Fill | When |
|---|---|---|
| Active | Solid harness wedges, `HARNESS_FILL_OPACITY = 1` | `recencyLevel ≥ 1` (last 2 days) or `inFlight` |
| Idle | Hollow hex, canvas fill + project-colour stroke | else |
| No harness list | Hollow even if active | `harnesses` empty |

Wedge geometry is unchanged (`harnessWedges`: 1 = solid hex, 2 = split, 3 = 120° fan, 4+ = equal-angle). Size on the **force graph** still follows `sizeNorm` (`tokens_total`). Size on the **board / minimap / landing** is the lattice radius (`r`), not consumption — identity marks are equal citizens on the grid.

---

## 4. Lattice

Pointy-top hex packing. Odd rows shift by half a column.

```
dx = r √3
dy = r · 1.5
x  = originX + col·dx + (row odd ? dx/2 : 0)
y  = originY + row·dy
```

Origin defaults to `(r, r)` so cell `(0,0)` is not clipped.

| Function | Role |
|---|---|
| `glyphCellPosition(col, row, opts)` | cell → pixels (col/row may be negative) |
| `snapToGlyphCell(x, y, opts)` | pixels → nearest cell; unbounded unless `cols`/`rows` passed |
| `glyphSpiralCell(i)` / `firstAvailableRadial` | origin, then hex rings — default seats |
| `glyphLatticeWindow({ x0,y0,x1,y1, r })` | cells covering the camera (infinite impression) |
| `mergeGlyphPlacements(ids, saved)` | saved cells win; the rest take the next empty spiral cell |
| `moveGlyphPlacement(placements, id, col, row)` | move, or **swap** if occupied |
| `scaleGlyphPins(placements, { width, height })` | hex relatives → force-view `fx`/`fy` |

`glyphGrid(n)` remains the tight pack helper for tests. The board does **not** use it as the world.

---

## 5. Board and minimap

```
┌─ #glyph-board (overlay, z 700) ──────────────────────────┐
│ chrome: PROJECT GRID · drag/zoom/esc                     │
│ SVG world: lattice (dim) + glyphs (solid/hollow) + labels│
│ d3.zoom 0.25–4 · drag glyph → snap → persist             │
└──────────────────────────────────────────────────────────┘
        ▲ click-through / viewport
┌─ #glyph-dock (minimap, z 720) ─┐
│ GRID live/total  ⤢             │
│ tiny lattice + glyphs          │
│ orange viewport rect           │
└────────────────────────────────┘
        │
        ▼ click glyph also opens #panel (z 740)
```

**Open:** `P`, dock `⤢`, landing hex → `/graph#grid`, `window.openGlyphBoard(pid?)`.
**Close:** Esc, chrome ✕.
**Persist:** `localStorage['kaaro-glyph-board']` =

```json
{
  "placements": { "<canonical project id>": { "col": 2, "row": 1 } },
  "config": { "cols": 12, "rows": 8 }
}
```

Config in the store overrides `glyphBoardConfig(n)` for cols/rows so a user's stretched board survives a reload. `r` on the board stays 22; the minimap always uses `MINI_R = 7` with the **same** cols/rows so click maps 1:1.

**Click-through**

| Minimap target | Board | Panel / graph |
|---|---|---|
| A project hex | Open (if needed) and pan to that cell | `showPanel` + `highlight` |
| Empty lattice | Open and pan to that cell | — |
| `⤢` / `P` | Toggle overlay | — |

The dock stays above the overlay so the minimap remains usable while the board is expanded.

---

## 6. Other surfaces

| Surface | Behaviour |
|---|---|
| Force graph nodes | Same active/idle fill; size still `sizeNorm`; layout unchanged |
| Project panel | Hero glyph (`r = 28`) above the title |
| Landing `/` | Field of all projects (sorted by id); click → `/graph#grid` |
| DAW page | Dock + board hidden (`display: none !important`) |

---

## 7. Files

| File | Role |
|---|---|
| `experience/client-core.mjs` | Mark + lattice math (Node-tested). No DOM. |
| `experience/client/20-glyph-board.js` | Board overlay, zoom, drag-place, minimap, hash `#grid` |
| `experience/client/04-rendering.js` | Force-graph hex uses `isProjectGlyphActive` |
| `experience/client/05-interaction.js` | Panel hero |
| `experience/client/12-controls.js` | Shortcut `P` |
| `experience/client/13-live-updates.js` | `refreshGlyphDock` after `updateGraph` |
| `experience/pages/template.html` | `#glyph-board`, `#glyph-dock`, z-index |
| `experience/pages/home.html` | Landing field |
| `test/client-core.test.mjs` | snap/inverse, lattice, merge/swap, viewport, config, SVG |

No `experience/` → `hooks/` imports. Placements key on **canonical project id** (the graph node id after RFC-project-glyphs unify).

---

## 8. Decisions

1. **Grid ≠ force layout.** The board is an overlay identity canvas. Project nodes on `/graph` keep d3-force.
2. **Solid only when active.** Idle hexes are the grid; live ones light up.
3. **Spare cells are the feature.** `glyphBoardConfig` over-provisions so placement has somewhere to go.
4. **Swap, don't stack.** Two projects do not share a cell.
5. **Minimap is the camera, not a second pack.** Same `placements` and `cols`/`rows`.
6. **No underfill this pass.** Solid wedges at opacity 1; no extra `KAARO_TOKENS.bg` disk under them.

---

## 9. Shipped vs next

**Shipped (this RFC, on `kaaro/fix/incremental-raw-ids-parity`):**

- [x] Solid / hollow mark
- [x] Configurable lattice math + tests
- [x] Zoomable board, drag-to-place, localStorage
- [x] Dock as minimap + click-through
- [x] Panel hero, landing field, `P` / `#grid`

**Next (not this PR):**

1. **Board chrome for cols/rows/r.** The lattice is already `{ cols, rows, r }`; only the defaults auto-size. A small DISPLAY control (or board chrome sliders) would make “really configurable” visible.
2. **Underfill.** If solid wedges still feel see-through at seams, paint `KAARO_TOKENS.bg` `hexPath(r)` under the wedges. Deferred on purpose.
3. **Tighter “active”.** Today `recencyLevel ≥ 1` is two days. Mission Control “active” is ~60s. Could require `recencyLevel ≥ 2` or live pulses.
4. **Deep-link a cell.** `/graph#grid&pid=…` already pans if `openGlyphBoard(pid)` runs; landing could pass the id.
5. **Force pin is opt-in** (`#cb-pin-grid`). Relatives from the hex board scale into `/graph`; it does not replace d3-force for sessions/files.

---

## 10. Success

On a live `/graph` after `node serve.mjs`:

- Left dock shows a **lattice** (empty cells visible), not a 3-wide strip, with `live/total`.
- `P` or `⤢` opens a full hex canvas; scroll zooms; drag a project; reload keeps the seat.
- Click a hex on the dock while the board is open pans the board; the right panel still opens.
- Idle projects are hollow; a project touched in the last two days is solid harness colour.
- Landing hexes go to `/graph#grid`.
- `node --test` green.
