/**
 * lib/enrich-session.mjs — derived session fields (single source of truth).
 */

export function enrichSession(sess) {
  const t = sess.tokens;
  t.total = t.input + t.cache_create + t.cache_read + t.output;
  const inputSide = t.input + t.cache_create + t.cache_read;
  sess.cache_hit_rate = inputSide > 0 ? +(t.cache_read / inputSide * 100).toFixed(1) : 0;
  sess.duration_min   = sess.duration_ms != null ? +(sess.duration_ms / 60000).toFixed(1) : null;
  sess.tool_diversity = Object.keys(sess.tools).length;
  if (sess.first_timestamp) {
    const d = new Date(sess.first_timestamp);
    sess.day_of_week = d.getUTCDay();
    sess.hour_of_day = d.getUTCHours();
    sess.date_str    = sess.first_timestamp.slice(0, 10);
  }
}