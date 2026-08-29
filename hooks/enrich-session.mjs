/**
 * lib/enrich-session.mjs — derived session fields (single source of truth).
 *
 * ALL token arithmetic lives here. Downstream consumers (graph-pipeline,
 * timeline, policy evaluator) pass these fields through — they never
 * recompute them.
 */

/** AI "work" tokens: generated output + cache writes. */
export function tokensWork(t) {
  return (t?.output || 0) + (t?.cache_create || 0);
}

export function enrichSession(sess) {
  const t = sess.tokens;
  t.total = t.input + t.cache_create + t.cache_read + t.output;
  sess.tokens_work  = tokensWork(t);
  sess.tokens_total = t.total;
  const inputSide = t.input + t.cache_create + t.cache_read;
  // cache_accounting:false harnesses (Codex, Copilot) zero input/cache fields
  // to protect tokens_total/sizeNorm from a non-per-turn-delta signal —
  // that same zeroing makes the ratio look like "0% cached" when the truth
  // is unknown, not zero. null lets consumers render N/A instead of a lie.
  sess.cache_hit_rate = sess.cache_accounting === false
    ? null
    : inputSide > 0 ? +(t.cache_read / inputSide * 100).toFixed(1) : 0;
  sess.duration_min   = sess.duration_ms != null ? +(sess.duration_ms / 60000).toFixed(1) : null;
  sess.tool_diversity = Object.keys(sess.tools).length;
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
