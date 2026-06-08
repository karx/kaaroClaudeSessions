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
    ['claude-code', 'pi', 'antigravity', 'grok']);
  assert.deepEqual(parseHarnessFlags(['node', 'analyze.mjs', '--harness=pi']), ['pi']);
});

// ── scanHarnesses error isolation (CODE-REVIEW-FINDINGS #8) ────────────────────
// One harness scanner throwing (e.g. FS error mid-scan on Windows for Grok)
// must not abort the entire rebuild. Other harnesses' data must still be returned.
test('scanHarnesses — isolates per-harness scanner errors (continues on failure)', async (t) => {
  // Dynamic import so we can mutate the test seam SCANNERS for this test only.
  const scanMod = await import('../lib/scan-harnesses.mjs');
  const origGrok = scanMod.SCANNERS.grok;

  // Force a throw for 'grok' (simulates EPERM or corrupt data in one harness).
  scanMod.SCANNERS.grok = () => { throw new Error('simulated grok scanner failure'); };

  try {
    // Call with multiple; the successful ones (at least the default behavior for
    // claude-code which may return [] or null depending on FS, but the point is
    // no throw escapes and we get an array result).
    const results = scanMod.scanHarnesses(['claude-code', 'grok']);

    // Must not have thrown; must return an array (possibly empty or partial).
    assert.ok(Array.isArray(results), 'scanHarnesses must return an array even if one scanner throws');
    // We don't assert on length because real FS may vary, but the isolation contract is the key.
  } finally {
    // Restore for other tests / cleanliness.
    scanMod.SCANNERS.grok = origGrok;
  }
});
