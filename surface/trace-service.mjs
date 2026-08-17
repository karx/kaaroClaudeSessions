/**
 * surface/trace-service.mjs — /api/trace production path.
 *
 * registry readSessionRecords (harness-specific transcript reading) →
 * registry adapter → reconstructTraceFromNRs, with an mtime cache per file.
 * Fully harness-agnostic: trace support for a new harness is just its
 * descriptor's readSessionRecords + capabilities.trace = true.
 */
import fs from 'fs';

import { getHarness } from '../hooks/registry.mjs';
import { reconstructTraceFromNRs } from '../hooks/trace-tree.mjs';

export function createTraceService() {
  const cache = new Map(); // filePath → { mtime, tree }

  /**
   * @param {string} filePath — resolved session log file
   * @param {string|null} projectId
   * @param {string} sessionId
   * @param {string} harnessId
   * @returns {object|null} tree ({ session_id, project_id, ai_title, segments }) or null
   */
  function buildTrace(filePath, projectId, sessionId, harnessId) {
    try {
      const harness = getHarness(harnessId);
      if (!harness?.readSessionRecords) return null;

      const mtime = fs.statSync(filePath).mtimeMs;
      const cached = cache.get(filePath);
      if (cached && cached.mtime === mtime) return cached.tree;

      const { records, traceOpts = {} } = harness.readSessionRecords(filePath);
      const nrs = harness.adapter(records);

      const tree = {
        session_id: sessionId,
        project_id: projectId,
        ...reconstructTraceFromNRs(nrs, traceOpts),
      };
      cache.set(filePath, { mtime, tree });
      return tree;
    } catch {
      return null;
    }
  }

  return { buildTrace };
}
