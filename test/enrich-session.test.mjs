import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichSession, enrichProject, tokensWork } from '../hooks/enrich-session.mjs';

function baseSession(overrides = {}) {
  return {
    tokens: { input: 100, output: 50, cache_create: 20, cache_read: 80 },
    tools: { Read: { calls: 2, errors: 0 }, Write: { calls: 1, errors: 0 } },
    duration_ms: 120000,
    first_timestamp: '2026-05-01T14:30:00.000Z',
    ...overrides,
  };
}

test('enrichSession — computes token totals and cache_hit_rate', () => {
  const s = baseSession();
  enrichSession(s);
  assert.equal(s.tokens.total, 250);
  assert.equal(s.cache_hit_rate, 40);
  assert.equal(s.tool_diversity, 2);
  assert.equal(s.duration_min, 2);
  assert.equal(s.date_str, '2026-05-01');
  assert.equal(typeof s.day_of_week, 'number');
  assert.equal(typeof s.hour_of_day, 'number');
});

test('enrichSession — cache_hit_rate zero when no input side', () => {
  const s = baseSession({ tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 } });
  enrichSession(s);
  assert.equal(s.cache_hit_rate, 0);
});

test('enrichSession — duration_min null when duration_ms absent', () => {
  const s = baseSession({ duration_ms: null });
  enrichSession(s);
  assert.equal(s.duration_min, null);
});

// ── tokens_work: single source of truth ───────────────────────────────────────

test('tokensWork — output + cache_create, missing fields default to 0', () => {
  assert.equal(tokensWork({ output: 80, cache_create: 20 }), 100);
  assert.equal(tokensWork({ output: 5 }), 5);
  assert.equal(tokensWork({}), 0);
  assert.equal(tokensWork(undefined), 0);
});

test('enrichSession — sets tokens_work from tokens', () => {
  const s = baseSession(); // output 50 + cache_create 20
  enrichSession(s);
  assert.equal(s.tokens_work, 70);
});

test('enrichSession — sets tokens_total (overall consumption) as a top-level field', () => {
  const s = baseSession(); // 100+50+20+80
  enrichSession(s);
  assert.equal(s.tokens_total, 250);
  assert.equal(s.tokens_total, s.tokens.total);
});

test('enrichProject — sets tokens_work and tokens_total on a project summary', () => {
  const p = { id: 'proj-a', tokens: { input: 100, output: 200, cache_create: 50, cache_read: 30 } };
  enrichProject(p);
  assert.equal(p.tokens_work, 250);
  assert.equal(p.tokens_total, 380);
});