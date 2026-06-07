import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bpmToInterval, beatPosition, eventsInWindow, pushBeatEvent } from '../lib/beat-clock.mjs';

// ── bpmToInterval ─────────────────────────────────────────────────────────────

test('bpmToInterval — 120 bpm → 0.5 s', () => {
  assert.equal(bpmToInterval(120), 0.5);
});

test('bpmToInterval — 60 bpm → 1 s', () => {
  assert.equal(bpmToInterval(60), 1);
});

test('bpmToInterval — 240 bpm → 0.25 s', () => {
  assert.equal(bpmToInterval(240), 0.25);
});

test('bpmToInterval — result is always positive (even for 0)', () => {
  assert.ok(bpmToInterval(0) > 0, 'degenerate bpm must not produce 0 or negative interval');
});

// ── beatPosition ──────────────────────────────────────────────────────────────
// Convention: eventTimeMs is wall-clock ms, currentTimeMs is "now" in ms.
// Result is beat offset relative to current time: negative = past, positive = future.

test('beatPosition — event at current time → 0', () => {
  assert.equal(beatPosition(1000, 1000, 120), 0);
});

test('beatPosition — event one beat ago at 120 bpm → -1', () => {
  // beat interval = 500ms, so 1 beat ago = currentTime - 500
  assert.equal(beatPosition(500, 1000, 120), -1);
});

test('beatPosition — event half-beat ago → -0.5', () => {
  assert.equal(beatPosition(750, 1000, 120), -0.5);
});

test('beatPosition — event one beat in future → +1', () => {
  assert.equal(beatPosition(1500, 1000, 120), 1);
});

test('beatPosition — event two beats ago at 60 bpm → -2', () => {
  // beat interval = 1000ms, 2 beats = 2000ms
  assert.equal(beatPosition(0, 2000, 60), -2);
});

// ── eventsInWindow ────────────────────────────────────────────────────────────
// events = [{ ts: ms, color, label }, ...]
// Returns [{ x: 0..1, color, label }, ...] sorted oldest-first (x ascending)

test('eventsInWindow — empty events → []', () => {
  assert.deepEqual(eventsInWindow([], 1000, 8, 120), []);
});

test('eventsInWindow — event outside window (too old) → excluded', () => {
  // 8 beats at 120bpm = 4000ms window. Event 5000ms ago is outside.
  const events = [{ ts: 0, color: '#ff0', label: 'old' }];
  const result = eventsInWindow(events, 5000, 8, 120);
  assert.deepEqual(result, []);
});

test('eventsInWindow — future event → excluded', () => {
  const events = [{ ts: 2000, color: '#ff0', label: 'future' }];
  const result = eventsInWindow(events, 1000, 8, 120);
  assert.deepEqual(result, []);
});

test('eventsInWindow — event inside window → included', () => {
  // 4 beats at 120bpm = 2000ms window. Event 500ms ago is inside.
  const events = [{ ts: 500, color: '#ff0', label: 'test' }];
  const result = eventsInWindow(events, 1000, 4, 120);
  assert.equal(result.length, 1);
});

test('eventsInWindow — x is in [0, 1] for any in-window event', () => {
  const events = [{ ts: 600, color: '#ff0', label: 'mid' }];
  const result = eventsInWindow(events, 1000, 4, 120);
  const { x } = result[0];
  assert.ok(x >= 0 && x <= 1, `x=${x} not in [0,1]`);
});

test('eventsInWindow — most recent event → x near 1 (right edge)', () => {
  // Event just 50ms ago → near the right edge
  const events = [{ ts: 950, color: '#ff0', label: 'now' }];
  const result = eventsInWindow(events, 1000, 4, 120);
  assert.ok(result[0].x > 0.9, `expected x > 0.9, got ${result[0].x}`);
});

test('eventsInWindow — event at window start → x near 0 (left edge)', () => {
  // 4 beats at 120bpm = 2000ms. Event 1990ms ago is near the left edge.
  const events = [{ ts: 10, color: '#ff0', label: 'edge' }];
  const result = eventsInWindow(events, 2000, 4, 120);
  assert.ok(result[0].x < 0.1, `expected x < 0.1, got ${result[0].x}`);
});

test('eventsInWindow — preserves color and label', () => {
  const events = [{ ts: 500, color: '#aabbcc', label: 'Read' }];
  const result = eventsInWindow(events, 1000, 8, 120);
  assert.equal(result[0].color, '#aabbcc');
  assert.equal(result[0].label, 'Read');
});

test('eventsInWindow — multiple events sorted oldest-first (x ascending)', () => {
  const events = [
    { ts: 900, color: '#a', label: 'recent' },
    { ts: 200, color: '#b', label: 'old' },
    { ts: 550, color: '#c', label: 'mid' },
  ];
  const result = eventsInWindow(events, 1000, 8, 120);
  assert.equal(result.length, 3);
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i].x >= result[i - 1].x, 'events must be sorted by x ascending');
  }
});

test('eventsInWindow — event exactly at window boundary → included (x≈0)', () => {
  // Exactly 8 beats ago at 120bpm = 4000ms ago
  const events = [{ ts: 0, color: '#ff0', label: 'edge' }];
  const result = eventsInWindow(events, 4000, 8, 120);
  assert.equal(result.length, 1);
  assert.ok(result[0].x >= 0 && result[0].x <= 0.01);
});

// ── pushBeatEvent ─────────────────────────────────────────────────────────────
// Ring buffer for the rolling timeline. Keeps the last maxSize events.

test('pushBeatEvent — appends event to empty ring', () => {
  const ring = pushBeatEvent([], { ts: 1, label: 'Read' });
  assert.equal(ring.length, 1);
  assert.equal(ring[0].label, 'Read');
});

test('pushBeatEvent — appends to end (newest last)', () => {
  let ring = [];
  ring = pushBeatEvent(ring, { ts: 1, label: 'first' });
  ring = pushBeatEvent(ring, { ts: 2, label: 'second' });
  assert.equal(ring[ring.length - 1].label, 'second');
});

test('pushBeatEvent — is pure (does not mutate original ring)', () => {
  const ring0 = [{ ts: 1, label: 'a' }];
  pushBeatEvent(ring0, { ts: 2, label: 'b' });
  assert.equal(ring0.length, 1);
});

test('pushBeatEvent — trims to maxSize, keeping newest', () => {
  let ring = [];
  for (let i = 0; i < 5; i++) ring = pushBeatEvent(ring, { ts: i, label: `e${i}` }, 3);
  assert.equal(ring.length, 3);
  assert.equal(ring[ring.length - 1].label, 'e4');
  assert.equal(ring[0].label, 'e2');
});

test('pushBeatEvent — default maxSize is 1000', () => {
  let ring = [];
  for (let i = 0; i < 1001; i++) ring = pushBeatEvent(ring, { ts: i, label: `e${i}` });
  assert.equal(ring.length, 1000);
});

test('pushBeatEvent — at exactly maxSize, ring stays same length after push', () => {
  let ring = [];
  for (let i = 0; i < 10; i++) ring = pushBeatEvent(ring, { ts: i }, 10);
  assert.equal(ring.length, 10);
  ring = pushBeatEvent(ring, { ts: 99 }, 10);
  assert.equal(ring.length, 10);
});
