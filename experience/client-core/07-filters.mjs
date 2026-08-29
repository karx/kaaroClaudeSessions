/**
 * experience/client-core/07-filters.mjs — history-view session/cluster
 * filtering. Part of the client-core split; see experience/client-core.mjs.
 */

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
