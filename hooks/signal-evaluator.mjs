/**
 * hooks/signal-evaluator.mjs — session-scoped policy evaluation (W-POL-02/03).
 *
 * Pure: (session, policy) → signals[]. No I/O, no Date.now() — caller
 * supplies `now`. Signals only; evaluation never blocks anything.
 *
 * Rules are evaluated in order; the first rule whose match predicates ALL
 * hold wins (one rule signal per session). A rule containing an unsupported
 * predicate is skipped with a visible INFO diagnostic instead of silently
 * not matching — misconfigured rules must be discoverable.
 */

// predicate key → (session, value) → boolean
const PREDICATES = {
  'skill':             (s, v) => (s.skills || []).includes(v),
  'tool':              (s, v) => Boolean(s.tools?.[v]),
  'tool_errors.gt':    (s, v) => (s.tool_errors    || 0) > v,
  'cache_hit_rate.lt': (s, v) => (s.cache_hit_rate || 0) < v,
  'duration_min.gt':   (s, v) => (s.duration_min   || 0) > v,
  'project':           (s, v) => s.project_label === v,
  'compact_count.gt':  (s, v) => (s.context_resets || 0) > v,
};

function makeSignal(sess, rule, nowIso, context) {
  return {
    ts:            nowIso,                  // analysis time, not session time
    session_id:    sess.session_id,
    project_id:    sess.project_id,
    project_label: sess.project_label,
    session_ts:    sess.first_timestamp || null,
    rule_id:       rule.id,
    signal:        rule.signal,
    reason:        rule.reason,
    context,
  };
}

/** Evaluate one session against policy.rules. Returns signals (possibly empty). */
export function evaluateSession(sess, policy, { now = new Date() } = {}) {
  const nowIso  = now.toISOString();
  const signals = [];

  for (const rule of policy?.rules || []) {
    const match = rule.match || {};
    const unsupported = Object.keys(match).find(k => !PREDICATES[k]);
    if (unsupported) {
      signals.push({
        ...makeSignal(sess, rule, nowIso, { predicate: unsupported }),
        rule_id: `diagnostic:${rule.id}`,
        signal:  'INFO',
        reason:  `unsupported predicate "${unsupported}" — rule "${rule.id}" skipped`,
      });
      continue;
    }
    const holds = Object.entries(match).every(([k, v]) => PREDICATES[k](sess, v));
    if (holds) {
      signals.push(makeSignal(sess, rule, nowIso, { ...match }));
      break; // first matching rule wins
    }
  }

  return signals;
}

/** Evaluate all sessions → signals-data.json payload (W-REP-02 shape). */
export function buildSignalsData(sessions, policy, { now = new Date() } = {}) {
  const signals = [];
  for (const sess of sessions || [])
    signals.push(...evaluateSession(sess, policy, { now }));

  const by_level = {};
  const by_rule  = {};
  for (const sig of signals) {
    by_level[sig.signal]  = (by_level[sig.signal]  || 0) + 1;
    by_rule[sig.rule_id]  = (by_rule[sig.rule_id]  || 0) + 1;
  }

  return {
    generated_at:  now.toISOString(),
    total_signals: signals.length,
    by_level,
    by_rule,
    signals,
  };
}
