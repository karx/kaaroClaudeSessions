/**
 * experience/client-core/10-controls.mjs — declarative layout-control
 * show/hide and the reset-confirmation gate. Part of the client-core split;
 * see experience/client-core.mjs.
 */

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
