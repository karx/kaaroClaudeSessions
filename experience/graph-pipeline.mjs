/**
 * lib/graph-pipeline.mjs
 *
 * Transforms a parsed sessions-data.json payload into graph nodes, edges,
 * and timeline data. Pure — no file I/O, no HTML generation.
 */

import {
  PALETTE, EXT_COLORS,
  calcRecencyScore, calcRecencyLevel,
  assignProjectColors, buildFileNodesAndEdges, isSessionInFlight,
} from './graph-data.mjs';
import { buildClusters } from './session-clusters.mjs';

/**
 * Build graph nodes + edges + timeline from a sessions-data.json object.
 *
 * @param {object} data          - Parsed sessions-data.json
 * @param {object} opts
 * @param {number} opts.minSessions  - Min sessions for a file node to appear (default 1)
 * @param {number} opts.referenceMs  - Epoch ms to use as "now" for recency (default data.meta.generated_at)
 * @returns {{ nodes, edges, timeline, stats }}
 */
function _topTools(toolsObj) {
  if (!toolsObj || typeof toolsObj !== 'object') return [];
  return Object.entries(toolsObj)
    .map(([name, d]) => ({ name, calls: d.calls || 0 }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);
}

export function buildGraph(data, { minSessions = 1, referenceMs, clusterOverrides = null } = {}) {
  const ref = referenceMs ?? new Date(data.meta?.generated_at ?? Date.now()).getTime();
  const recencyScore = ts => calcRecencyScore(ts, ref);
  const recencyLevel = ts => calcRecencyLevel(ts, ref);

  const { PROJECT_COLORS, COLOR_TO_INDEX } = assignProjectColors(data.projects, PALETTE);

  // Project last-activity index
  const projLastTs = {};
  for (const s of data.sessions) {
    const ts = s.last_timestamp || s.first_timestamp;
    if (ts && (!projLastTs[s.project_id] || ts > projLastTs[s.project_id]))
      projLastTs[s.project_id] = ts;
  }

  const nodes = [];
  const edges = [];

  // ── Project nodes ──────────────────────────────────────────────────────────
  for (const proj of data.projects) {
    const t       = proj.tokens;
    const pLastTs = projLastTs[proj.id] || null;
    nodes.push({
      id:            proj.id,
      type:          'project',
      label:         proj.label,
      color:         PROJECT_COLORS[proj.id] || '#888888',
      session_count: proj.session_count,
      tokens_total:  t.input + t.cache_create + t.cache_read + t.output,
      tokens_work:   t.output + t.cache_create,
      skills:        proj.skills || [],
      last_activity: pLastTs,
      recency:       recencyScore(pLastTs),
      recencyLevel:  recencyLevel(pLastTs),
    });
  }

  // ── Session nodes ──────────────────────────────────────────────────────────
  const MAX_WORK = Math.max(1, ...data.sessions.map(s =>
    (s.tokens?.output || 0) + (s.tokens?.cache_create || 0)
  ));
  const MAX_TOOL_CALLS = Math.max(1, ...data.sessions.map(s => s.tool_calls || 0));

  for (const sess of data.sessions) {
    const t           = sess.tokens || {};
    const tokens_work = (t.output || 0) + (t.cache_create || 0);
    const sizeNorm    = tokens_work > 0
      ? Math.sqrt(tokens_work / MAX_WORK)
      : Math.sqrt((sess.tool_calls || 0) / MAX_TOOL_CALLS);
    nodes.push({
      id:               sess.session_id,
      type:             'session',
      label:            sess.slug || sess.session_id.slice(0, 8),
      color:            PROJECT_COLORS[sess.project_id] || '#888888',
      project_id:       sess.project_id,
      git_branch:       sess.git_branch || null,
      harness:          sess.harness || sess.source || 'claude-code',
      tokens_work,
      tokens_cached:    t.cache_read || 0,
      tokens_output:    t.output || 0,
      tokens_total:     t.total || 0,
      cache_hit_rate:   sess.cache_hit_rate,
      tool_calls:       sess.tool_calls,
      tool_errors:      sess.tool_errors,
      tool_diversity:   sess.tool_diversity,
      message_count:    sess.message_count,
      user_turns:       sess.user_turns,
      assistant_turns:  sess.assistant_turns,
      thinking_count:   sess.content_blocks?.thinking || 0,
      hit_max_tokens:   (sess.stop_reasons?.max_tokens || 0) > 0,
      bash_git:         sess.bash_categories?.git || 0,
      skills:           sess.skills || [],
      date_str:         sess.date_str,
      first_timestamp:  sess.first_timestamp,
      duration_min:     sess.duration_min,
      first_user_message: sess.first_user_message,
      model:            sess.model,
      source:           sess.source || 'claude-code',
      context_resets:   sess.context_resets  || 0,
      ai_title:         sess.ai_title        || null,
      subagent_count:   sess.subagent_count  || 0,
      branches:         sess.branches        || [],
      tools_top:        _topTools(sess.tools),
      sizeNorm,
      errorLevel:       sess.tool_errors >= 8 ? 2 : sess.tool_errors >= 3 ? 1 : 0,
      last_activity:    sess.last_timestamp || sess.first_timestamp || null,
      recency:          recencyScore(sess.last_timestamp || sess.first_timestamp),
      recencyLevel:     recencyLevel(sess.last_timestamp || sess.first_timestamp),
      inFlight:         isSessionInFlight(sess, Date.now()),
      cluster_id:       null,
    });
    edges.push({ source: sess.session_id, target: sess.project_id, type: 'membership' });
  }

  // ── Cluster (bundle) nodes + edges ─────────────────────────────────────────
  const sessionNodeById = {};
  for (const n of nodes) if (n.type === 'session') sessionNodeById[n.id] = n;

  const clusters = buildClusters(data.sessions, clusterOverrides);
  const sumOver = (c, field) => c.member_ids.reduce((sum, id) => sum + (sessionNodeById[id]?.[field] || 0), 0);
  // Clusters normalize on their own scale — against session MAX_WORK every big
  // cluster would peg 1.0.
  const MAX_CLUSTER_WORK  = Math.max(1, ...clusters.map(c => sumOver(c, 'tokens_work')));
  const MAX_CLUSTER_CALLS = Math.max(1, ...clusters.map(c => sumOver(c, 'tool_calls')));

  for (const c of clusters) {
    const members     = c.member_ids.map(id => sessionNodeById[id]).filter(Boolean);
    const tokens_work = sumOver(c, 'tokens_work');
    const tool_calls  = sumOver(c, 'tool_calls');
    const tool_errors = sumOver(c, 'tool_errors');
    const dates       = members.map(m => m.date_str).filter(Boolean).sort();
    const lastActs    = members.map(m => m.last_activity).filter(Boolean).sort();
    const last_activity = lastActs[lastActs.length - 1] || null;
    nodes.push({
      id:               c.id,
      type:             'cluster',
      label:            c.label,
      color:            PROJECT_COLORS[c.project_id] || '#888888',
      project_id:       c.project_id,
      member_ids:       c.member_ids,
      member_count:     c.member_ids.length,
      tokens_work,
      tool_calls,
      tool_errors,
      skills:           [...new Set(members.flatMap(m => m.skills || []))],
      harnesses:        [...new Set(members.map(m => m.harness))],
      date_first:       dates[0] || null,
      date_last:        dates[dates.length - 1] || null,
      sizeNorm:         tokens_work > 0
                          ? Math.sqrt(tokens_work / MAX_CLUSTER_WORK)
                          : Math.sqrt(tool_calls / MAX_CLUSTER_CALLS),
      errorLevel:       tool_errors >= 8 ? 2 : tool_errors >= 3 ? 1 : 0,
      manual:           c.manual,
      label_overridden: c.label_overridden,
      last_activity,
      recency:          recencyScore(last_activity),
      recencyLevel:     recencyLevel(last_activity),
      inFlight:         members.some(m => m.inFlight),
    });
    edges.push({ source: c.id, target: c.project_id, type: 'membership' });
    for (const id of c.member_ids) {
      edges.push({ source: id, target: c.id, type: 'bundle' });
      if (sessionNodeById[id]) sessionNodeById[id].cluster_id = c.id;
    }
  }

  // ── Branch lineage edges ────────────────────────────────────────────────────
  const branchGroups = {};
  for (const sess of data.sessions) {
    const b = sess.git_branch || '__unknown__';
    (branchGroups[b] = branchGroups[b] || []).push(sess);
  }
  for (const group of Object.values(branchGroups)) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.first_timestamp || '') < (b.first_timestamp || '') ? -1 : 1);
    for (let i = 0; i < sorted.length - 1; i++)
      edges.push({ source: sorted[i].session_id, target: sorted[i + 1].session_id, type: 'branch', branch: sorted[i].git_branch });
  }

  // ── File nodes + edges ─────────────────────────────────────────────────────
  const globalFiles = data.rollup?.files || [];
  const sessById    = {};
  data.sessions.forEach(s => sessById[s.session_id] = s);
  const { nodes: fileNodes, edges: fileEdges } =
    buildFileNodesAndEdges(globalFiles, sessById, { minSessions, referenceMs: ref });
  nodes.push(...fileNodes);
  edges.push(...fileEdges);

  // ── Timeline strip ─────────────────────────────────────────────────────────
  const timeline = data.sessions
    .filter(s => s.date_str)
    .sort((a, b) => (a.first_timestamp || '') < (b.first_timestamp || '') ? -1 : 1)
    .map(s => ({
      id:          s.session_id,
      date_str:    s.date_str,
      ts:          s.first_timestamp,
      color:       PROJECT_COLORS[s.project_id] || '#888',
      project:     s.project_label || s.project_id,
      slug:        s.slug || s.session_id.slice(0, 8),
      tokens_work: ((s.tokens?.output || 0) + (s.tokens?.cache_create || 0)) || s.tool_calls || 0,
      tool_errors: s.tool_errors,
      skills:      s.skills || [],
    }));

  const stats = {
    project: nodes.filter(n => n.type === 'project').length,
    session: nodes.filter(n => n.type === 'session').length,
    cluster: nodes.filter(n => n.type === 'cluster').length,
    file:    nodes.filter(n => n.type === 'file').length,
    membership: edges.filter(e => e.type === 'membership').length,
    bundle:     edges.filter(e => e.type === 'bundle').length,
    branch:     edges.filter(e => e.type === 'branch').length,
    write:      edges.filter(e => e.type === 'write').length,
    edit:       edges.filter(e => e.type === 'edit').length,
    read:       edges.filter(e => e.type === 'read').length,
  };

  return { nodes, edges, timeline, stats, PROJECT_COLORS, COLOR_TO_INDEX };
}
