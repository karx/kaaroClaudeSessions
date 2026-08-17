/**
 * surface/scan-harnesses.mjs
 *
 * Registry-driven per-harness scan dispatch. Scanners are declared on the
 * registry descriptors (scan.module/scan.export) and dynamically imported —
 * adding a harness requires no edits here.
 */

import { HARNESS_IDS, getHarness, loadScanner } from '../hooks/registry.mjs';

// Pure override seam for tests: SCANNERS[id] (when set) wins over registry
// dispatch. Empty in production.
export const SCANNERS = {};

export function parseHarnessFlags(argv = process.argv) {
  if (argv.includes('--all-harnesses'))
    return [...HARNESS_IDS];
  const arg = argv.find(a => a.startsWith('--harness='));
  if (arg) return [arg.split('=')[1]];
  return ['claude-code'];
}

/**
 * @param {string[]} harnessIds
 * @param {{ rootOverrides?: Record<string, string> }} [opts] — test seam:
 *   pass a root path to the scanner instead of its default.
 * @returns {Promise<object[]>} per-harness scan results (errors isolated)
 */
export async function scanHarnesses(harnessIds, opts = {}) {
  const results = [];
  for (const id of harnessIds) {
    if (!getHarness(id)) {
      console.warn(`[scan] unknown harness: ${id}`);
      continue;
    }
    const scanner = SCANNERS[id] ?? await loadScanner(id);
    if (!scanner) continue;
    let result;
    try {
      const root = opts.rootOverrides?.[id];
      result = root !== undefined ? scanner(root) : scanner();
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
