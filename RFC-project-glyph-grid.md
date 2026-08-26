# RFC: Project Glyph Lattice

**Project:** kaaroSessions
**Status:** In progress (PR #13, canvas-layout rethink)
**Date:** 2026-08-27
**Relates to:** [RFC-project-glyphs.md](./RFC-project-glyphs.md) · brand identity · `/graph` history view · landing `/`
**Grounding:** overlay board covered the canvas and killed live chrome (DAW, timeline, pulses, ticker). Lattice is a layout on the same SVG.

---

## 1. Problem

RFC-project-glyphs gave each workspace a hex mark. The first grid pass put that mark on a **second camera**: `#glyph-board` overlay, z 700, full-viewport, its own `d3.zoom`. Switching Force → Grid was a hard cut. The overlay hid:

- the session/file graph
- live SSE pulses on nodes
- the DAW widget, timeline, ticker, stats

Pin-to-location then *rescaled* hex relatives into the force viewport (`scaleGlyphPins`), so seats jumped when a project was added.

The lattice has to be the same world as the force graph.

---

## 2. Outcome

**The hex lattice is a layout (`LAYOUT_HANDLERS.grid`), not an overlay.**

| Before | After |
|---|---|
| Full-screen `#glyph-board` SVG | Same `#canvas` / `gRoot` / named `zoom.canvas` |
| Second camera, second pan/zoom | Same d3-zoom; lattice drawn on `decorLayer` |
| Live chrome covered | DAW, timeline, ticker, SSE pulses stay |
| Hard cut Force ↔ Grid | Morph: project `fx`/`fy` already at hex seats |
| `scaleGlyphPins` fit-to-view | `glyphGraphPins` identity — cell (0,0) = canvas centre |

Sessions keep simulating. They orbit their project. Files and edges stay. The lattice is decoration under the live graph.

---

## 3. Goals

1. **One mark language everywhere.** Same `hexPath` + harness wedges. Solid fill iff `isProjectGlyphActive`. Idle = hollow.
2. **Unbounded lattice in graph space.** Negative col/row. Cells drawn for the current canvas camera (`glyphLatticeWindow`). Zoomed far out → occupied seats only (cap ~1800 paths).
3. **Default seats are radial.** Origin first, then hex rings. Saved placements win.
4. **Place/move on the canvas.** Drag a project in Lattice layout; snap to nearest hex; occupied cell swaps.
5. **Pin to location.** Lattice seats *are* the force pins (`glyphGraphPins`). Entering Lattice checks `#cb-pin-grid` so Force ↔ Lattice is a morph, not a jump.
6. **Left dock is the minimap of the same world.** Viewport rect tracks canvas zoom. Click-through pans `#canvas`, not a second board.
7. **Mark also appears** on the project panel (hero) and landing field (`/graph#grid` → `setLayout('grid')`).

Non-goals (this pass):

- Opaque `KAARO_TOKENS.bg` underfill under solid wedges.
- Multi-device sync of placements (local only).

---

## 4. Mark

| State | Fill | When |
|---|---|---|
| Active | Solid harness wedges, `HARNESS_FILL_OPACITY = 1` | `recencyLevel ≥ 1` (last 2 days) or `inFlight` |
| Idle | Hollow hex, canvas fill + project-colour stroke | else |
| No harness list | Hollow even if active | `harnesses` empty |

Wedge geometry is unchanged. Size on the **graph** still follows `sizeNorm`. Size on the **minimap / landing** is the lattice radius (`r`), not consumption.

---

## 5. Lattice (graph space)

Pointy-top hex packing. Odd rows shift by half a column.

```
dx = r √3
dy = r · 1.5
x  = originX + col·dx + (row odd ? dx/2 : 0)
y  = originY + row·dy
```

On `#canvas`, origin is **canvas centre** and `r = GLYPH_GRAPH_R` (`NODE_RADII.PR_MAX * 2`, so a project glyph sits inside its cell). Cell `(0,0)` does not move when other projects are placed.

| Function | Role |
|---|---|
| `glyphCellPosition(col, row, opts)` | cell → pixels (col/row may be negative) |
| `snapToGlyphCell(x, y, opts)` | pixels → nearest cell; unbounded unless `cols`/`rows` passed |
| `glyphSpiralCell(i)` / `firstAvailableRadial` | origin, then hex rings — default seats |
| `glyphLatticeWindow({ x0,y0,x1,y1, r })` | cells covering the camera |
| `mergeGlyphPlacements(ids, saved)` | saved cells win; the rest take the next empty spiral cell |
| `moveGlyphPlacement(placements, id, col, row)` | move, or **swap** if occupied |
| `glyphGraphConfig(W, H)` | `{ r, originX: W/2, originY: H/2 }` |
| `glyphGraphPins(placements, { width, height })` | identity seats for `fx`/`fy` |
| `graphRectToMinimap(rect, …)` | canvas camera → dock viewport rect |
| `scaleGlyphPins` | kept (centroid-fit); **not** used for canvas pins |

`glyphGrid(n)` remains the tight pack helper for tests.

---

## 6. Layout and minimap

```
#canvas  (same SVG, zoom.canvas + zoom.grid + zoom.minimap)
  decorLayer   lattice hairlines (vector-effect: non-scaling-stroke)
  edgeLayer    membership / file edges — live
  nodeLayer    project hexes + sessions + files — live, simulating
  labelLayer   project labels
#timeline / #daw-widget / #pulse-ticker / #stats  unchanged
┌─ #glyph-dock (minimap) ─┐
│ GRID live/total  ⤢      │
│ tiny lattice + glyphs   │
│ orange viewport rect    │
└─────────────────────────┘
```

**Enter Lattice:** `P`, layout bar **Lattice**, dock `⤢`, landing hex → `/graph#grid`. Checks pin-to-lattice, unchecks free layout, pins projects, draws hexes, keeps the simulation.

**Leave:** `P` again, **Force**, or another layout. Lattice paths come off `decorLayer`. Pins stay if `#cb-pin-grid` is on.

**Persist:** `localStorage['kaaro-glyph-board']` =

```json
{
  "placements": { "<canonical project id>": { "col": 2, "row": 1 } }
}
```

**Click-through**

| Minimap target | Canvas | Panel |
|---|---|---|
| A project hex | Lattice layout + pan to that seat | `showPanel` + `highlight` |
| Empty lattice | Lattice layout + pan to that cell | — |
| `⤢` / `P` | Toggle Lattice ↔ Force | — |

---

## 7. Other surfaces

| Surface | Behaviour |
|---|---|
| Force graph nodes | Same active/idle fill; size still `sizeNorm`; optional pin-to-lattice |
| Lattice layout | Same nodes, lattice under them, drag-snap projects |
| Project panel | Hero glyph (`r = 28`) above the title |
| Landing `/` | Field of all projects; click → `/graph#grid` |
| DAW page | Dock hidden (`display: none !important`) |

---

## 8. Files

| File | Role |
|---|---|
| `experience/client-core.mjs` | Mark + lattice math (Node-tested). No DOM. |
| `experience/client/20-glyph-board.js` | Lattice on `decorLayer`, minimap, persist, `glyphBoardPins` |
| `experience/client/11-layout-manager.js` | `LAYOUT_HANDLERS.grid` |
| `experience/client/02-canvas.js` | Named `zoom.canvas` so `zoom.grid` can coexist |
| `experience/client/04-rendering.js` | `isSimLayout()` (force + grid) |
| `experience/client/05-interaction.js` | Drag-snap in lattice; cluster toggle on sim layouts |
| `experience/client/06-force-layout.js` | Pins when lattice *or* `#cb-pin-grid` |
| `experience/client/12-controls.js` | Shortcut `P` = toggle lattice |
| `experience/pages/template.html` | Lattice button, dock, no overlay |
| `experience/pages/home.html` | Landing field |
| `test/client-core.test.mjs` | snap/inverse, graph pins, minimap rect, shared controls |

No `experience/` → `hooks/` imports. Placements key on **canonical project id**.

---

## 9. Decisions

1. **Lattice is a layout.** Same canvas as Force. Overlay is gone.
2. **Identity pins, not scale-to-fit.** Adding a project must not slide the others.
3. **Solid only when active.** Idle hexes are the grid; live ones light up.
4. **Swap, don't stack.** Two projects do not share a cell.
5. **Minimap is the camera, not a second pack.** Same `placements`; viewport is the canvas zoom.
6. **Simulation stays on.** Sessions, pulses, DAW, timeline are the live view.
7. **No underfill this pass.** Solid wedges at opacity 1.

---

## 10. Shipped vs next

**Shipped (this RFC, on `kaaro/fix/incremental-raw-ids-parity`):**

- [x] Solid / hollow mark
- [x] Unbounded lattice math + radial default seats
- [x] Lattice as `LAYOUT_HANDLERS.grid` on `#canvas`
- [x] Drag-to-place on the graph, localStorage
- [x] Dock as minimap of the same world
- [x] Pin-to-lattice = identity seats (Force ↔ Lattice morph)
- [x] Panel hero, landing field, `P` / `#grid`

**Next (not this PR):**

1. Underfill `KAARO_TOKENS.bg` if solid wedges still feel see-through at seams.
2. Tighter “active” (Mission Control ~60s vs recencyLevel ≥ 1).
3. Deep-link `/graph#grid&pid=…`.
4. Coarser lattice when zoomed far out (draw rings instead of dropping to occupied-only).

---

## 11. Success

On a live `/graph` after `node serve.mjs`:

- Force → Lattice: projects slide onto hex seats (or stay, if already pinned); sessions keep orbiting; DAW / timeline / ticker still visible.
- Lattice → Force with pin on: lattice hairlines leave; seats do not jump.
- Drag a project on the lattice; it snaps; reload keeps the seat; Force pin uses the same seat.
- Left dock shows a lattice with `live/total`; click pans the **canvas**.
- Idle projects hollow; last-two-days solid harness colour.
- Landing hexes go to `/graph#grid`.
- `node --test` green.
