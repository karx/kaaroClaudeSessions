/**
 * lib/enrich-session.mjs — derived session fields (single source of truth).
 *
 * ALL token arithmetic lives here. Downstream consumers (graph-pipeline,
 * timeline, policy evaluator) pass these fields through — they never
 * recompute them.
 */

import { toolNameToKey, isBashToolName, TOOL_ACTION_KEYS } from './action-keys.mjs';

/** AI "work" tokens: generated output + cache writes. */
export function tokensWork(t) {
  return (t?.output || 0) + (t?.cache_create || 0);
}

/**
 * Canonical cross-harness tool-category counts for a session. Raw tool names
 * in `session.tools` vary per harness (`Bash`, `view_file`, `run_command`...);
 * this canonicalizes them onto TOOL_ACTION_KEYS so harnesses become comparable.
 * Bash-family calls are excluded from the generic name walk and taken directly
 * from `session.bash_categories` (git/run/other), since `session.tools` has no
 * per-call category attached to re-derive the bash_git/bash_run/bash_other split.
 */
export function computeToolMix(session) {
  const mix = {};
  for (const key of TOOL_ACTION_KEYS) mix[key] = 0;

  for (const [name, stats] of Object.entries(session.tools || {})) {
    if (isBashToolName(name)) continue;
    const key = toolNameToKey(name);
    mix[key] = (mix[key] || 0) + (stats.calls || 0);
  }

  const bc = session.bash_categories || {};
  mix.bash_git   = bc.git   || 0;
  mix.bash_run   = bc.run   || 0;
  mix.bash_other = bc.other || 0;

  return mix;
}

export function enrichSession(sess) {
  const t = sess.tokens;
  t.total = t.input + t.cache_create + t.cache_read + t.output;
  sess.tokens_work = tokensWork(t);
  const inputSide = t.input + t.cache_create + t.cache_read;
  sess.cache_hit_rate = inputSide > 0 ? +(t.cache_read / inputSide * 100).toFixed(1) : 0;
  sess.duration_min   = sess.duration_ms != null ? +(sess.duration_ms / 60000).toFixed(1) : null;
  sess.tool_diversity = Object.keys(sess.tools).length;
  sess.tool_mix       = computeToolMix(sess);
  if (sess.first_timestamp) {
    const d = new Date(sess.first_timestamp);
    sess.day_of_week = d.getUTCDay();
    sess.hour_of_day = d.getUTCHours();
    sess.date_str    = sess.first_timestamp.slice(0, 10);
  }
}

/** Derived token fields for a project summary (aggregated tokens object). */
export function enrichProject(proj) {
  const t = proj.tokens || {};
  proj.tokens_work  = tokensWork(t);
  proj.tokens_total = (t.input || 0) + (t.cache_create || 0) + (t.cache_read || 0) + (t.output || 0);
}
