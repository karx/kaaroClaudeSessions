import { test } from 'node:test';
import assert from 'node:assert/strict';

test('parseHarnessFlags', async () => {
  const { parseHarnessFlags } = await import('../surface/scan-harnesses.mjs');
  assert.deepEqual(parseHarnessFlags(['node', 'analyze.mjs']), ['claude-code']);
  assert.deepEqual(parseHarnessFlags(['node', 'analyze.mjs', '--all-harnesses']),
    ['claude-code', 'pi', 'antigravity', 'grok', 'opencode', 'copilot', 'command-code']);
  assert.deepEqual(parseHarnessFlags(['node', 'analyze.mjs', '--harness=pi']), ['pi']);
});

// ── scanHarnesses error isolation (CODE-REVIEW-FINDINGS #8) ────────────────────
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
