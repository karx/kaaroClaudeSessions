/**
 * surface/session-resolver.mjs
 *
 * Resolve session log files across harness roots: a generic loop over the
 * registry's locateSession descriptors, with an in-memory cache. The
 * per-harness walkers live in hooks/session-locators.mjs.
 */

import { HARNESS_REGISTRY, getHarness } from '../hooks/registry.mjs';

// Back-compat named exports (tests + older callers).
export {
  locateClaudeCodeSession as resolveClaudeCodeSession,
  locatePiSession         as resolvePiSession,
  locateAntigravitySession as resolveAntigravitySession,
  locateGrokSession        as resolveGrokSession,
} from '../hooks/session-locators.mjs';

// Simple in-memory cache to avoid repeated unbounded readdirSync/statSync
// on every /api/trace request.
// Invalidation: call invalidateSessionResolveCache() from serve watch handler
// on relevant .jsonl / log changes (or clear all for simplicity/correctness).
const resolveCache = new Map(); // sessionId -> resolved entry

export function invalidateSessionResolveCache(sessionId = null) {
  if (sessionId) resolveCache.delete(sessionId);
  else resolveCache.clear();
}

/**
 * @param {string} sessionId
 * @param {{ harness?: string, roots?: Record<string, string> }} [opts]
 * @returns {{ filePath: string, projectId: string|null, sessionId: string, harness: string }|null}
 */
export function resolveSessionFile(sessionId, opts = {}) {
  if (!sessionId) return null;

  // Fast path from cache (avoids sync FS walk per request).
  const cached = resolveCache.get(sessionId);
  if (cached) return cached;

  const candidates = opts.harness
    ? [getHarness(opts.harness)].filter(Boolean)
    : HARNESS_REGISTRY;

  for (const h of candidates) {
    if (typeof h.locateSession !== 'function') continue;
    const root  = opts.roots?.[h.id];
    const found = root !== undefined
      ? h.locateSession(sessionId, root)
      : h.locateSession(sessionId);
    if (found) {
      const entry = { ...found, harness: h.id };
      resolveCache.set(sessionId, entry);
      return entry;
    }
  }
  return null;
}
