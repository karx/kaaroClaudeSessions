import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionsOutput } from '../surface/analyze-orchestrator.mjs';
import { parseHarnessFlags } from '../surface/scan-harnesses.mjs';
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
    ['claude-code', 'pi', 'antigravity', 'grok', 'opencode', 'copilot', 'command-code']);
  assert.deepEqual(parseHarnessFlags(['node', 'analyze.mjs', '--harness=pi']), ['pi']);
});

// â”€â”€ scanHarnesses error isolation (CODE-REVIEW-FINDINGS #8) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// One harness scanner throwing (e.g. FS error mid-scan on Windows for Grok)
// must not abort the entire rebuild. Other harnesses' data must still be returned.
test('scanHarnesses — isolates per-harness scanner errors (continues on failure)', async (t) => {
  // SCANNERS is the override seam on top of registry dispatch — stub both
  // harnesses so the test never touches the real filesystem.
  const scanMod = await import('../surface/scan-harnesses.mjs');
  const origGrok = scanMod.SCANNERS.grok;
  const origCc   = scanMod.SCANNERS['claude-code'];

  scanMod.SCANNERS.grok = () => { throw new Error('simulated grok scanner failure'); };
  scanMod.SCANNERS['claude-code'] = () =>
    ({ harness: 'claude-code', source_dir: '/tmp', sessions: [{ session_id: 's1' }] });

  try {
    const results = await scanMod.scanHarnesses(['claude-code', 'grok']);
    assert.ok(Array.isArray(results), 'scanHarnesses must return an array even if one scanner throws');
    assert.equal(results.length, 1, 'the healthy harness still returns its sessions');
    assert.equal(results[0].harness, 'claude-code');
  } finally {
    scanMod.SCANNERS.grok = origGrok;
    scanMod.SCANNERS['claude-code'] = origCc;
  }
});

test('scanHarnesses — dispatches through the registry when no override is set', async () => {
  const scanMod = await import('../surface/scan-harnesses.mjs');
  // No SCANNERS override for 'pi': dispatch must find the scanner via the
  // registry scan descriptor and call it against a nonexistent root → null →
  // "root not found" skip path, returning an empty array without throwing.
  const results = await scanMod.scanHarnesses(['pi'], { rootOverrides: { pi: 'Z:/definitely/not/here' } });
  assert.deepEqual(results, []);
});
