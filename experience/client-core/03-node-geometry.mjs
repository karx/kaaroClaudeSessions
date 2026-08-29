/**
 * experience/client-core/03-node-geometry.mjs — graph node/edge sizing and
 * live-feed block geometry. Part of the client-core split; see
 * experience/client-core.mjs. Real `import`s below are for Node/tests only,
 * stripped at build time (loads after 01-color.mjs and 02-glyph.mjs).
 */
import { EDGE_OPACITY, EDGE_WIDTH } from './01-color.mjs';
import { NODE_RADII } from './02-glyph.mjs';

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
