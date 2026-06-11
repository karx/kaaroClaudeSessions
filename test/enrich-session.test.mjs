import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichSession } from '../hooks/enrich-session.mjs';

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