import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionsOutput } from '../lib/analyze-orchestrator.mjs';
import { parseHarnessFlags } from '../lib/scan-harnesses.mjs';
import { validateSessionsData } from '../lib/sessions-schema.mjs';

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

test('parseHarnessFlags', () => {
  assert.deepEqual(parseHarnessFlags(['node', 'analyze.mjs']), ['claude-code']);
  assert.deepEqual(parseHarnessFlags(['node', 'analyze.mjs', '--all-harnesses']),
    ['claude-code', 'pi', 'antigravity']);
  assert.deepEqual(parseHarnessFlags(['node', 'analyze.mjs', '--harness=pi']), ['pi']);
});