import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionInFlight } from '../build.mjs';

const REF_MS  = new Date('2026-05-07T12:00:00Z').getTime();
const DEFAULT_THRESHOLD = 2 * 60 * 1000; // 2 minutes

// ── isSessionInFlight ─────────────────────────────────────────────────────────

test('isSessionInFlight — null / missing timestamp', async t => {
  await t.test('returns false when last_timestamp is null', () => {
    assert.equal(isSessionInFlight({ last_timestamp: null }, REF_MS), false);
  });

  await t.test('returns false when last_timestamp is undefined', () => {
    assert.equal(isSessionInFlight({}, REF_MS), false);
  });
});

test('isSessionInFlight — within threshold', async t => {
  await t.test('returns true when age is 0 (same instant)', () => {
    const ts = new Date(REF_MS).toISOString();
    assert.equal(isSessionInFlight({ last_timestamp: ts }, REF_MS), true);
  });

  await t.test('returns true when age is 1 minute (below default 2 min threshold)', () => {
    const ts = new Date(REF_MS - 60 * 1000).toISOString();
    assert.equal(isSessionInFlight({ last_timestamp: ts }, REF_MS), true);
  });

  await t.test('returns true when age equals threshold minus 1 ms', () => {
    const ts = new Date(REF_MS - DEFAULT_THRESHOLD + 1).toISOString();
    assert.equal(isSessionInFlight({ last_timestamp: ts }, REF_MS), true);
  });
});

test('isSessionInFlight — at or beyond threshold', async t => {
  await t.test('returns false when age equals the threshold exactly', () => {
    const ts = new Date(REF_MS - DEFAULT_THRESHOLD).toISOString();
    assert.equal(isSessionInFlight({ last_timestamp: ts }, REF_MS), false);
  });

  await t.test('returns false when age is 5 minutes (above default)', () => {
    const ts = new Date(REF_MS - 5 * 60 * 1000).toISOString();
    assert.equal(isSessionInFlight({ last_timestamp: ts }, REF_MS), false);
  });
});

test('isSessionInFlight — future timestamp', async t => {
  await t.test('returns false when last_timestamp is in the future', () => {
    const ts = new Date(REF_MS + 10 * 1000).toISOString();
    assert.equal(isSessionInFlight({ last_timestamp: ts }, REF_MS), false);
  });
});

test('isSessionInFlight — custom threshold', async t => {
  await t.test('respects custom thresholdMs of 30 seconds', () => {
    const inRange  = new Date(REF_MS - 20 * 1000).toISOString();
    const outRange = new Date(REF_MS - 45 * 1000).toISOString();
    assert.equal(isSessionInFlight({ last_timestamp: inRange  }, REF_MS, 30 * 1000), true);
    assert.equal(isSessionInFlight({ last_timestamp: outRange }, REF_MS, 30 * 1000), false);
  });

  await t.test('respects custom thresholdMs of 10 minutes', () => {
    const ts = new Date(REF_MS - 5 * 60 * 1000).toISOString();
    assert.equal(isSessionInFlight({ last_timestamp: ts }, REF_MS, 10 * 60 * 1000), true);
  });
});
