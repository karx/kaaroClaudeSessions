import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionsOutput } from '../hooks/session-output.mjs';
import { validateSessionsData } from '../hooks/sessions-schema.mjs';

function makeSession(id, harness, projectId, overrides = {}) {
  return {
    session_id: id,
    project_id: projectId,
    project_label: 'ebrain',
    harness,
    source: harness,
    tokens: { input: 10, output: 20, cache_create: 5, cache_read: 0 },
    tool_calls: 3,
    tool_errors: 0,
    tools: {},
    file_ops: {},
    skills: [],
    builtin_commands: [],
    first_timestamp: '2026-05-01T10:00:00.000Z',
    last_timestamp:  '2026-05-01T11:00:00.000Z',
    ...overrides,
  };
}

test('buildSessionsOutput — merges sessions from multiple harnesses', () => {
  const output = buildSessionsOutput([
    {
      harness: 'claude-code',
      source_dir: '/claude',
      sessions: [makeSession('cc-1', 'claude-code', 'D--src-ebrain')],
    },
    {
      harness: 'antigravity',
      source_dir: '/ag',
      sessions: [makeSession('ag-1', 'antigravity', 'D--src-ebrain', {
        tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 },
        tool_calls: 12,
      })],
    },
  ]);

  assert.equal(output.sessions.length, 2);
  assert.deepEqual(output.meta.harnesses, ['claude-code', 'antigravity']);
  assert.equal(output.meta.source_dirs['claude-code'], '/claude');
  assert.equal(output.meta.source_dirs.antigravity, '/ag');
  assert.equal(output.projects.length, 1);
  assert.equal(output.projects[0].session_count, 2);
  assert.equal(output.projects[0].label, 'ebrain');

  const v = validateSessionsData(output);
  assert.equal(v.ok, true, v.errors?.join('; '));
});

test('buildSessionsOutput — project summaries carry enriched tokens_work/tokens_total', () => {
  const output = buildSessionsOutput([{
    harness: 'claude-code',
    source_dir: '/claude',
    sessions: [
      makeSession('s1', 'claude-code', 'p1'), // output 20 + cache_create 5
      makeSession('s2', 'claude-code', 'p1', {
        tokens: { input: 10, output: 100, cache_create: 15, cache_read: 40 },
      }),
    ],
  }]);
  const p = output.projects[0];
  assert.equal(p.tokens_work, 140);   // (20+5) + (100+15)
  assert.equal(p.tokens_total, 200);  // 35 + 165
});

test('buildSessionsOutput — unifies Pi wrapped id into canonical project (G2)', () => {
  const output = buildSessionsOutput([
    {
      harness: 'claude-code',
      source_dir: '/claude',
      sessions: [makeSession('cc-1', 'claude-code', 'D--src-ebrain')],
    },
    {
      harness: 'pi',
      source_dir: '/pi',
      sessions: [makeSession('pi-1', 'pi', '--D--src-ebrain--')],
    },
  ]);

  assert.equal(output.projects.length, 1);
  assert.equal(output.projects[0].id, 'D--src-ebrain');
  assert.equal(output.projects[0].session_count, 2);
  assert.deepEqual(output.projects[0].raw_ids, ['--D--src-ebrain--', 'D--src-ebrain']);
  assert.deepEqual(output.projects[0].harnesses, ['claude-code', 'pi']);

  // decision: session records keep their native, harness-spelled project_id
  assert.equal(output.sessions.find(s => s.session_id === 'pi-1').project_id, '--D--src-ebrain--');

  const v = validateSessionsData(output);
  assert.equal(v.ok, true, v.errors?.join('; '));
});

test('buildSessionsOutput — sorts sessions by first_timestamp', () => {
  const output = buildSessionsOutput([{
    harness: 'claude-code',
    source_dir: '/claude',
    sessions: [
      makeSession('late', 'claude-code', 'p1', { first_timestamp: '2026-05-10T00:00:00.000Z' }),
      makeSession('early', 'claude-code', 'p1', { first_timestamp: '2026-05-01T00:00:00.000Z' }),
    ],
  }]);
  assert.equal(output.sessions[0].session_id, 'early');
  assert.equal(output.sessions[1].session_id, 'late');
});

test('signals pipeline — buildSignalsData consumes buildSessionsOutput sessions as-is', async () => {
  const { buildSignalsData } = await import('../hooks/signal-evaluator.mjs');
  const output = buildSessionsOutput([{
    harness: 'claude-code',
    source_dir: '/claude',
    sessions: [makeSession('s1', 'claude-code', 'p1', { tool_errors: 9 })],
  }]);
  const policy = { rules: [{ id: 'errors', match: { 'tool_errors.gt': 5 }, signal: 'ALERT', reason: 'too many errors' }] };
  const data = buildSignalsData(output.sessions, policy, { now: new Date('2026-07-19T12:00:00.000Z') });
  assert.equal(data.total_signals, 1);
  assert.equal(data.signals[0].session_id, 's1');
  assert.equal(data.signals[0].signal, 'ALERT');
});
