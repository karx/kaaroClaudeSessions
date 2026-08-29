/**
 * experience/client-core/02-glyph.mjs — hex-grid geometry: project/ME glyph
 * rendering, glyph-board packing math. Part of the client-core split; see
 * experience/client-core.mjs. Loads after 00-format.mjs (needs `esc`) in the
 * browser concatenation order — real `import` below is for Node/tests only,
 * stripped at build time.
 */
import { esc } from './00-format.mjs';

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
