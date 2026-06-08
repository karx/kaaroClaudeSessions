/**
 * lib/scan-harnesses.mjs
 *
 * Runs per-harness directory scans. Kept separate from analyze-orchestrator
 * to avoid circular imports with analyze*.mjs entry points.
 */

import { scanClaudeCodeSessions } from '../analyze.mjs';
import { scanPiSessions }         from '../analyze-pi.mjs';
import { scanAntigravitySessions } from '../analyze-antigravity.mjs';
import { scanGrokSessions }         from '../analyze-grok.mjs';
import { HARNESS_IDS, getHarness } from './harness-registry.mjs';

// SCANNERS is exported primarily as a test seam to allow injecting
// throwing scanners for error-isolation tests (see scan isolation in Phase 3).
export const SCANNERS = {
  'claude-code':  () => scanClaudeCodeSessions(),
  'pi':           () => scanPiSessions(),
  'antigravity':  () => scanAntigravitySessions(),
  'grok':         () => scanGrokSessions(),
};

export function parseHarnessFlags(argv = process.argv) {
  if (argv.includes('--all-harnesses'))
    return [...HARNESS_IDS];
  const arg = argv.find(a => a.startsWith('--harness='));
  if (arg) return [arg.split('=')[1]];
  return ['claude-code'];
}

export function scanHarnesses(harnessIds) {
  const results = [];
  for (const id of harnessIds) {
    if (!getHarness(id)) {
      console.warn(`[scan] unknown harness: ${id}`);
      continue;
    }
    const scanner = SCANNERS[id];
    if (!scanner) continue;
    let result;
    try {
      result = scanner();
    } catch (err) {
      console.warn(`[${id}] scanner error — skipped: ${err.message}`);
      continue; // isolate: do not abort other harnesses (finding #8)
    }
    if (result?.sessions?.length) {
      console.log(`[${id}] ${result.sessions.length} session(s)`);
      results.push(result);
    } else if (result === null) {
      console.warn(`[${id}] root not found — skipped`);
    }
  }
  return results;
}