/**
 * test/signal-evaluator.test.mjs → hooks/signal-evaluator.mjs (W-POL-02/03)
 *
 * Pure session-scoped rule evaluation → signals[]. First matching rule wins.
 * Unsupported predicates skip the rule with a visible INFO diagnostic.
 * No Date.now() inside — caller supplies `now` (active-state convention).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSession, buildSignalsData } from '../hooks/signal-evaluator.mjs';

const NOW = new Date('2026-07-19T12:00:00.000Z');

function makeSess(overrides = {}) {
  return {
    session_id: 'abc12345-0000-0000-0000-000000000000',
    project_id: 'D--src-kaaroSkills',
    project_label: 'kaaroSkills',
    first_timestamp: '2026-07-18T09:00:00.000Z',
    tokens: { input: 10, output: 20, cache_create: 5, cache_read: 0 },
    tools: { Read: { calls: 5, errors: 0 }, Bash: { calls: 3, errors: 1 } },
    skills: ['visualize-seed'],
    tool_calls: 8,
    tool_errors: 1,
    cache_hit_rate: 12,
    duration_min: 42,
    context_resets: 1,
    ...overrides,
  };
}

function rule(overrides = {}) {
  return { id: 'r1', match: { skill: 'visualize-seed' }, signal: 'WARN', reason: 'test rule', ...overrides };
}

// ── predicates ────────────────────────────────────────────────────────────────

test('evaluateSession — skill predicate matches session.skills', () => {
  const sigs = evaluateSession(makeSess(), { rules: [rule()] }, { now: NOW });
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].rule_id, 'r1');
  assert.equal(sigs[0].signal, 'WARN');
});

test('evaluateSession — tool predicate matches when tool present', () => {
  const r = rule({ match: { tool: 'Bash' } });
  assert.equal(evaluateSession(makeSess(), { rules: [r] }, { now: NOW }).length, 1);
  const r2 = rule({ match: { tool: 'WebFetch' } });
  assert.equal(evaluateSession(makeSess(), { rules: [r2] }, { now: NOW }).length, 0);
});

test('evaluateSession — numeric predicates gt/lt', () => {
  const cases = [
    [{ 'tool_errors.gt': 0 },     1],
    [{ 'tool_errors.gt': 5 },     0],
    [{ 'cache_hit_rate.lt': 20 }, 1],
    [{ 'cache_hit_rate.lt': 5 },  0],
    [{ 'duration_min.gt': 30 },   1],
    [{ 'duration_min.gt': 60 },   0],
    [{ 'compact_count.gt': 0 },   1],
    [{ 'compact_count.gt': 3 },   0],
  ];
  for (const [match, expected] of cases) {
    const sigs = evaluateSession(makeSess(), { rules: [rule({ match })] }, { now: NOW });
    assert.equal(sigs.length, expected, JSON.stringify(match));
  }
});

test('evaluateSession — project predicate matches project_label', () => {
  const r = rule({ match: { project: 'kaaroSkills' } });
  assert.equal(evaluateSession(makeSess(), { rules: [r] }, { now: NOW }).length, 1);
});

test('evaluateSession — all predicates in match must hold (AND)', () => {
  const r = rule({ match: { skill: 'visualize-seed', tool: 'WebFetch' } });
  assert.equal(evaluateSession(makeSess(), { rules: [r] }, { now: NOW }).length, 0);
});

// ── rule ordering + diagnostics ───────────────────────────────────────────────

test('evaluateSession — first matching rule wins, later rules not evaluated', () => {
  const rules = [
    rule({ id: 'first',  match: { tool: 'Read' }, signal: 'INFO' }),
    rule({ id: 'second', match: { tool: 'Bash' }, signal: 'ALERT' }),
  ];
  const sigs = evaluateSession(makeSess(), { rules }, { now: NOW });
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].rule_id, 'first');
});

test('evaluateSession — unsupported predicate skips rule with INFO diagnostic', () => {
  const rules = [
    rule({ id: 'attr-rule', match: { 'tools.contains': 'Bash' } }), // W-OBS-02 not implemented
    rule({ id: 'fallback',  match: { tool: 'Bash' } }),
  ];
  const sigs = evaluateSession(makeSess(), { rules }, { now: NOW });
  assert.equal(sigs.length, 2);
  assert.equal(sigs[0].rule_id, 'diagnostic:attr-rule');
  assert.equal(sigs[0].signal, 'INFO');
  assert.match(sigs[0].reason, /tools\.contains/);
  assert.equal(sigs[1].rule_id, 'fallback'); // skipped rule doesn't block later rules
});

// ── signal shape (W-POL-03) ───────────────────────────────────────────────────

test('evaluateSession — signal carries the W-POL-03 shape', () => {
  const [sig] = evaluateSession(makeSess(), { rules: [rule()] }, { now: NOW });
  assert.equal(sig.ts, NOW.toISOString());                       // analysis time
  assert.equal(sig.session_id, 'abc12345-0000-0000-0000-000000000000');
  assert.equal(sig.project_id, 'D--src-kaaroSkills');
  assert.equal(sig.project_label, 'kaaroSkills');
  assert.equal(sig.session_ts, '2026-07-18T09:00:00.000Z');      // when the session ran
  assert.equal(sig.rule_id, 'r1');
  assert.equal(sig.signal, 'WARN');
  assert.equal(sig.reason, 'test rule');
  assert.equal(typeof sig.context, 'object');
  assert.equal(sig.context.skill, 'visualize-seed');
});

// ── buildSignalsData (signals-data.json / W-REP-02 shape) ─────────────────────

test('buildSignalsData — aggregates by_level and by_rule', () => {
  const sessions = [
    makeSess(),
    makeSess({ session_id: 's2', skills: [], tool_errors: 9 }),
  ];
  const policy = { rules: [
    rule({ id: 'skill-rule', match: { skill: 'visualize-seed' }, signal: 'WARN' }),
    rule({ id: 'errors',     match: { 'tool_errors.gt': 5 },     signal: 'ALERT' }),
  ] };
  const data = buildSignalsData(sessions, policy, { now: NOW });
  assert.equal(data.generated_at, NOW.toISOString());
  assert.equal(data.total_signals, 2);
  assert.deepEqual(data.by_level, { WARN: 1, ALERT: 1 });
  assert.deepEqual(data.by_rule, { 'skill-rule': 1, errors: 1 });
  assert.equal(data.signals.length, 2);
});

test('buildSignalsData — null/empty policy → empty payload, never throws', () => {
  const empty = buildSignalsData([makeSess()], null, { now: NOW });
  assert.equal(empty.total_signals, 0);
  assert.deepEqual(empty.signals, []);
});
