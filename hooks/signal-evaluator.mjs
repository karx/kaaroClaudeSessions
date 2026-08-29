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
 *
 * tools.contains (W-OBS-02): rule form `{ skill: X, 'tools.contains': Y }`
 * matches when skill_attribution[X].tools[Y] is present. Emits INFO diagnostic
 * when skill_attribution is absent (not collected) or skill companion is missing.
 */

// predicate key → (session, value, match) → boolean
const PREDICATES = {
  'skill':             (s, v) => (s.skills || []).includes(v),
  'tool':              (s, v) => Boolean(s.tools?.[v]),
  'tool_errors.gt':    (s, v) => (s.tool_errors    || 0) > v,
  // null on cache_accounting:false harnesses (Codex, Copilot) means "unknown",
  // not "zero" — must not match, or every such session would falsely signal.
  'cache_hit_rate.lt': (s, v) => s.cache_hit_rate != null && s.cache_hit_rate < v,
  'duration_min.gt':   (s, v) => (s.duration_min   || 0) > v,
  'project':           (s, v) => s.project_label === v,
  'compact_count.gt':  (s, v) => (s.context_resets || 0) > v,
  // Companion `skill` required; absence handled before PREDICATES runs.
  'tools.contains':    (s, tool, match) => {
    const skill = match.skill;
    const n = s.skill_attribution?.[skill]?.tools?.[tool];
    return typeof n === 'number' ? n > 0 : Boolean(n);
  },
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

function makeDiagnostic(sess, rule, nowIso, reason, context) {
  return {
    ...makeSignal(sess, rule, nowIso, context),
    rule_id: `diagnostic:${rule.id}`,
    signal:  'INFO',
    reason,
  };
}

/** Evaluate one session against policy.rules. Returns signals (possibly empty). */
export function evaluateSession(sess, policy, { now = new Date() } = {}) {
  const nowIso  = now.toISOString();
  const signals = [];

  for (const rule of policy?.rules || []) {
    const match = rule.match || {};

    // tools.contains needs W-OBS-02 attribution data + a skill companion.
    if (Object.prototype.hasOwnProperty.call(match, 'tools.contains')) {
      if (sess.skill_attribution == null) {
        signals.push(makeDiagnostic(
          sess, rule, nowIso,
          `tools.contains requires skill_attribution — rule "${rule.id}" skipped (attribution data absent)`,
          { predicate: 'tools.contains' },
        ));
        continue;
      }
      if (!match.skill) {
        signals.push(makeDiagnostic(
          sess, rule, nowIso,
          `tools.contains requires companion "skill" in match — rule "${rule.id}" skipped`,
          { predicate: 'tools.contains' },
        ));
        continue;
      }
    }

    const unsupported = Object.keys(match).find(k => !PREDICATES[k]);
    if (unsupported) {
      signals.push(makeDiagnostic(
        sess, rule, nowIso,
        `unsupported predicate "${unsupported}" — rule "${rule.id}" skipped`,
        { predicate: unsupported },
      ));
      continue;
    }
    const holds = Object.entries(match).every(([k, v]) => PREDICATES[k](sess, v, match));
    if (holds) {
      signals.push(makeSignal(sess, rule, nowIso, { ...match }));
      break; // first matching rule wins
    }
  }

  return signals;
}

/**
 * Evaluate all sessions → signals-data.json payload (W-REP-02 shape).
 * Diagnostic signals (rule_id starts with `diagnostic:`) are deduped per rule
 * so one bad predicate does not spam N sessions.
 */
export function buildSignalsData(sessions, policy, { now = new Date() } = {}) {
  const signals = [];
  const seenDiagnostics = new Set();

  for (const sess of sessions || []) {
    for (const sig of evaluateSession(sess, policy, { now })) {
      if (sig.rule_id.startsWith('diagnostic:')) {
        if (seenDiagnostics.has(sig.rule_id)) continue;
        seenDiagnostics.add(sig.rule_id);
      }
      signals.push(sig);
    }
  }

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
