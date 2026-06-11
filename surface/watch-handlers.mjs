/**
 * lib/watch-handlers.mjs
 *
 * Pure helpers for registry-driven file watch events.
 */

import path from 'path';
import { getHarness } from '../hooks/registry.mjs';

/**
 * @param {string} harnessId
 * @param {string} filename — relative path from fs.watch
 * @param {string} rootDir — harness root directory
 * @returns {{ ctx: object, absPath: string, rebuildArg: string|null, relPath: string }|null}
 */
export function processWatchFilename(harnessId, filename, rootDir) {
  if (!filename) return null;
  const relPath = filename.replace(/\\/g, '/');
  const harness = getHarness(harnessId);
  if (!harness?.watch?.matchLogFile(relPath)) return null;

  const ctx = harness.watch.ctxFromPath(relPath);
  if (!ctx) return null;

  return {
    ctx,
    absPath:     path.join(rootDir, filename),
    rebuildArg:  harness.watch.rebuildArg(relPath),
    relPath,
  };
}