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

export const EDGE_COLORS  = { membership: '#1e3d7a', write: '#00ff88', edit: '#ffcc00', read: '#1e4a66', branch: '#334455' };
export const EDGE_OPACITY = { membership: .55, write: .65, edit: .65, read: .28, branch: .4 };
export const EDGE_WIDTH   = { membership: 1.4, write: 1, edit: 1, read: .7, branch: .8 };

// ── Geometry ──────────────────────────────────────────────────────────────────

export const NODE_RADII = { PROJ_R: 26, SR_MIN: 5, SR_MAX: 20, FR_MIN: 3, FR_MAX: 13 };

export function nodeRadius(d, r = NODE_RADII) {
  if (d.type === 'project') return r.PROJ_R;
  if (d.type === 'session') return r.SR_MIN + (r.SR_MAX - r.SR_MIN) * (d.sizeNorm || 0);
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
