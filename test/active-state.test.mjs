/**
 * test/active-state.test.mjs → lib/active-state.mjs
 *
 * Mission Control core: live per-session activity state, fed by pulse
 * objects ({ event, data }) from lib/pulse-transformer.mjs.
 * Pure module — caller supplies `now` (epoch ms); no Date.now() inside.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createActiveState,
  applyPulse,
  snapshotActive,
  DEFAULT_THRESHOLDS,
} from '../surface/active-state.mjs';

const T0 = 1_750_000_000_000; // arbitrary fixed epoch ms

function pulse(event, data = {}) {
  return {
    event,
    data: {
      session_id: 'aaaabbbb-1111-2222-3333-444455556666',
      slug: 'aaaabbbb',
      harness: 'claude-code',
      project: 'kaaroSessions',
      ts: null,
      ...data,
    },
  };
}

// ── creation ──────────────────────────────────────────────────────────────────

test('createActiveState — empty snapshot', () => {
  const state = createActiveState();
  const snap = snapshotActive(state, T0);
  assert.deepEqual(snap.sessions, []);
  assert.deepEqual(snap.by_harness, {});
  assert.equal(snap.totals.sessions, 0);
  assert.equal(snap.totals.active, 0);
});

// ── tool_call ─────────────────────────────────────────────────────────────────

test('applyPulse tool_call — creates session entry with last_tool + counts', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tool_call', { tool: 'Read', key: 'read', where: 'D:/x/a.mjs', why: null }), T0);

  const snap = snapshotActive(state, T0);
  assert.equal(snap.sessions.length, 1);
  const s = snap.sessions[0];
  assert.equal(s.session_id, 'aaaabbbb-1111-2222-3333-444455556666');
  assert.equal(s.slug, 'aaaabbbb');
  assert.equal(s.harness, 'claude-code');
  assert.equal(s.project, 'kaaroSessions');
  assert.equal(s.tool_calls, 1);
  assert.equal(s.last_event, 'tool_call');
  assert.deepEqual(s.last_tool, { tool: 'Read', key: 'read', where: 'D:/x/a.mjs', why: null, ts: T0 });
  assert.equal(s.first_seen, T0);
  assert.equal(s.last_seen, T0);
});

test('applyPulse tool_call — increments across pulses, updates last_tool', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tool_call', { tool: 'Read', key: 'read', where: 'a.mjs', why: null }), T0);
  applyPulse(state, pulse('tool_call', { tool: 'Bash', key: 'bash_git', where: null, why: 'git status' }), T0 + 5000);

  const s = snapshotActive(state, T0 + 5000).sessions[0];
  assert.equal(s.tool_calls, 2);
  assert.equal(s.last_tool.tool, 'Bash');
  assert.equal(s.last_tool.why, 'git status');
  assert.equal(s.first_seen, T0);
  assert.equal(s.last_seen, T0 + 5000);
});

test('applyPulse tool_error — increments tool_errors', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tool_call', { tool: 'Bash', key: 'bash_run', where: null, why: 'npm test' }), T0);
  applyPulse(state, pulse('tool_error', { tool: 'Bash' }), T0 + 1000);

  const s = snapshotActive(state, T0 + 1000).sessions[0];
  assert.equal(s.tool_errors, 1);
  assert.equal(s.last_event, 'tool_error');
});

// ── tokens + burn rate ────────────────────────────────────────────────────────

test('applyPulse tokens — accumulates totals and tokens_work', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tokens', { input: 100, output: 50, cache_create: 200, cache_read: 1000 }), T0);
  applyPulse(state, pulse('tokens', { input: 10, output: 5, cache_create: 20, cache_read: 100 }), T0 + 1000);

  const s = snapshotActive(state, T0 + 1000).sessions[0];
  assert.deepEqual(s.tokens, { input: 110, output: 55, cache_create: 220, cache_read: 1100 });
  assert.equal(s.tokens_work, 275); // output + cache_create
});

test('burn rate — tokens_work per minute over the burn window', () => {
  const state = createActiveState();
  // 300 work tokens spread within the last 60s window
  applyPulse(state, pulse('tokens', { input: 0, output: 100, cache_create: 0, cache_read: 0 }), T0);
  applyPulse(state, pulse('tokens', { input: 0, output: 200, cache_create: 0, cache_read: 0 }), T0 + 30_000);

  const s = snapshotActive(state, T0 + 30_000).sessions[0];
  assert.equal(s.burn_rate_per_min, 300); // full window credit

  // advance past the window: first pulse falls out
  const s2 = snapshotActive(state, T0 + 70_000).sessions[0];
  assert.equal(s2.burn_rate_per_min, 200);

  // far in the future: nothing recent
  const s3 = snapshotActive(state, T0 + 200_000).sessions[0];
  assert.equal(s3.burn_rate_per_min, 0);
});

test('synthetic tokens count toward burn rate', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tokens', { synthetic: true, input: 0, output: 80, cache_create: 0, cache_read: 0 }), T0);
  const s = snapshotActive(state, T0).sessions[0];
  assert.equal(s.tokens_work, 80);
  assert.equal(s.burn_rate_per_min, 80);
});

// ── words / human turns / compacts ───────────────────────────────────────────

test('applyPulse words — counts and keeps last preview', () => {
  const state = createActiveState();
  applyPulse(state, pulse('words', { preview: 'Analyzing the pipeline now', word_count: 4 }), T0);
  applyPulse(state, pulse('words', { preview: 'Tests pass, moving on', word_count: 4 }), T0 + 1000);

  const s = snapshotActive(state, T0 + 1000).sessions[0];
  assert.equal(s.words, 2);
  assert.equal(s.last_preview, 'Tests pass, moving on');
});

test('applyPulse human_turn / compact — tracked', () => {
  const state = createActiveState();
  applyPulse(state, pulse('human_turn', { text: 'fix the bug' }), T0);
  applyPulse(state, pulse('compact', {}), T0 + 1000);

  const s = snapshotActive(state, T0 + 1000).sessions[0];
  assert.equal(s.human_turns, 1);
  assert.equal(s.last_human_ts, T0);
  assert.equal(s.compacts, 1);
});

// ── status transitions ────────────────────────────────────────────────────────

test('status — active within activeMs, idle after, evicted after evictMs', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tool_call', { tool: 'Read', key: 'read', where: 'a', why: null }), T0);

  const active = snapshotActive(state, T0 + DEFAULT_THRESHOLDS.activeMs - 1);
  assert.equal(active.sessions[0].status, 'active');
  assert.equal(active.totals.active, 1);

  const idle = snapshotActive(state, T0 + DEFAULT_THRESHOLDS.activeMs + 1);
  assert.equal(idle.sessions[0].status, 'idle');
  assert.equal(idle.totals.active, 0);
  assert.equal(idle.totals.idle, 1);

  const gone = snapshotActive(state, T0 + DEFAULT_THRESHOLDS.evictMs + 1);
  assert.equal(gone.sessions.length, 0);
  assert.equal(gone.totals.sessions, 0);
});

test('status thresholds — overridable per call', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tool_call', { tool: 'Read', key: 'read', where: 'a', why: null }), T0);
  const snap = snapshotActive(state, T0 + 5000, { activeMs: 1000 });
  assert.equal(snap.sessions[0].status, 'idle');
});

test('snapshot — seconds_since computed from now', () => {
  const state = createActiveState();
  applyPulse(state, pulse('words', { preview: 'hello there friend', word_count: 3 }), T0);
  const s = snapshotActive(state, T0 + 12_000).sessions[0];
  assert.equal(s.seconds_since, 12);
});

// ── multi-session / multi-harness ────────────────────────────────────────────

test('multiple sessions sorted by last_seen desc; by_harness rollup', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tool_call', { tool: 'Read', key: 'read', where: 'a', why: null }), T0);
  applyPulse(state, pulse('tool_call', {
    session_id: 'ses_4a89582bbffe03xj4Y14Qtss1q', slug: 'ses_4a89',
    harness: 'opencode', project: 'bun-ai-minecraft',
    tool: 'glob', key: 'grep_glob', where: null, why: null,
  }), T0 + 10_000);
  applyPulse(state, pulse('tokens', {
    session_id: 'ses_4a89582bbffe03xj4Y14Qtss1q', slug: 'ses_4a89',
    harness: 'opencode', project: 'bun-ai-minecraft',
    input: 10, output: 30, cache_create: 0, cache_read: 0,
  }), T0 + 11_000);

  const snap = snapshotActive(state, T0 + 11_000);
  assert.equal(snap.sessions.length, 2);
  assert.equal(snap.sessions[0].harness, 'opencode');     // most recent first
  assert.equal(snap.sessions[1].harness, 'claude-code');

  assert.equal(snap.by_harness['claude-code'].sessions, 1);
  assert.equal(snap.by_harness['opencode'].sessions, 1);
  assert.equal(snap.by_harness['opencode'].tool_calls, 1);
  assert.equal(snap.by_harness['opencode'].tokens_work, 30);
  assert.equal(snap.totals.sessions, 2);
});

// ── robustness ────────────────────────────────────────────────────────────────

test('pulses without session_id are ignored', () => {
  const state = createActiveState();
  applyPulse(state, { event: 'tool_call', data: { tool: 'Read' } }, T0);
  applyPulse(state, { event: 'status', data: 'rebuilding' }, T0);
  applyPulse(state, null, T0);
  assert.equal(snapshotActive(state, T0).sessions.length, 0);
});

test('project backfills when a later pulse carries it (opencode part files)', () => {
  const state = createActiveState();
  applyPulse(state, pulse('tool_call', { project: null, tool: 'read', key: 'read', where: 'a', why: null }), T0);
  assert.equal(snapshotActive(state, T0).sessions[0].project, null);
  applyPulse(state, pulse('unknown', { project: 'bun-ai-minecraft', nr_kind: 'session_meta' }), T0 + 1000);
  assert.equal(snapshotActive(state, T0 + 1000).sessions[0].project, 'bun-ai-minecraft');
});

test('unknown pulse events still bump last_seen/last_event', () => {
  const state = createActiveState();
  applyPulse(state, pulse('thinking', { block_type: 'thinking' }), T0);
  const s = snapshotActive(state, T0).sessions[0];
  assert.equal(s.last_event, 'thinking');
  assert.equal(s.tool_calls, 0);
});
