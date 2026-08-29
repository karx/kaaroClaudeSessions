/**
 * experience/client-core/01-color.mjs — the color vocabulary (tool/edge
 * hues). Part of the client-core split; see experience/client-core.mjs.
 */

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
