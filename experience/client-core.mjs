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
export const HARNESS_FILL_OPACITY = 0.35;

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
    toolColors: { tokens: '#00ddcc', words: '#00aaff' },
    blockW: e => e.type === 'tokens' ? 3 : 8,
    blockH: e => e.type === 'tokens'
      ? Math.max(0.1, Math.min(0.8, Math.log1p((e.output || 0) / 200) * 0.35))
      : Math.max(0.1, Math.min(0.85, (e.word_count || 0) / 80)),
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

// ── Cognition pulse vocabulary (ticker / overlays) ────────────────────────────

export const PULSE_GLYPHS = {
  human_turn: '⌨', compact: '⟲', permission: '⚙', mode_shift: '⚙',
  tool_error: '✖', api_error: '⊘', attachment: '⊕', scaffold: '▤',
};

/**
 * Ticker line for a cognition pulse. Returns { text, role } or null when the
 * event should stay out of the ticker (chirps — too chatty).
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
  for (const [name, h] of Object.entries(layoutHandlers)) {
    for (const id of (h.controls || [])) vis[id] = name === active;
  }
  return vis;
}
