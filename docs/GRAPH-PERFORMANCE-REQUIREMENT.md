# Requirement: `/graph` performance measurement

**ID:** REQ-GRAPH-PERF-01  
**Project:** kaaroSessions  
**Status:** Open — assigned to a measurement engineer, not the glyph implementer  
**Date:** 2026-08-25  
**Relates to:** [PR #11](https://github.com/karx/kaaroSessions/pull/11) · `RFC-project-glyphs.md` · follow-up units F5/F6  
**Branch:** `kaaro/feat/project-glyphs`  
**Owner of product code:** PR #11 author  
**Owner of this requirement:** the engineer running test / trace / performance monitoring

This is a **measurement contract**. You verify the page does not overwhelm. You do not redesign the graph unless a gate fails and F9 is filed.

---

## 1. Why this exists

The history view (`GET /graph`) is an SVG force graph. Live snapshot on the authoring machine (2026-08-25):

| | count |
|---|---|
| nodes | ~718 (22 project · ~100 session · ~8 cluster · ~585 file) |
| edges | ~1150 |
| `graph.html` | ~790 KB (self-contained bundle) |

Hex wedges are cheap (≤7 paths × 22 projects). The cost is:

1. **d3-force** `forceManyBody` + `forceCollide` on hundreds of nodes.
2. **Infinite CSS** `.pring` (`animation: pulse-ring linear infinite`).
3. **Default-on file diamonds** (`#cb-files`, `#cb-ro-files`, `minSessions = 1`).
4. **SSE `updated`** → `window.updateGraph` → join + sim restart.

PR #11 already shipped mitigations. This requirement **proves** them on a real Chrome, with traces you can attach.

| Mitigation | Code | Claim to verify |
|---|---|---|
| `SIM_ALPHA_DECAY = 0.02` | `experience/client-core.mjs` → `03-simulation.js` | alpha hits `alphaMin` in ≤ 6s (was ~19s at 0.006) |
| recencyLevel 1 = static hairline | `04-rendering.js` | no infinite `.pring` on “&lt; 2 days” nodes |
| one `.pring` from level 2 | same | not two rings at level 3 |
| `html.k-hidden .pring { animation-play-state: paused }` | `template.html` + visibility listener | tab-hide stops compositing |
| `@media (prefers-reduced-motion: reduce)` | `template.html` | no pulse animation |
| join `update` re-renders interiors | `04-rendering.js` `joinNodes` | SSE does not leak detached `<g.node>` |

---

## 2. Scope

**In:**

| Surface | URL | Why |
|---|---|---|
| History force graph | `GET /graph` (legacy `GET /graph.html`) | primary cost |
| Live SSE | `GET /events` | `updated` / pulse / `now` |
| Debug status | `GET /status` | `{ rebuilding, lastBuilt, clients, port }` |

**Out (unless a gate fails and you note it):**

- `/now` Mission Control, `/daw` DAW — different DOM; log FPS only if you have time.
- 3D layout (`#layout-3d`) — ForceGraph3D is a separate WebGL budget; one optional pass, not a blocker.
- Swimlane / arc / matrix — stop the force sim on enter (`11-layout-manager.js`); not the load-jank path.
- Product changes: default `minSessions`, file-checkbox defaults, canvas rewrite, hex-in-3D.

**Pages to ignore for this REQ:** `/`, `/home` landing.

---

## 3. Environment

```bash
# from the glyphs worktree / this branch
node serve.mjs --port=3335 --no-open
```

Wait until the terminal prints `kaaro-sessions → http://localhost:3335` **and** `GET /status` shows `"rebuilding": false`.

Then Chrome (not headless for the official run):

```
http://localhost:3335/graph
```

**Machine notes to record in the report:** OS, Chrome version, CPU class, available RAM, whether a second `serve` / analyze is running. Do not run this while another agent is tailing Grok `updates.jsonl` — rebuild storms invalidate idle numbers.

**Graph size to record from the stats strip** (bottom of `/graph`): projects · sessions · bundles · files · edges · date range. Gates are for this order of magnitude (~700 nodes). If your dump is &lt;200 nodes, say so; gates do not apply.

---

## 4. Allowed instrumentation (measurement only)

You may add **debug-only** hooks so traces have marks. Keep them behind a query flag. Do not change layout, opacity, or decay.

Suggested (optional) seam — only if DevTools console polling is too noisy:

```
# /graph?perf=1
```

If `location.search` contains `perf=1`, it is acceptable to:

1. Expose `window.__kaaroPerf = { simulation, getAlpha() { return simulation.alpha(); } }` from `03-simulation.js`.
2. `performance.mark('kaaro:graph-boot')` in `bootComplete` (`00-boot.js`).
3. `performance.mark('kaaro:sim-end')` on `simulation.on('end', …)` and `performance.measure('kaaro:sim-settle', 'kaaro:graph-boot', 'kaaro:sim-end')`.
4. `performance.mark('kaaro:sse-updated')` at the start of `window.updateGraph`.

These marks must be **no-ops** when `perf=1` is absent. If you add them, one commit, tests only if you extract a tiny `wantPerf()` helper. Product behavior unchanged.

Console-only is also fine:

```js
// in DevTools console on /graph
setInterval(() => console.log('alpha', simulation.alpha()), 250);
```

`simulation` is **not** currently on `window`. Without `perf=1`, use Performance panel + the FPS meter; do not spend the REQ hunting a global.

---

## 5. Protocol (do in this order)

Use a **fresh Chrome profile** or Incognito with extensions disabled. DevTools docked; **Performance** + **Memory** + **Rendering**.

### 5.1 Rendering overlays (leave on for all passes)

DevTools → ⋮ → More tools → Rendering:

- [ ] Frame Rendering Stats (FPS meter)
- [ ] Paint flashing
- [ ] Layer borders

Screenshot the FPS meter at settle and at idle +60s.

### 5.2 Pass A — Load → settle (Performance)

1. Open `/graph`, wait for boot overlay to dismiss (`bootComplete`).
2. Start **Performance** recording (CPU 1×, Screenshots on, Memory checkbox on).
3. Hard reload (`Ctrl+Shift+R`).
4. Stop ~2s after the graph visually stops drifting **or** at 12s, whichever first.
5. Save the `.json` trace as `perf-load-settle.json`.

Extract:

| Metric | Where |
|---|---|
| Time to first paint / LCP-ish | Timings track |
| Scripting ms 0→settle | Main thread Summary |
| Rendering + Painting ms | same |
| FPS during the first 3s | Frames / FPS meter |
| Time until main-thread scripting drops to idle | last long `d3.timer` / `requestAnimationFrame` burst |
| JS heap at end of recording | Memory track |

**Settle definition:** force `alpha` &lt; d3 `alphaMin` (default 0.001), **or** no `&gt;8ms` scripting frames for 500ms, **or** nodes no longer visibly moving — pick one and use it for both this run and the report.

**Gate A:** settle ≤ **6 seconds** after reload on the force layout. Claim from F6: `ln(0.001)/-0.02 ≈ 345` ticks ≈ 5.8s at 60fps.

### 5.3 Pass B — Idle 60s (Performance + Rendering)

1. After settle, start a new Performance recording.
2. Do not interact. Leave the tab **visible**.
3. Stop at 60s. Save `perf-idle-60s.json`.
4. Note paint flashing: should be **quiet** except `.pring` on in-flight / recencyLevel ≥ 2 nodes.

**Gate B:**

- Idle scripting ≈ 0 except EventSource (`/events`) and the ticker. No continuous `tick` transform storm.
- FPS ≥ **50** (meter).
- Paint flashing not a full-canvas strobe.

### 5.4 Pass C — Hidden tab

1. With Rendering → layer borders on, switch to another tab for 10s.
2. Confirm `.pring` layers stop updating (`html.k-hidden`).
3. Switch back; pulses resume for in-flight / hot recency only.

**Gate C:** hidden tab does not keep compositing pulse rings. Qualitative pass/fail + screenshot.

### 5.5 Pass D — Memory

DevTools → Memory:

1. At settle: **Heap snapshot** → `heap-settle.heapsnapshot`. Record JS heap MB, `SVG*Element` count (filter Snapshot by `SVG`).
2. Wait **2 minutes** idle, visible tab: second snapshot `heap-idle-2min.heapsnapshot`.
3. Trigger one graph rebuild: edit a tiny session or wait for `event: updated`, **or** `fetch('/graph-data.json')` then `updateGraph` if you have the hook. Third snapshot `heap-after-sse.heapsnapshot`.
4. Compare snapshot 1 vs 3: search **Detached** HTML/SVG. `<g.node>` from the previous join must be gone.

**Gate D:**

- Heap at +2 min ≤ settle heap **+ 10%**.
- SSE `updated` does not leave detached `<g.node>` / orphaned `path.pring`.
- If `SVG*Element` from `type: file` is **&gt; 50%** of SVG nodes **and** Gate B fails, file **F9** (do not silently change defaults).

### 5.6 Pass E — Interaction (short)

Record 10s while:

1. Drag one session node (sim `alphaTarget(0.3)` then 0).
2. Toggle `#cb-files` off, then on (`applyFilters` restats `simulation.nodes`).
3. Open a project hex → detail panel (HARNESSES + Consumption). Close.

**Gate E:** drag feels live; files-off should drop scripting immediately (fewer nodes in the sim). Panel open does not restart the sim.

### 5.7 Optional — 3D

Switch to 3D once. Note GPU memory / FPS. **Not a gate.** WebGL spheres are out of the hex RFC.

---

## 6. Trace artifacts (what to hand back)

Attach to the PR comment or a gist (heap snapshots are large — link, don’t paste):

```
perf-load-settle.json
perf-idle-60s.json
heap-settle.heapsnapshot
heap-idle-2min.heapsnapshot
heap-after-sse.heapsnapshot
screenshots: fps-settle, fps-idle, layers-pring, panel-project
```

Report table (fill every cell):

```
Machine: …
Chrome: …
Graph stats strip: … projects · … sessions · … files · … edges
GET /status at start: rebuilding=false, lastBuilt=…

Pass A settle_s: …
Pass A scripting_ms: …
Pass A fps_first_3s: …
Pass B idle_fps: …
Pass B idle_scripting: none | sse-only | tick-storm (FAIL)
Pass C hidden_pring_paused: yes | no
Pass D heap_settle_MB: …
Pass D heap_plus2min_MB: …
Pass D delta_pct: …
Pass D detached_g_node_after_sse: 0 | N (FAIL if N>0)
Pass D svg_file_share_pct: …
Pass E files_off_helps: yes | no
F9 recommended: no | yes (reason)
```

Verdict: **PASS** / **FAIL** per gate A–E. One FAIL = REQ not met; product code stays frozen except a new TDD unit.

---

## 7. F9 (only if measurement says so)

Open a follow-up unit **only if**:

- Gate B fails after F5/F6, **and**
- file SVG nodes &gt; 50% of SVG elements.

Then, and only then: raise default `minSessions` to 2 **or** uncheck `#cb-ro-files` by default. Own tests in `test/build.test.mjs` / template default. Not part of this REQ’s commit.

---

## 8. What you must not do

- Change `SIM_ALPHA_DECAY`, `HARNESS_FILL_OPACITY`, collision padding, or file defaults “to make the trace look better” without a failing gate + a unit.
- Rewrite SVG → canvas in this assignment.
- Use Lighthouse mobile as the only evidence (this is a desktop force graph; Lighthouse is optional extra).
- Run the official numbers in headless Chrome. Headless previously failed to load `chrome.dll` on the authoring machine; the contract is a **headed** DevTools session.

---

## 9. Related code map

| Concern | File |
|---|---|
| `SIM_ALPHA_DECAY` | `experience/client-core.mjs` |
| force sim | `experience/client/03-simulation.js` |
| node SVG / `.pring` / join update | `experience/client/04-rendering.js` |
| filters drop hidden nodes from sim | `experience/client/12-controls.js` `applyFilters` |
| SSE `updateGraph` | `experience/client/13-live-updates.js` |
| pulse CSS / `k-hidden` | `experience/pages/template.html` |
| live rebuild / SSE hub | `surface/sse-hub.mjs`, `serve.mjs` |
| status JSON | `GET /status` |

`experience/` must not import `hooks/`. Measurement hooks stay in `experience/client/*`.

---

## 10. Success

REQ-GRAPH-PERF-01 is done when the report in §6 is posted on PR #11 (or a follow-up issue) with artifacts, every gate marked PASS or FAIL, and F9 either explicitly **not recommended** or filed as its own unit. No silent product edits.
