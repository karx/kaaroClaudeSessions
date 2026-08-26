/**
 * experience/client-core.mjs — shared browser core for every page
 * (graph, Mission Control, DAW): formatters, color vocabulary, geometry,
 * SSE wiring. The single source of truth for helpers that were previously
 * triplicated across 01-data.js, 05-interaction.js, 16-beat-overlay.js,
 * 19-daw-builder.js, and now.html.
 *
 * SYNTAX CONTRACT: only `export function` / `export const` at top level —
 * build.mjs strips the `export ` prefix and injects the body into page
 * bundles via the CLIENT_CORE placeholder, so this file must also be valid
 * plain script. Node tests import it as a normal ESM module.
 */

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtTok(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k';
  return String(n);
}

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtAgo(sec) {
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm' + (sec % 60) + 's';
  return Math.floor(sec / 3600) + 'h' + Math.floor((sec % 3600) / 60) + 'm';
}

// ── Color vocabulary (color is grammar — one meaning per hue) ────────────────

export const TOOL_COLORS = {
  Write: '#00bb55', Edit: '#ccaa00', Read: '#2a5c8a',
  Bash: '#cc6622', Shell: '#cc6622', PowerShell: '#cc6622',
  Grep: '#7733aa', Glob: '#7733aa', Agent: '#cc2244', Task: '#cc2244',
  ToolSearch: '#6644aa', WebFetch: '#336688', WebSearch: '#336688',
};

export const TOOL_COLORS_LC = Object.fromEntries(
  Object.entries(TOOL_COLORS).map(([k, v]) => [k.toLowerCase(), v])
);

/** Case-insensitive tool → color; null for unknown tools. */
export function toolColor(tool) {
  return TOOL_COLORS_LC[(tool || '').toLowerCase()] ?? null;
}

export const EDGE_COLORS  = { membership: '#1e3d7a', write: '#00ff88', edit: '#ffcc00', read: '#1e4a66', branch: '#334455', bundle: '#4a3a7a' };
export const EDGE_OPACITY = { membership: .55, write: .65, edit: .65, read: .28, branch: .4, bundle: .45 };
export const EDGE_WIDTH   = { membership: 1.4, write: 1, edit: 1, read: .7, branch: .8, bundle: 1 };

// ── Geometry ──────────────────────────────────────────────────────────────────

export const NODE_RADII = { PR_MIN: 18, PR_MAX: 34, SR_MIN: 5, SR_MAX: 20, FR_MIN: 3, FR_MAX: 13, CL_MIN: 12, CL_MAX: 24 };

// d3 default is 0.0228 (~5s settle). 0.006 ran ~19s of manyBody on 700+ nodes.
export const SIM_ALPHA_DECAY = 0.02;

function hexVertices(r) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3;
    pts.push([r * Math.sin(a), -r * Math.cos(a)]);
  }
  return pts;
}

function pathFromPts(pts) {
  return 'M' + pts.map(([x, y]) => `${x},${y}`).join('L') + 'Z';
}

/** Pointy-top regular hexagon path, vertex 0 at (0,-r) — the project glyph silhouette. */
export function hexPath(r) {
  return pathFromPts(hexVertices(r));
}

// Harness fill on the project hex — data, not chrome (mirrors TOOL_COLORS).
// No blue-family hues: Register A retired navy chrome; ticks/fills still encode identity.
export const HARNESS_MARK = {
  'claude-code': '#2a9d8f', pi: '#ff9944', antigravity: '#44cc88',
  grok: '#cc4488', opencode: '#aacc44', copilot: '#c070b0', 'command-code': '#ffcc44',
};
export const HARNESS_FILL_OPACITY = 1;

/** Solid harness fill only while the project is live (recencyLevel ≥ 1 or in flight). */
export function isProjectGlyphActive(d) {
  if (!d) return false;
  if (d.inFlight) return true;
  return (d.recencyLevel || 0) >= 1;
}

/**
 * Pointy-top hex packing. Odd rows shift by half a column so neighbours
 * tessellate. Origin defaults to (r, r) so the first hex is not clipped.
 */
export function glyphCellPitch(r = 16) {
  return { dx: r * Math.sqrt(3), dy: r * 1.5 };
}

export function glyphCellPosition(col, row, { r = 16, originX, originY } = {}) {
  const { dx, dy } = glyphCellPitch(r);
  const ox = originX != null ? originX : r;
  const oy = originY != null ? originY : r;
  return {
    x: ox + col * dx + (row % 2 ? dx / 2 : 0),
    y: oy + row * dy,
  };
}

export function glyphGrid(n, opts = {}) {
  const count = Math.max(0, n | 0);
  const c = Math.max(1, opts.cols || Math.ceil(Math.sqrt(count || 1)));
  const cells = [];
  for (let i = 0; i < count; i++) {
    const col = i % c;
    const row = (i - col) / c;
    cells.push({ i, col, row, ...glyphCellPosition(col, row, opts) });
  }
  return cells;
}

export function glyphLatticeCells({ cols = 12, rows = 10, r = 16, originX, originY } = {}) {
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ col, row, ...glyphCellPosition(col, row, { r, originX, originY }) });
    }
  }
  return cells;
}

export function glyphWorldExtent({ cols = 1, rows = 1, r = 16, originX, originY } = {}) {
  const c = Math.max(1, cols);
  const rr = Math.max(1, rows);
  const even = glyphCellPosition(c - 1, 0, { r, originX, originY });
  const odd = rr > 1 ? glyphCellPosition(c - 1, 1, { r, originX, originY }) : even;
  const last = glyphCellPosition(c - 1, rr - 1, { r, originX, originY });
  return {
    width: Math.ceil(Math.max(even.x, odd.x) + r + 1),
    height: Math.ceil(last.y + r + 1),
  };
}

export function glyphGridExtent(n, opts = {}) {
  const count = Math.max(0, n | 0);
  const c = Math.max(1, opts.cols || Math.ceil(Math.sqrt(count || 1)));
  const rows = Math.max(1, Math.ceil((count || 1) / c));
  return glyphWorldExtent({ ...opts, cols: c, rows });
}

export function snapToGlyphCell(x, y, { r = 16, cols, rows, originX, originY } = {}) {
  const { dx, dy } = glyphCellPitch(r);
  const ox = originX != null ? originX : r;
  const oy = originY != null ? originY : r;
  let row = Math.round((y - oy) / dy);
  if (rows != null) row = Math.max(0, Math.min(rows - 1, row));
  const xOff = row % 2 ? dx / 2 : 0;
  let col = Math.round((x - ox - xOff) / dx);
  if (cols != null) col = Math.max(0, Math.min(cols - 1, col));
  return { col, row, ...glyphCellPosition(col, row, { r, originX, originY }) };
}

const AXIAL_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function axialToOddR(q, r) {
  return { col: q + (r - (r & 1)) / 2, row: r };
}

/** i=0 is origin; then hex rings (6, 12, 18, …) — default seat order. */
export function glyphSpiralCell(index) {
  const i = Math.max(0, index | 0);
  if (i === 0) return { col: 0, row: 0 };
  let ring = 1;
  let used = 1;
  while (used + 6 * ring <= i) {
    used += 6 * ring;
    ring++;
  }
  let step = i - used;
  let q = AXIAL_DIRS[4][0] * ring;
  let r = AXIAL_DIRS[4][1] * ring;
  for (let d = 0; d < 6 && step > 0; d++) {
    for (let s = 0; s < ring && step > 0; s++) {
      q += AXIAL_DIRS[d][0];
      r += AXIAL_DIRS[d][1];
      step--;
    }
  }
  return axialToOddR(q, r);
}

export function firstAvailableRadial(occupied) {
  const occ = occupied instanceof Set ? occupied : new Set(occupied || []);
  for (let i = 0; i < 100000; i++) {
    const c = glyphSpiralCell(i);
    if (!occ.has(c.col + ',' + c.row)) return c;
  }
  return { col: 0, row: 0 };
}

/** Visible hexes for an infinite board — includes negative col/row. */
export function glyphLatticeWindow({ x0, y0, x1, y1, r = 16, originX = 0, originY = 0, pad = 1 } = {}) {
  const a = snapToGlyphCell(x0, y0, { r, originX, originY });
  const b = snapToGlyphCell(x1, y1, { r, originX, originY });
  const minCol = Math.min(a.col, b.col) - pad;
  const maxCol = Math.max(a.col, b.col) + pad;
  const minRow = Math.min(a.row, b.row) - pad;
  const maxRow = Math.max(a.row, b.row) + pad;
  const cells = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      cells.push({ col, row, ...glyphCellPosition(col, row, { r, originX, originY }) });
    }
  }
  return cells;
}

export function glyphBoardConfig() {
  return { r: 22, originX: 0, originY: 0 };
}

/** Graph-canvas hex radius: a project glyph (≤ PR_MAX) sits inside the cell. */
export const GLYPH_GRAPH_R = NODE_RADII.PR_MAX * 2;

/** Lattice origin = canvas centre. Cell (0,0) is the middle hex; seats do not rescale. */
export function glyphGraphConfig(width, height, r = GLYPH_GRAPH_R) {
  return { r, originX: (width || 0) / 2, originY: (height || 0) / 2 };
}

/** Hex relatives → graph-space pins. Identity mapping — (0,0) stays at centre. */
export function glyphGraphPins(placements, { width, height, r = GLYPH_GRAPH_R } = {}) {
  const cfg = glyphGraphConfig(width, height, r);
  const out = {};
  for (const id of Object.keys(placements || {})) {
    const p = placements[id];
    if (!p || !Number.isFinite(+p.col) || !Number.isFinite(+p.row)) continue;
    out[id] = glyphCellPosition(p.col, p.row, cfg);
  }
  return out;
}

/**
 * Map a graph-space camera rect onto minimap user space. Graph origin (canvas
 * centre) maps to minimap origin (0,0); scale is miniR / graphR.
 */
export function graphRectToMinimap(rect, { graphR = GLYPH_GRAPH_R, miniR = 7, originX = 0, originY = 0 } = {}) {
  const s = graphR ? miniR / graphR : 0;
  return {
    x: (rect.worldX - originX) * s,
    y: (rect.worldY - originY) * s,
    w: rect.worldW * s,
    h: rect.worldH * s,
  };
}

export function mergeGlyphPlacements(ids, saved) {
  const list = ids || [];
  const occupied = new Set();
  const result = {};
  const key = (col, row) => col + ',' + row;
  for (const id of list) {
    const p = saved && saved[id];
    if (!p || !Number.isFinite(+p.col) || !Number.isFinite(+p.row)) continue;
    const col = p.col | 0, row = p.row | 0;
    if (occupied.has(key(col, row))) continue;
    result[id] = { col, row };
    occupied.add(key(col, row));
  }
  for (const id of list) {
    if (result[id]) continue;
    const cell = firstAvailableRadial(occupied);
    result[id] = cell;
    occupied.add(key(cell.col, cell.row));
  }
  return result;
}

/** Map hex-cell relatives into a force viewport. Relative seats stay relative. */
export function scaleGlyphPins(placements, { width, height, r = 22, margin = 80, originX = 0, originY = 0 } = {}) {
  const ids = Object.keys(placements || {});
  if (!ids.length) return {};
  const pts = ids.map(id => ({
    id,
    ...glyphCellPosition(placements[id].col, placements[id].row, { r, originX, originY }),
  }));
  if (pts.length === 1) return { [pts[0].id]: { x: width / 2, y: height / 2 } };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bw = Math.max(r, maxX - minX);
  const bh = Math.max(r, maxY - minY);
  const s = Math.min((width - 2 * margin) / bw, (height - 2 * margin) / bh);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const out = {};
  for (const p of pts) {
    out[p.id] = { x: width / 2 + (p.x - cx) * s, y: height / 2 + (p.y - cy) * s };
  }
  return out;
}

export function moveGlyphPlacement(placements, id, col, row) {
  const next = { ...(placements || {}) };
  const occupant = Object.keys(next).find(k => k !== id && next[k].col === col && next[k].row === row);
  const prev = next[id] || { col: 0, row: 0 };
  if (occupant) next[occupant] = { col: prev.col, row: prev.row };
  next[id] = { col, row };
  return next;
}

export function minimapViewportRect({ worldX, worldY, worldW, worldH, boardW, boardH, miniW, miniH }) {
  if (!boardW || !boardH || !miniW || !miniH) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: worldX * miniW / boardW,
    y: worldY * miniH / boardH,
    w: worldW * miniW / boardW,
    h: worldH * miniH / boardH,
  };
}

/** Inner SVG paths for one project hex. Idle = hollow; active = solid wedges. */
export function projectGlyphMarkup(d, { r = 16, bg = '#000000' } = {}) {
  const color = d?.color || '#888888';
  const stroke = `<path d="${hexPath(r)}" fill="none" stroke="${esc(color)}" stroke-width="2"/>`;
  if (!isProjectGlyphActive(d)) {
    return `<path d="${hexPath(r)}" fill="${bg}" stroke="${esc(color)}" stroke-width="2"/>`;
  }
  const wedges = harnessWedges(d.harnesses, r);
  if (!wedges.length) {
    return `<path d="${hexPath(r)}" fill="${bg}" stroke="${esc(color)}" stroke-width="2"/>`;
  }
  const fills = wedges.map(w =>
    `<path d="${w.d}" fill="${HARNESS_MARK[w.harness] || color}" fill-opacity="${HARNESS_FILL_OPACITY}"/>`
  ).join('');
  return fills + stroke;
}

export function projectGlyphSvg(d, opts = {}) {
  const r = opts.r || 16;
  const pad = 1;
  const size = r * 2 + pad * 2;
  return `<svg class="pglyph" width="${size}" height="${size}" viewBox="${-r - pad} ${-r - pad} ${size} ${size}" aria-hidden="true">${projectGlyphMarkup(d, opts)}</svg>`;
}

function glyphCellsExtent(cells, r) {
  if (!cells.length) return { minX: -r, minY: -r, width: r * 2, height: r * 2 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x - r);
    minY = Math.min(minY, c.y - r);
    maxX = Math.max(maxX, c.x + r);
    maxY = Math.max(maxY, c.y + r);
  }
  return { minX, minY, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}

/** One svg with every project hex parked on a hex grid — brand field. */
export function projectGlyphFieldSvg(projects, { r = 12, cols, rows, bg = '#000000', placements, lattice, originX = 0, originY = 0 } = {}) {
  const list = projects || [];
  const merged = mergeGlyphPlacements(list.map(p => p.id), placements);
  const opts = { r, originX, originY };
  const placed = list.map(p => {
    const slot = merged[p.id] || { col: 0, row: 0 };
    return { ...slot, ...glyphCellPosition(slot.col, slot.row, opts), id: p.id };
  });
  const pad = 2;
  const colsUsed = placed.map(c => c.col);
  const rowsUsed = placed.map(c => c.row);
  const minCol = (colsUsed.length ? Math.min(0, ...colsUsed) : 0) - pad;
  const maxCol = (colsUsed.length ? Math.max(0, ...colsUsed) : 0) + pad;
  const minRow = (rowsUsed.length ? Math.min(0, ...rowsUsed) : 0) - pad;
  const maxRow = (rowsUsed.length ? Math.max(0, ...rowsUsed) : 0) + pad;
  const latticeCells = lattice
    ? glyphLatticeWindow({
        x0: glyphCellPosition(minCol, minRow, opts).x,
        y0: glyphCellPosition(minCol, minRow, opts).y,
        x1: glyphCellPosition(maxCol, maxRow, opts).x,
        y1: glyphCellPosition(maxCol, maxRow, opts).y,
        ...opts, pad: 0,
      })
    : placed;
  const extent = glyphCellsExtent(lattice ? latticeCells : placed, r);
  const latticeMarks = lattice
    ? latticeCells.map(cell =>
        `<path class="pglyph-lattice" d="${hexPath(r)}" transform="translate(${cell.x},${cell.y})" fill="none"/>`
      ).join('')
    : '';
  const groups = list.map(p => {
    const slot = merged[p.id] || { col: 0, row: 0 };
    const pos = glyphCellPosition(slot.col, slot.row, opts);
    return `<g class="pglyph-cell" data-pid="${esc(p.id)}" data-col="${slot.col}" data-row="${slot.row}" transform="translate(${pos.x},${pos.y})">${projectGlyphMarkup(p, { r, bg })}<title>${esc(p.label || p.id)}</title></g>`;
  }).join('');
  return `<svg class="pglyph-field" width="${extent.width}" height="${extent.height}" viewBox="${extent.minX} ${extent.minY} ${extent.width} ${extent.height}">${latticeMarks}${groups}</svg>`;
}

function uniqHarnesses(harnesses) {
  const list = [];
  const seen = new Set();
  for (const h of harnesses || []) {
    if (!h || seen.has(h)) continue;
    seen.add(h);
    list.push(h);
  }
  return list;
}

function rayHexIntersect(angle, verts) {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  let bestT = Infinity;
  let hit = [dx, dy];
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = verts[i];
    const [x2, y2] = verts[(i + 1) % 6];
    const ex = x2 - x1, ey = y2 - y1;
    const D = dx * (-ey) - dy * (-ex);
    if (Math.abs(D) < 1e-12) continue;
    const t = (x1 * (-ey) - (-ex) * y1) / D;
    const u = (dx * y1 - dy * x1) / D;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < bestT) {
      bestT = t;
      hit = [t * dx, t * dy];
    }
  }
  return hit;
}

function angleInOpenWedge(a, a0, a1) {
  const tau = Math.PI * 2;
  const norm = x => ((x % tau) + tau) % tau;
  a = norm(a); a0 = norm(a0); a1 = norm(a1);
  const eps = 1e-9;
  if (a1 > a0 + eps) return a > a0 + eps && a < a1 - eps;
  return a > a0 + eps || a < a1 - eps;
}

function ptsNear(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8;
}

/**
 * Interior fill of a project hex, one polygon per distinct harness.
 * 1 → solid hex; 2 → half-split through top–bottom vertices; 3 → 120°
 * center fan (vertex-aligned); 4+ → equal-angle polygons from the center
 * to each side/corner the ray hits.
 *
 * `weights` (optional `{ [harness]: count }`) makes wedge angle proportional
 * to share of count instead of equal division — e.g. session counts per
 * harness. Omitted, null, or all-equal weights reproduce the equal-angle
 * default exactly.
 */
export function harnessWedges(harnesses, r, weights) {
  const list = uniqHarnesses(harnesses);
  if (!list.length) return [];
  const verts = hexVertices(r);
  if (list.length === 1) return [{ harness: list[0], d: pathFromPts(verts) }];
  const n = list.length;
  const tau = Math.PI * 2;
  const w = weights ? list.map(h => Math.max(0, weights[h] || 0)) : list.map(() => 1);
  const totalW = w.reduce((a, b) => a + b, 0) || n;
  const bounds = [0];
  let acc = 0;
  for (const wi of w) { acc += wi; bounds.push(acc / totalW * tau); }
  bounds[n] = tau; // exact close — avoids float drift leaving a hairline gap
  return list.map((h, i) => {
    const a0 = bounds[i];
    const a1 = bounds[i + 1];
    const p0 = rayHexIntersect(a0, verts);
    const p1 = rayHexIntersect(a1, verts);
    const mid = verts.filter((_, k) => angleInOpenWedge(k * Math.PI / 3, a0, a1));
    const pts = [[0, 0], p0];
    for (const v of mid) {
      if (!ptsNear(v, p0) && !ptsNear(v, p1)) pts.push(v);
    }
    if (!ptsNear(p1, pts[pts.length - 1])) pts.push(p1);
    return { harness: h, d: pathFromPts(pts) };
  });
}

/**
 * ME glyph — one hex for the whole graph. Usage is session count so
 * tokenless harnesses still count. Wedge order is count-desc, then id,
 * so the largest share starts at the top vertex.
 */
export function meGlyph(sessions = []) {
  const counts = new Map();
  for (const s of sessions || []) {
    const h = s?.harness || s?.source;
    if (!h) continue;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const harnesses = [...counts.keys()].sort((a, b) => {
    const d = counts.get(b) - counts.get(a);
    if (d) return d;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const weights = {};
  const rows = harnesses.map(harness => {
    const count = counts.get(harness);
    weights[harness] = count;
    return {
      harness,
      count,
      share: total ? count / total : 0,
      pct: total ? Math.round(100 * count / total) : 0,
      color: HARNESS_MARK[harness] || '#888888',
    };
  });
  return { harnesses, weights, total, rows };
}

/** ME hex: hollow when empty; solid wedges proportional to share. */
export function meGlyphMarkup(me, { r = 28, bg = '#000000', color = '#ccccaa' } = {}) {
  const stroke = `<path d="${hexPath(r)}" fill="none" stroke="${esc(color)}" stroke-width="2"/>`;
  if (!me || !me.total) {
    return `<path d="${hexPath(r)}" fill="${bg}" stroke="${esc(color)}" stroke-width="2"/>`;
  }
  const wedges = harnessWedges(me.harnesses, r, me.weights);
  const fills = wedges.map(w =>
    `<path d="${w.d}" fill="${HARNESS_MARK[w.harness] || color}" fill-opacity="${HARNESS_FILL_OPACITY}"/>`
  ).join('');
  return fills + stroke;
}

export function meGlyphSvg(me, opts = {}) {
  const r = opts.r || 28;
  const pad = 1;
  const size = r * 2 + pad * 2;
  return `<svg class="me-glyph" width="${size}" height="${size}" viewBox="${-r - pad} ${-r - pad} ${size} ${size}" aria-hidden="true">${meGlyphMarkup(me, { ...opts, r })}</svg>`;
}

/** Hex + session count + per-harness share rows — dock and landing. */
export function meGlyphCardHtml(me, opts = {}) {
  const r = opts.r || 28;
  const total = me?.total || 0;
  const nH = me?.harnesses?.length || 0;
  const line = total
    ? `${total} session${total === 1 ? '' : 's'} · ${nH} harness${nH === 1 ? '' : 'es'}`
    : 'no sessions';
  const legend = (me?.rows || []).map(row =>
    `<div class="me-row"><span class="me-swatch" style="background:${esc(row.color)}"></span>` +
    `<span class="me-h">${esc(row.harness)}</span>` +
    `<span class="me-pct">${row.pct}%</span>` +
    `<span class="me-n">${row.count}</span></div>`
  ).join('');
  return meGlyphSvg(me, opts) + `<div class="me-line">${line}</div>` +
    (legend ? `<div class="me-rows">${legend}</div>` : '');
}

/** Panel rows for a project: glyph order, session counts, mark colors. */
export function harnessBreakdown(harnesses, sessions = []) {
  const order = uniqHarnesses(harnesses);
  const counts = new Map(order.map(h => [h, 0]));
  for (const s of sessions) {
    const h = s?.harness || s?.source;
    if (!h) continue;
    if (!counts.has(h)) order.push(h);
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  return order.map(harness => ({
    harness,
    count: counts.get(harness) || 0,
    color: HARNESS_MARK[harness] || '#888888',
  }));
}

export function nodeRadius(d, r = NODE_RADII) {
  if (d.type === 'project') return r.PR_MIN + (r.PR_MAX - r.PR_MIN) * (d.sizeNorm || 0);
  if (d.type === 'session') return r.SR_MIN + (r.SR_MAX - r.SR_MIN) * (d.sizeNorm || 0);
  if (d.type === 'cluster') return r.CL_MIN + (r.CL_MAX - r.CL_MIN) * (d.sizeNorm || 0);
  return r.FR_MIN + (r.FR_MAX - r.FR_MIN) * (d.sizeNorm || 0);
}

export function edgeOpacity(d, maxWeight) {
  const b = EDGE_OPACITY[d.type] || .3;
  if (!d.weight) return b;
  const wn = Math.sqrt(d.weight / Math.max(1, maxWeight));
  return Math.min(1, b * (0.5 + 1.5 * wn));
}

export function edgeWidth(d, maxWeight) {
  const b = EDGE_WIDTH[d.type] || 1;
  if (!d.weight) return b;
  const wn = Math.sqrt(d.weight / Math.max(1, maxWeight));
  return b * (0.5 + 2 * wn);
}

// Block geometry for live-feed canvases (DAW widget / builder lanes).
// Two-layer model: ambient floor (tokens/words pinned to the bottom) under
// top-anchored activity spikes whose height encodes significance.
export function blockGeom(ev, trackH = 62) {
  const t = (ev.tool || '').toLowerCase();
  if (ev.type === 'tokens') return { h: 4,  yOff: trackH - 4  };
  if (ev.type === 'words')  return { h: 8,  yOff: trackH - 13 };
  // Cognition events: structural markers (full-height for resets/failures,
  // medium for human presence, low ticks for mode chrome, faint chirps)
  if (ev.type === 'compact' || ev.type === 'tool_error' || ev.type === 'api_error')
    return { h: trackH - 4, yOff: 2 };
  if (ev.type === 'human_turn') return { h: 36, yOff: 2 };
  if (ev.type === 'permission' || ev.type === 'mode_shift') return { h: 12, yOff: 2 };
  if (ev.type === 'chirp') return { h: 5, yOff: trackH - 22 };
  if (ev.type === 'thinking') return { h: 16, yOff: 20 };
  if (t === 'write')                       return { h: 52, yOff: 2 };
  if (t === 'edit')                        return { h: 46, yOff: 2 };
  if (t === 'agent' || t === 'task')       return { h: 40, yOff: 2 };
  if (t === 'read')                        return { h: 32, yOff: 2 };
  if (t === 'bash' || t === 'powershell' || t === 'shell') return { h: 22, yOff: 2 };
  if (t === 'grep' || t === 'glob')        return { h: 14, yOff: 2 };
  return { h: 20, yOff: 2 };
}

// ── DAW lane geometry (Cognitive DAW Builder) ─────────────────────────────────
// Lane tool colors are deliberately brighter variants of TOOL_COLORS — they sit
// on the dark per-family lane backgrounds (visual contract, do not unify).

export const DAW_FAMILY_LANES = [
  {
    id: 'file', label: 'FILE OPS', bg: '#0b1a0e', portion: 0.28,
    toolColors: { write: '#00cc55', edit: '#ccaa00', read: '#3a6aaa', grep_glob: '#8844cc' },
    blockW: e => e.key === 'write' ? 10 : e.key === 'edit' ? 8 : 5,
    blockH: e => e.key === 'write' ? 0.85 : e.key === 'edit' ? 0.70 : 0.50,
  },
  {
    id: 'system', label: 'SYSTEM', bg: '#0a0a18', portion: 0.20,
    toolColors: { bash_git: '#cc5522', bash_run: '#dd7733', bash_other: '#555577' },
    blockW: () => 7,
    blockH: () => 0.70,
  },
  {
    id: 'ai', label: 'AI / AGENT', bg: '#100818', portion: 0.25,
    toolColors: { agent: '#cc2244', other: '#884466' },
    blockW: e => e.key === 'agent' ? 14 : 8,
    blockH: () => 0.85,
  },
  {
    id: 'context', label: 'CONTEXT', bg: '#080c18', portion: 0.15,
    toolColors: { tokens: '#00ddcc', words: '#00aaff', thinking: '#ffaa00' },
    blockW: e => e.type === 'tokens' ? 3 : e.type === 'thinking' ? 6 : 8,
    blockH: e => {
      if (e.type === 'tokens')
        return Math.max(0.1, Math.min(0.8, Math.log1p((e.output || 0) / 200) * 0.35));
      if (e.type === 'thinking') return 0.45;
      return Math.max(0.1, Math.min(0.85, (e.word_count || 0) / 80));
    },
  },
];

/** Stack lanes under the ruler; every lane keeps an 18px minimum height. */
export function computeLaneLayout(H, lanes = DAW_FAMILY_LANES, rulerH = 20) {
  const usable = H - rulerH;
  let y = rulerH;
  return lanes.map(lane => {
    const h = Math.max(18, Math.floor(usable * lane.portion));
    const r = { id: lane.id, y, h };
    y += h;
    return r;
  });
}

export function laneForEvent(ev, lanes = DAW_FAMILY_LANES) {
  return lanes.find(l => l.id === ev.family) || null;
}

/** Right-anchored time axis: x of an event on a live-scrolling canvas. */
export function evTimeX(ev, now, W, pxPerSec, scrollMs = 0) {
  return W - (now - ev.ts) / 1000 * pxPerSec + scrollMs / 1000 * pxPerSec;
}

/** Voices whose AudioContext start time `at` still covers `t` (plus a short hold). */
export function voicesSoundingAt(voices, t, holdSec = 0.08) {
  if (!voices || !voices.length) return [];
  return voices.filter(v => {
    const dur = Math.max(Number(v.dur) || 0, holdSec);
    return t >= v.at && t < v.at + dur;
  });
}

/** Session-relative clock for the DAW now-playing readout. */
export function fmtSessionT(relMs) {
  if (relMs == null || !Number.isFinite(relMs)) return '';
  const s = Math.max(0, relMs) / 1000;
  if (s < 60) return 't+' + s.toFixed(1) + 's';
  const m = Math.floor(s / 60);
  const r = Math.floor(s - m * 60);
  return 't+' + m + 'm' + String(r).padStart(2, '0') + 's';
}

/** Compact now-playing line for DAW header and Graph beat overlay. */
export function fmtSoundingLine(sounding, max = 3) {
  if (!sounding || !sounding.length) return '';
  const clock = fmtSessionT(sounding[0].relMs);
  const bits = sounding.slice(0, max).map(v => {
    const hz = v.hz ? Math.round(v.hz) + 'Hz' : '';
    const n  = v.clusterN > 1 ? '×' + v.clusterN : '';
    return [v.instrument + n, v.label || v.key, hz].filter(Boolean).join(' ');
  });
  return '▶ ' + (clock ? clock + '  ' : '') + bits.join(' · ');
}

/**
 * Playback policy for a simultaneous burst (one scheduler flush).
 *
 * Under MAX_POLYPHONY, unisons are spread into a scale chord so N harps
 * at C4 don't stack. Over the cap: keep a few high-salience voices
 * (write/error/words) and collapse the rest per family into one chord
 * (or a single percussion hit). Oscillator count never exceeds maxPoly.
 *
 * `ghosts` are originals with no oscillator — the DAW still draws them.
 */
export const VOICE_MAX_POLYPHONY = 4;
export const VOICE_MAX_CHORD = 3;

const VOICE_PRIORITY = {
  tool_error: 100, api_error: 100,
  write: 90, edit: 80,
  words: 70, human_turn: 70, agent: 65,
  bash_git: 55, bash_run: 50, bash_other: 45,
  read: 30, grep_glob: 28, other: 25,
  tokens: 12, thinking: 10, unknown: 8, permission: 8,
};

const PERC_VOICES = new Set(['snare', 'kick', 'hat']);

export function voicePriority(v) {
  const key = v?.sonic?.key || v?.key || '';
  const event = v?.meta?.event || v?.event || '';
  return VOICE_PRIORITY[key] ?? VOICE_PRIORITY[event] ?? 40;
}

function hzOf(v) { return Number(v.hz) || 261.6; }

function spreadChord(voices, intervals) {
  if (voices.length <= 1) return voices;
  const hzs = voices.map(hzOf);
  if (Math.max(...hzs) - Math.min(...hzs) >= 2) return voices;
  const root = hzs[0];
  const iv = intervals && intervals.length ? intervals : [0, 4, 7, 12];
  return voices.map((v, i) => ({
    ...v,
    hz: root * Math.pow(2, (iv[i % iv.length] || 0) / 12),
  }));
}

export function coalesceVoices(voices, opts = {}) {
  const maxPoly  = opts.maxPoly  ?? VOICE_MAX_POLYPHONY;
  const chordMax = opts.chordMax ?? VOICE_MAX_CHORD;
  const scale    = opts.scale    || [0, 4, 7, 12];

  if (!voices || !voices.length) return { audible: [], ghosts: [] };
  if (voices.length <= maxPoly) {
    return { audible: spreadChord(voices, scale), ghosts: [] };
  }

  const byFam = new Map();
  for (const v of voices) {
    const f = v.sonic?.fam || v.fam || 'other';
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f).push(v);
  }
  for (const g of byFam.values())
    g.sort((a, b) => voicePriority(b) - voicePriority(a));

  const fams = [...byFam.entries()]
    .sort((a, b) => voicePriority(b[1][0]) - voicePriority(a[1][0]));

  function want(group) {
    if (PERC_VOICES.has(group[0].name)) return 1;
    if (group.length === 1) return 1;
    return Math.min(chordMax, group.length);
  }

  const alloc = new Map(fams.map(([f]) => [f, 0]));
  let slots = maxPoly;
  while (slots > 0) {
    let gave = false;
    for (const [f, group] of fams) {
      if (alloc.get(f) < want(group) && slots > 0) {
        alloc.set(f, alloc.get(f) + 1);
        slots--;
        gave = true;
      }
    }
    if (!gave) break;
  }

  const audible = [];
  const ghosts  = [];
  for (const [f, group] of fams) {
    const n = group.length;
    const k = alloc.get(f);
    if (!k) { ghosts.push(...group); continue; }
    const boost = n > 1 ? 1 + 0.18 * Math.log2(n) : 1;
    if (PERC_VOICES.has(group[0].name) || n === 1) {
      audible.push({ ...group[0], vol: (group[0].vol ?? 0.42) * boost, clusterN: n > 1 ? n : undefined });
      ghosts.push(...group.slice(1));
      continue;
    }
    const rootHz = hzOf(group[0]);
    const vol = (group[0].vol ?? 0.42) * boost / Math.sqrt(k);
    for (let i = 0; i < k; i++) {
      audible.push({
        ...group[Math.min(i, n - 1)],
        hz: rootHz * Math.pow(2, (scale[i] || 0) / 12),
        vol,
        clusterN: n,
      });
    }
    ghosts.push(...group);
  }
  return { audible, ghosts };
}

/**
 * Context pressure: how full a session's context window is, from the latest
 * tokens pulse (input + cache_read ≈ current prompt context size).
 * @returns {number} 0..1
 */
export function contextPressure(inputTokens, cacheRead, windowTokens = 200_000) {
  const ctx = (inputTokens || 0) + (cacheRead || 0);
  return Math.max(0, Math.min(1, ctx / windowTokens));
}

/**
 * Distinct sessions seen in the beat ring, newest first, each with its latest
 * context pressure (null until a tokens pulse has been seen).
 * @param {object[]} ring — beat-ring entries (ts ascending)
 * @param {number} [max] — legend size cap
 */
export function sessionLegend(ring, max = 6, windowTokens = 200_000) {
  const bySlug = new Map(); // slug → entry (insertion order = recency, newest first)
  for (let i = ring.length - 1; i >= 0; i--) {
    const ev = ring[i];
    if (!ev.slug) continue;
    let entry = bySlug.get(ev.slug);
    if (!entry) {
      if (bySlug.size >= max) continue; // newer sessions already filled the legend
      entry = { slug: ev.slug, project: ev.project || null, color: ev.color || null,
                pressure: null, lastTs: ev.ts };
      bySlug.set(ev.slug, entry);
    }
    if (entry.pressure === null && ev.type === 'tokens') {
      entry.pressure = contextPressure(ev.input, ev.cache_read, windowTokens);
    }
  }
  return [...bySlug.values()];
}

// ── Live SSE subscribe (Graph / DAW → playPulse) ──────────────────────────────
// tool_call / tokens / words have their own listeners (custom ticker lines).
// Cognition events share one loop. unknown / silent / tool_result stay wire-only.

export const LIVE_COGNITION_EVENTS = [
  'human_turn', 'compact', 'permission', 'mode_shift',
  'tool_error', 'api_error', 'chirp', 'attachment', 'scaffold',
  'thinking',
];

export const LIVE_PLAYPULSE_EVENTS = [
  'tool_call', 'tokens', 'words',
  ...LIVE_COGNITION_EVENTS,
];

// ── Cognition pulse vocabulary (ticker / overlays) ────────────────────────────

export const PULSE_GLYPHS = {
  human_turn: '⌨', compact: '⟲', permission: '⚙', mode_shift: '⚙',
  tool_error: '✖', api_error: '⊘', attachment: '⊕', scaffold: '▤',
};

/**
 * Ticker line for a cognition pulse. Returns { text, role } or null when the
 * event should stay out of the ticker (chirps, thinking — too chatty).
 * Roles: 'err' | 'human' | 'context' | 'dim' (consumer maps role → color).
 */
export function pulseTickerEntry(event, data = {}) {
  const g = PULSE_GLYPHS[event];
  const tag = data.slug ? '  [' + data.slug + ']' : '';
  switch (event) {
    case 'human_turn':
      return { text: g + ' "' + String(data.text || 'prompt').slice(0, 48) + '"' + tag, role: 'human' };
    case 'compact':
      return { text: g + ' context compacted' + tag, role: 'context' };
    case 'permission':
      return { text: g + ' perm → ' + (data.mode || '?') + tag, role: 'dim' };
    case 'mode_shift':
      return { text: g + ' mode → ' + (data.mode || '?') + tag, role: 'dim' };
    case 'tool_error':
      return { text: g + ' ' + (data.tool || 'tool') + ' failed' + tag, role: 'err' };
    case 'api_error':
      return { text: g + ' ' + (data.message || 'api error') + (data.code ? ' [' + data.code + ']' : '') + tag, role: 'err' };
    default:
      return null;
  }
}

// ── History-view filters ──────────────────────────────────────────────────────

/**
 * Does a session node pass the active filters?
 * @param {{ harness?: string, project_id?: string, date_str?: string }} node
 * @param {{ from?: string|null, to?: string|null,
 *           harnesses?: Set<string>|null, projects?: Set<string>|null }} [f]
 *   — from/to are inclusive YYYY-MM-DD bounds; empty/null sets mean
 *   "no constraint"; undated sessions are never date-filtered.
 */
export function sessionMatchesFilters(node, f = {}) {
  if (node.date_str) {
    if (f.from && node.date_str < f.from) return false;
    if (f.to   && node.date_str > f.to)   return false;
  }
  if (f.harnesses?.size && !f.harnesses.has(node.harness))   return false;
  if (f.projects?.size  && !f.projects.has(node.project_id)) return false;
  return true;
}

/**
 * Node ids hidden by the bundle (cluster) mechanism. Members of collapsed
 * clusters hide behind their cluster node; a cluster with no filter-passing
 * members hides itself. Filter-based hiding of individual sessions stays the
 * caller's job — this helper only adds the cluster dimension.
 */
export function computeClusterHidden(nodes, { bundleOn = true, expanded = new Set(), filters = {} } = {}) {
  const hidden = new Set();
  const byId = {};
  for (const n of nodes) byId[n.id] = n;
  for (const n of nodes) {
    if (n.type !== 'cluster') continue;
    if (!bundleOn) { hidden.add(n.id); continue; }
    const anyPassing = (n.member_ids || []).some(id =>
      byId[id] && sessionMatchesFilters(byId[id], filters));
    if (!anyPassing) { hidden.add(n.id); continue; }
    if (!expanded.has(n.id))
      for (const id of n.member_ids) hidden.add(id);
  }
  return hidden;
}

// ── Force layout profiles ─────────────────────────────────────────────────────

/**
 * Anchored (default): projects pinned on their ring, strong membership pull —
 * the project-centric overview. Free: projects unpin and let go, sessions and
 * files cluster purely by co-access (post-filter exploration mode).
 * @param {boolean} free
 */
export function forceProfile(free) {
  if (free) return {
    projectPinned:      false,
    membershipStrength: 0.05,
    projectCharge:      -200,
    grouping:           false,  // overrides the cluster-by-project checkbox
    center:             true,
  };
  return {
    projectPinned:      true,
    membershipStrength: 0.65,
    projectCharge:      -700,
    grouping:           null,   // honor the cluster-by-project checkbox
    center:             false,
  };
}

/**
 * Landing handshake queue. `firstDelay` holds on a cursor before line one
 * (first-boot pause). Later lines wait `minGap`. `onReveal` fires when
 * that line is shown.
 */
export function createBootQueue(opts = {}) {
  const minGap = opts.minGap ?? 180;
  const firstDelay = opts.firstDelay ?? 0;
  const delay = opts.delay || ((fn, ms) => setTimeout(fn, ms));
  const shown = [];
  const queue = [];
  let timer = null;
  function flush() {
    timer = null;
    if (!queue.length) return;
    const item = queue.shift();
    shown.push(item.html);
    if (opts.onShow) opts.onShow(shown.slice());
    if (typeof item.onReveal === 'function') item.onReveal();
    if (queue.length) timer = delay(flush, minGap);
  }
  function arm() {
    if (timer) return;
    const wait = shown.length === 0 ? firstDelay : minGap;
    if (wait <= 0) flush();
    else timer = delay(flush, wait);
  }
  return {
    push(html, onReveal) {
      queue.push({ html, onReveal });
      arm();
    },
    shown: () => shown.slice(),
  };
}

// ── SSE wiring (one EventSource pattern for every page) ───────────────────────

/**
 * @param {object}   opts
 * @param {string}   [opts.url='/events']
 * @param {Object<string, (data: any, rawEvent: MessageEvent) => void>} opts.handlers
 *   — data is JSON.parse(e.data) when parseable, else null (read rawEvent.data)
 * @param {(state: 'open'|'reconnecting') => void} [opts.onStatus]
 * @param {typeof EventSource} [ES] — injectable for tests
 * @returns {EventSource}
 */
export function connectEvents(opts, ES) {
  const Ctor = ES || EventSource;
  const es = new Ctor(opts.url || '/events');
  for (const [event, fn] of Object.entries(opts.handlers || {})) {
    es.addEventListener(event, e => {
      let data = null;
      try { data = JSON.parse(e.data); } catch { /* non-JSON event payload */ }
      try { fn(data, e); } catch { /* handler errors must not kill the stream */ }
    });
  }
  if (opts.onStatus) {
    es.onopen  = () => opts.onStatus('open');
    es.onerror = () => opts.onStatus('reconnecting');
  }
  return es;
}

// ── Layout controls (declarative show/hide) ───────────────────────────────────

/**
 * @param {Object<string, { controls?: string[] }>} layoutHandlers
 * @param {string} active — current layout name
 * @returns {Object<string, boolean>} element id → should be visible
 */
export function resolveControlVisibility(layoutHandlers, active) {
  const vis = {};
  for (const h of Object.values(layoutHandlers)) {
    for (const id of (h.controls || [])) vis[id] = false;
  }
  for (const id of (layoutHandlers[active]?.controls || [])) vis[id] = true;
  return vis;
}

/** Collapse chrome unless every widget is already collapsed (then expand). */
export function nextChromeCollapsed(states) {
  const list = states || [];
  if (!list.length) return true;
  return !list.every(Boolean);
}

const LAYOUT_RESET_PROMPT = 'Reset layout options to defaults? Are you sure?';

/** Are-you-sure gate for restoring DISPLAY / physics / camera defaults. */
export function confirmLayoutReset(ask) {
  const fn = ask || (typeof confirm === 'function' ? confirm : () => false);
  return !!fn(LAYOUT_RESET_PROMPT);
}
