# Spatial plotting of agent work

**Project:** kaaroSessions
**Date:** 2026-08-31
**Status:** Learning + current function + vision. Implementation lives on `feat/project-city` (city v1) and earlier glyph/lattice work. This is not a PR plan.
**Relates to:** [RFC-project-glyphs.md](../RFC-project-glyphs.md) · [RFC-project-glyph-grid.md](../RFC-project-glyph-grid.md) · [RFC-project-city.md](../RFC-project-city.md) · [RFC-share-cards.md](../RFC-share-cards.md) · [RFC-me-share-card.md](../RFC-me-share-card.md) · [GRAPH-PERFORMANCE-REQUIREMENT.md](./GRAPH-PERFORMANCE-REQUIREMENT.md)

---

A stranger — or future-you, six months cold — looking at the still should be able to say:

> **these are the worlds, where I placed them, who touched them, how many runs, how fat the work was, what we actually edited.**

That sentence is the product. Everything else is how we plot it.

kaaroSessions is not a file tree, not a git map, and not a prettier force graph. It is a **cadastral map of agent work**: projects as plots, sessions as days stacked on those plots, harnesses as who farmed them, tools as the verbs that happened, files as the working set that was actually touched.

---

## 1. Learning

These are the things we had to be wrong about first.

### 1.1 Seats are a user document

The only spatial memory the user is allowed to write is `{ col, row }` in `localStorage['kaaro-glyph-board']`. Drag a project in Lattice, snap to a hex, persist. That is a **seat**.

Landing and the usage PNG used to ignore the board and mint a second geography (`glyphSpiralCell` from tokens-desc / diversity). Two maps of the same worlds. The PNG and `/` lied about *where you put them*.

**Lock:** one placement pipeline. Missing seats fall back to radial hex rings (`mergeGlyphPlacements`), ids sorted `id` asc so Lattice / share / landing cannot desync. Fit into a card with `fitCityToField` (projected AABB). Do not `scaleGlyphPins` then iso.

### 1.2 Force is forensic, not the portrait

`d3.forceManyBody` + `forceCollide` on hundreds of nodes, default-on file diamonds, infinite CSS `.pring`, SSE `updated` → join + sim restart. Measured cost: hundreds of file nodes, ~1k edges. A stranger does not need that to read “these are my worlds.”

Force remains the **microscope**: membership, file edges, session satellites, live pulses. It is not the landing, and it is not the default of `/graph`.

**Lock:** `/` is the city at rest (zero d3-force). `/graph` opens Lattice. `#force` (or the Force control) is the forensic layout. Do not extrude buildings with the force sim.

### 1.3 A project is a plot, not a planet with moons

Session disks orbiting a hollow ring said “satellite.” The truth is: you picked a plot, then stacked runs on it.

| City word | Data |
|---|---|
| Seat | user `{ col, row }`, else radial default |
| Footprint | `sizeNorm` — consumption (`tokens_total`, else `tool_calls`) |
| Height / slabs | `session_count` — oldest at the base, newest at the roof, cap 12 |
| Facade mix | weighted harness wedges (session count per harness, not equal pie) |
| Roof ring | `recencyLevel` — which worlds are still warm |
| Ground diamonds | **working set** — Read / Write / Edit, not Glob inventory |
| Short name | `humanizeProjectLabel` on the heaviest plots only |

A building is a stack of days on a plot you picked. That is more true than a ball.

### 1.4 Do not encode the same count twice, and do not lie with one axis

The usage card’s double-spiral (session **balls** sized by `tool_diversity` + project **hexes** sized by `sizeNorm`) showed both counts and corresponded to nothing. Two spirals cannot dock. Session count as a second mark family is texture that fights the hexes.

Height *is* the session count. Footprint is volume. A 17-run world at 7M tokens is not the same mass as a 21-run world at 58M. Size both axes by `session_count` and the city lies. Retarget footprint to `tokens_work` and cache-read worlds shrink for the wrong reason.

**Lock:** one mark, two orthogonal axes, on the seats you already chose.

### 1.5 Working set ≠ inventory

Graph file nodes come from `FILE_OP_TOOLS` (Read / Write / Edit and harness aliases). `list_dir` / `Glob` / `Grep` do **not** populate `file_ops`. A diamond is “we actually touched this,” not “the agent could have listed this.”

Legend used to say “File (size = edits)” as if complete. v1 names it: **working set (write+edit) — not a full tree.** `#cb-files` starts **off**. Read-only files stay a separate checkbox, inert while files are off. Do not auto-toggle the checkbox when switching Lattice ↔ Force.

City diamonds: ≤6 per plot, sized by write+edit weight, unlabeled on the PNG (paths are private). Landing: diamonds off until a building is selected.

### 1.6 Idle-hollow is live-dock grammar; city buildings are solid

On the **minimap / dock**, idle projects are hollow hexes; live ones (`recencyLevel ≥ 1` or in-flight) are solid harness fill. That is a heartbeat. Do not draw 12-slab buildings at `r = 7`.

City buildings (Lattice canvas, landing, usage PNG) are **always solid** (`forceSolid`). Recency is a roof ring, not a hollow cell. Mixing the two grammars on one surface made idle worlds look unbuilt.

### 1.7 Harness mix is weighted or it lies

Equal-angle wedges on a 10-Pi + 1-Grok world read 50/50. Weighted wedges (session count) read 91/9. Who touched the plot is a **proportion of runs**, not a set membership badge.

Tokenless harnesses (Command Code, some Copilot) still get a seat and a facade. Footprint falls back to `tool_calls`. They can still show a working set if write+edit edges exist.

### 1.8 Tools are verbs, not land

Tools never became first-class spatial nodes. That is intentional.

A tool call is an **event**: it colors an edge (write / edit / read), sizes a session (`tokens_work` / `tool_calls`), fills a context-window strip (`dominantTool`), and hits the DAW. Plotting every Bash/Read as a vertex would be a call graph, not a cadastral map.

The spatial question for tools is “what did this run *do to the plot*?” — working-set diamonds + edge types — not “where does Grep live.”

### 1.9 Geometry is functions with fixtures, not sketches

`cellR` (lattice pitch), `hexR` (footprint, 0.42–0.55 of cellR), `dy` / `slabH` (height locked to neighbour pitch) are different numbers. 0.82·cellR overlapping odd-row roofs was a pretty lie. Isometric faces are SW / E / SE, farthest-first. Paint order is projected `y`, not `col+row`. Census integers (`23` projects, `108` sessions) drift; tests use factories.

### 1.10 Identity is still split, and the city will show the twins

Pi wraps `--D--src-name--`. Grok worktree ids (`subagent-01a053…`) land as their own plots. Command Code can emit `users-<user>-<path>`. Canonical merge is a **different RFC**. Until then the city is honest about the data smell: two buildings for one folder is a data bug you can see, not one we hide.

---

## 2. What gets a mark

The graph payload (`buildGraph` → `graph-data.json`) is the only spatial input. Experience never imports `hooks/`.

| Atom | Graph type | Primitive | What it means |
|---|---|---|---|
| **World / project** | `project` | hex, then **building** on a seat | A workspace. One node per `project_id` (canonical when the orchestrator unified it). |
| **Run / session** | `session` | filled circle (Force); **slab** (city) | One JSONL / one agent run. Sized by consumption. Membership edge → project. |
| **Harness** | not a node | wedge colour inside the hex / roof | Which agent touched the world, in proportion of sessions. |
| **Tool** | not a node | edge type, strip colour, DAW pulse, `tools_top` | A verb. See §4. |
| **File** | `file` | diamond | Working-set path with Read/Write/Edit. Size `√(write+edit)`. |
| **Cluster** | `cluster` | dashed circle + count | Bundled sessions (Jaccard of files + titles). Force-only. |
| **Subagent** | `subagent` | small hollow ring | Spawned child. Opt-in. Not a session. |
| **ME** | not a graph node | large hex, session-count wedges | The person. Lives in the dock and the landing hero, **not** in the city field. |

### Tools, spatially

| Surface | How a tool appears |
|---|---|
| Force / Lattice | Edge: write (solid green), edit (yellow), read (dotted). Thickness = visit frequency. |
| City / landing / PNG | Indirect: diamonds only for write+edit working set. No tool-name labels. |
| Session panel | `tools_top` bar chart. |
| Context strip / thread | Dominant tool colours the window; each turn lists tool inputs. |
| Swimlane | Bar height can be `tool_calls`. |
| Matrix | Cell colour = edit / write / read-only at file × session. |
| DAW / SSE | Pulse per `tool_call` — sonic, not spatial. |

`list_dir` / `Glob` / `Grep` are audible and countable. They do not mint file nodes.

### Files, spatially

- **Inventory** (do not plot as complete): anything a listing tool could return.
- **Working set** (plot): paths credited through `FILE_OP_TOOLS`.
- Force: optional diamonds, off by default.
- City: ≤6 diamonds at hex vertices, on Lattice always; on landing only for `selectedId`; on the PNG unlabeled, in building colour (privacy: no basenames on a still you might share).

---

## 3. Functionalities (what ships)

### 3.1 Surfaces

| URL | Spatial job |
|---|---|
| **`/` landing** | City at rest. ME hero above. Click a building = select (diamonds + short label). Double-click / OPEN LATTICE / `g` → `/graph`. Zero force. |
| **`/graph` default = Lattice** | Same `#canvas` as Force. Buildings on identity seats (`glyphGraphPins`). Session satellites still orbit. Dock minimap stays hollow glyphs. |
| **`/graph#force`** | Forensic hexes + disks + optional files. Physics. Live SSE pulses. |
| **Swimlane** | Time. Sessions as Gantt bars; optional git-branch sub-rows. Height = tokens / calls / duration / errors. |
| **Arc** | Temporal coupling. Sessions on a time spine; file co-access as arcs; hub list. |
| **Matrix** | File × session co-occurrence. Cells are ops, not geography. |
| **3D** | ForceGraph3D of the same nodes. Spheres, not towers. Untouched by city v1. |
| **Usage share card** | 1200×630 PNG. City fitted into the left field; ME + epithet + stats on the right. Card *is* the artifact (no public URL). |
| **Session / project cards** | Not city. Context-window strip; harness bars. |

Keyboard on `/graph`: `P` Lattice ↔ Force, `F` Force, `S` Swimlane, `A` Arc, `M` Matrix, `G` 3D. Hash: `#force` / `#swimlane` / `#arc` / `#matrix` / `#3d` boot that layout; anything else (including `#grid`) boots Lattice.

### 3.2 Lattice (cadastral map)

- Pointy-top hex packing, unbounded (`col`/`row` may be negative). Cell `(0,0)` is canvas centre. `r = GLYPH_GRAPH_R`.
- Default seats: origin, then hex rings. Saved placements win; move onto an occupied cell **swaps**.
- Same camera as Force (`zoom.canvas`). Decor hairlines on `decorLayer`. Pin-to-lattice so Force ↔ Lattice is a morph, not a jump.
- Project marks in Lattice are **2D buildings** (`cityBuildingMarkup({ iso: false })`), not hollow hexes. Recency circles skipped — the roof owns warmth.
- Drag-snap still writes `kaaro-glyph-board` and rebuilds `window._cityData`.
- Minimap: `projectGlyphFieldSvg` at `MINI_R = 7`, idle-hollow, viewport rect. Click pans the canvas.

### 3.3 City payload (one helper, four readers)

`buildCityData({ projects, sessions, files, edges, placements })` in `experience/client-core.mjs` — a helper like `meGlyph`, not a second PNG assembler.

Readers: usage card, landing `cityFieldSvg`, Lattice `renderNodeContent`, (later) GLTF stdin.

- Every project gets a building (no cap inside the helper; share/landing slice).
- Slabs oldest → newest; cap 12 with overflow `+N` on the roof.
- Weighted `harnessWedgePts` → isometric wedges on the PNG / landing; 2D `harnessWedges` on Lattice.
- Iso 30° (`isoProject`), visible faces SW, E, SE. Landing / PNG isometric; Lattice flat stack.

### 3.4 Force (the microscope)

Still the full graph: projects as hexes (not buildings), sessions as disks, files as diamonds, clusters, spawn rings. Edges: membership, bundle, write, edit, read, branch, spawn.

Filters: date, harness, project, min-sessions, bundle on/off, working-set nodes, read-only files, branch lineage, read edges, subagent spawns. Live `updated` rebuilds the join.

### 3.5 Copy that tells the truth

| Place | Text |
|---|---|
| Legend project | footprint = consumption · height = sessions |
| Legend session | size = consumption |
| Legend file | Working set (write+edit) — not a full tree |
| `#cb-files` | Working-set nodes, **unchecked** |
| Boot L2 | `N projects · N sessions · N working-set files` |
| Landing graph tile | Sessions and projects, laid out in time. Force graph is forensic. |
| Usage caption | footprint = consumption · height = sessions · diamonds = working set |

---

## 4. Encoding cheat-sheet

| You want to know | Look at |
|---|---|
| Where I put this world | Lattice seat / city plot |
| How fat the work was | Building footprint / hex `sizeNorm` |
| How many runs | Building height (slabs), overflow `+N` |
| Which agents | Wedge mix (weighted) |
| Which worlds are warm | Roof ring / idle-hollow on the dock |
| What we edited | Diamonds (select on `/`; checkbox on `/graph`) |
| What a run did, step by step | Force session → panel → context strip → thread |
| What is happening *now* | `/now`, DAW, SSE pulses — not the city |
| Who I am on this machine | ME hex + epithet on landing / usage card |

Two axes that must stay orthogonal:

```
footprint  =  tokens_total  else  tool_calls     (volume)
height     =  session_count  (capped)            (runs)
```

---

## 5. Vision

### 5.1 The city is the view that does not need the graph

`/` and the usage still are the portrait. `/graph` Lattice is the same portrait you can walk and rearrange. Force is the drawer of evidence.

Over time, session satellites on Lattice should leave when they get in the way. The building already *is* the runs. Orbiting disks are a Force habit, kept in v1 so the morph to Force still has something to pin.

### 5.2 One geography, many stills

Seats you chose → city payload → SVG here, PNG there, maybe a `.glb` souvenir later. No second spiral, no Imagine-as-mesh, no runtime npm, no `fetch` of `~/.kaaro`. If the GLB is missing, SVG still works.

**E1 (optional):** `scripts/project-glyph-gltf.mjs` — one `CityBuilding` JSON in, one hex-prism GLB out. Collectible of a world, like the PNG is a collectible of a census.

**E2 (later RFC):** ForceGraph3D `nodeThreeObject` swapping spheres for towers. Not v1. Do not sneak it into `/` or the share card.

### 5.3 Tools earn spatial rights only as effects on plots

A future tool map (kind-map is coverage, not geography) should not become a node type on the city. If tools get a spatial encoding, it is:

- richer working-set (maybe promote search/listing behind a new op + a cap), or
- facade / slab tint from dominant tool family,

not a skyline of Bash towers. Verbs stay verbs. The DAW already lets you *hear* them.

### 5.4 Identity merge is a gift to the city, not a city feature

When Pi wrappers, Grok worktrees, and Command Code `users-*` collapse into one plot, buildings merge and seats need a rule (keep the user seat of the canonical id; drop the twin). That work belongs in an identity RFC. The city will just look less like a duplicate skyline.

### 5.5 Files stay a working set until we decide they are a tree

Showing 400 diamonds is how Force became forensic. The city shows six. A later “open the plot” mode can reveal more of that world’s working set without dumping the repo tree. Glob-complete inventory is a different product.

### 5.6 ME stays out of the field

The person is the right-column / landing hero. Putting ME back in the city (share-cards v1) was a colour collision and a category error. The city names the worlds. The epithet names the operator.

---

## 6. Non-goals (do not reopen here)

- Sizing both footprint and height by session count.
- Footprint = `tokens_work` in v1 (payload carries it; no control).
- Auto-hiding `#cb-files` on layout change.
- d3-force extrusion; WebGL on `/` or the PNG.
- Experience importing `hooks/`; runtime npm; Imagine-as-mesh.
- Merging worktree / `users-*` twins.
- Promoting `list_dir` / `Glob` / `Grep` into `file_ops` without a new op + cap.
- Fabricated public URL for the card.

---

## 7. Where the code is

| Concern | Place |
|---|---|
| City geometry + payload | `experience/client-core.mjs` (`isoProject`, `buildCityData`, `cityBuildingMarkup`, `cityFieldSvg`, `fitCityToField`, `workingSetForProject`) |
| Lattice seats + boot | `experience/client/20-glyph-board.js` |
| 2D buildings on `/graph` | `experience/client/04-rendering.js` (`currentLayout === 'grid'`) |
| Layout switch | `experience/client/11-layout-manager.js` |
| Usage PNG caller | `experience/client/21-share-card.js` (reads `kaaro-glyph-board`) |
| Landing city | `experience/pages/home.html` |
| Legend / files checkbox | `experience/pages/template.html` |
| Graph atoms | `experience/graph-pipeline.mjs`, `experience/graph-data.mjs` |
| What counts as a file op | `hooks/session-reducer.mjs` `FILE_OP_TOOLS` |
| Tests | `test/city.test.mjs`, `test/city-surfaces.test.mjs` |

The force graph was the first answer to “show my agent work.” The lattice was the first answer to “let me place my worlds.” The city is the first answer to “let a still tell the truth about those worlds.” Force keeps the evidence. The map is the product.
