/**
 * lib/session-resolver.mjs
 *
 * Resolve session log files across harness roots.
 */

import fs   from 'fs';
import path from 'path';
import {
  CLAUDE_PROJECTS_ROOT, PI_SESSIONS_ROOT, ANTIGRAVITY_BRAIN_ROOT, GROK_SESSIONS_ROOT,
} from './harness-paths.mjs';
import { getHarness } from './harness-registry.mjs';

// Simple in-memory cache to avoid repeated unbounded readdirSync/statSync
// on every /api/trace request (finding #7 / TODO).
// Invalidation: call invalidateSessionResolveCache() from serve watch handler
// on relevant .jsonl / log changes (or clear all for simplicity/correctness).
const resolveCache = new Map(); // sessionId -> resolved entry

export function invalidateSessionResolveCache(sessionId = null) {
  if (sessionId) resolveCache.delete(sessionId);
  else resolveCache.clear();
}

function sessionIdFromPiFilename(filename) {
  const base = filename.replace(/\.jsonl$/, '');
  return base.includes('_') ? base.slice(base.indexOf('_') + 1) : base;
}

/**
 * @param {string} sessionId
 * @param {string} [root]
 * @returns {{ filePath: string, projectId: string, sessionId: string }|null}
 */
export function resolveClaudeCodeSession(sessionId, root = CLAUDE_PROJECTS_ROOT) {
  if (!sessionId || !fs.existsSync(root)) return null;

  for (const proj of fs.readdirSync(root)) {
    const projPath = path.join(root, proj);
    try {
      if (!fs.statSync(projPath).isDirectory()) continue;
    } catch { continue; }

    const candidate = path.join(projPath, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
      return { filePath: candidate, projectId: proj, sessionId };
    }

    const subCandidate = path.join(projPath, 'subagents', `${sessionId}.jsonl`);
    if (fs.existsSync(subCandidate)) {
      return { filePath: subCandidate, projectId: proj, sessionId };
    }
  }
  return null;
}

/**
 * @param {string} sessionId
 * @param {string} [root]
 * @returns {{ filePath: string, projectId: string, sessionId: string }|null}
 */
export function resolvePiSession(sessionId, root = PI_SESSIONS_ROOT) {
  if (!sessionId || !fs.existsSync(root)) return null;

  for (const proj of fs.readdirSync(root)) {
    const projPath = path.join(root, proj);
    try {
      if (!fs.statSync(projPath).isDirectory()) continue;
    } catch { continue; }

    for (const file of fs.readdirSync(projPath)) {
      if (!file.endsWith('.jsonl')) continue;
      if (sessionIdFromPiFilename(file) === sessionId) {
        return { filePath: path.join(projPath, file), projectId: proj, sessionId };
      }
    }
  }
  return null;
}

/**
 * @param {string} sessionId — Antigravity conversation id
 * @param {string} [root]
 * @returns {{ filePath: string, projectId: null, sessionId: string }|null}
 */
export function resolveAntigravitySession(sessionId, root = ANTIGRAVITY_BRAIN_ROOT) {
  if (!sessionId || !fs.existsSync(root)) return null;

  const sessionDir = path.join(root, sessionId, '.system_generated', 'logs');
  const transcript = path.join(sessionDir, 'transcript.jsonl');
  if (fs.existsSync(transcript)) {
    return { filePath: transcript, projectId: null, sessionId };
  }

  const overview = path.join(sessionDir, 'overview.txt');
  if (fs.existsSync(overview)) {
    return { filePath: overview, projectId: null, sessionId };
  }

  return null;
}

/**
 * @param {string} sessionId
 * @param {string} [root]
 * @returns {{ filePath: string, projectId: string, sessionId: string }|null}
 */
export function resolveGrokSession(sessionId, root = GROK_SESSIONS_ROOT) {
  if (!sessionId || !fs.existsSync(root)) return null;

  for (const encodedCwd of fs.readdirSync(root)) {
    const updates = path.join(root, encodedCwd, sessionId, 'updates.jsonl');
    if (fs.existsSync(updates)) {
      return { filePath: updates, projectId: encodedCwd, sessionId };
    }
  }
  return null;
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

  const filter = opts.harness;
  const roots  = opts.roots ?? {};
  const order  = filter ? [filter] : ['claude-code', 'pi', 'antigravity', 'grok'];

  const RESOLVERS = {
    'claude-code':  () => resolveClaudeCodeSession(sessionId, roots['claude-code']),
    'pi':           () => resolvePiSession(sessionId, roots['pi']),
    'antigravity':  () => resolveAntigravitySession(sessionId, roots['antigravity']),
    'grok':         () => resolveGrokSession(sessionId, roots['grok']),
  };

  for (const id of order) {
    if (!getHarness(id)) continue;
    const found = RESOLVERS[id]?.();
    if (found) {
      const entry = { ...found, harness: id };
      resolveCache.set(sessionId, entry);
      return entry;
    }
  }
  return null;
}
