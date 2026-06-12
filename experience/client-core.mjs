/**
 * experience/client-core.mjs — shared browser core for every page
 * (graph, Mission Control, DAW): formatters, color vocabulary, geometry,
 * SSE wiring. The single source of truth for helpers that were previously
 * triplicated across 01-data.js, 05-interaction.js, 16-beat-overlay.js,
 * 19-daw-builder.js, and now.html.
 *
 * SYNTAX CONTRACT: only `export function` / `export const` at top level —
 * build.mjs strips the `export ` prefix and injects the body into page
 * bundles as %%CLIENT_CORE%%, so this file must also be valid plain script.
 * Node tests import it as a normal ESM module.
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
