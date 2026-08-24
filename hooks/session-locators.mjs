/**
 * hooks/session-locators.mjs
 *
 * Per-harness "find the log file for this session id" walkers, referenced by
 * the registry descriptors (locateSession). surface/session-resolver.mjs runs
 * the generic registry loop + cache on top of these.
 */

import fs   from 'fs';
import path from 'path';
import {
  CLAUDE_PROJECTS_ROOT, PI_SESSIONS_ROOT, ANTIGRAVITY_BRAIN_ROOT, GROK_SESSIONS_ROOT,
  OPENCODE_STORAGE_ROOT, COPILOT_WORKSPACE_STORAGE_ROOT, COMMANDCODE_PROJECTS_ROOT,
} from './harness-paths.mjs';

function sessionIdFromPiFilename(filename) {
  const base = filename.replace(/\.jsonl$/, '');
  return base.includes('_') ? base.slice(base.indexOf('_') + 1) : base;
}

/**
 * @param {string} sessionId
 * @param {string} [root]
 * @returns {{ filePath: string, projectId: string, sessionId: string }|null}
 */
export function locateClaudeCodeSession(sessionId, root = CLAUDE_PROJECTS_ROOT) {
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
export function locatePiSession(sessionId, root = PI_SESSIONS_ROOT) {
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
export function locateAntigravitySession(sessionId, root = ANTIGRAVITY_BRAIN_ROOT) {
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
export function locateGrokSession(sessionId, root = GROK_SESSIONS_ROOT) {
  if (!sessionId || !fs.existsSync(root)) return null;

  for (const encodedCwd of fs.readdirSync(root)) {
    const updates = path.join(root, encodedCwd, sessionId, 'updates.jsonl');
    if (fs.existsSync(updates)) {
      return { filePath: updates, projectId: encodedCwd, sessionId };
    }
  }

  // 8-char slug prefix (DAW /api/audio, sim-audio.mjs)
  if (sessionId.length < 8) return null;
  const needle = sessionId.toLowerCase();
  for (const encodedCwd of fs.readdirSync(root)) {
    const projDir = path.join(root, encodedCwd);
    let names;
    try { names = fs.readdirSync(projDir); } catch { continue; }
    for (const sid of names) {
      if (!sid.toLowerCase().startsWith(needle)) continue;
      const updates = path.join(projDir, sid, 'updates.jsonl');
      if (fs.existsSync(updates)) {
        return { filePath: updates, projectId: encodedCwd, sessionId: sid };
      }
    }
  }
  return null;
}

/**
 * @param {string} sessionId — opencode info id (ses_…)
 * @param {string} [root] — opencode storage root
 * @returns {{ filePath: string, projectId: null, sessionId: string }|null}
 */
export function locateOpencodeSession(sessionId, root = OPENCODE_STORAGE_ROOT) {
  if (!sessionId) return null;
  const sessionRoot = path.join(root, 'session');
  if (!fs.existsSync(sessionRoot)) return null;

  for (const bucket of fs.readdirSync(sessionRoot)) {
    const candidate = path.join(sessionRoot, bucket, `${sessionId}.json`);
    if (fs.existsSync(candidate)) {
      return { filePath: candidate, projectId: null, sessionId };
    }
  }
  return null;
}

/**
 * @param {string} sessionId — copilot chat session id
 * @param {string} [root] — VS Code workspaceStorage root
 * @returns {{ filePath: string, projectId: null, sessionId: string }|null}
 */
export function locateCopilotSession(sessionId, root = COPILOT_WORKSPACE_STORAGE_ROOT) {
  if (!sessionId || !fs.existsSync(root)) return null;

  for (const ws of fs.readdirSync(root)) {
    const chatDir = path.join(root, ws, 'chatSessions');
    for (const ext of ['jsonl', 'json']) {
      const candidate = path.join(chatDir, `${sessionId}.${ext}`);
      if (fs.existsSync(candidate)) {
        return { filePath: candidate, projectId: null, sessionId };
      }
    }
  }
  return null;
}

/**
 * @param {string} sessionId
 * @param {string} [root]
 * @returns {{ filePath: string, projectId: string, sessionId: string }|null}
 */
export function locateCommandCodeSession(sessionId, root = COMMANDCODE_PROJECTS_ROOT) {
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
  }
  return null;
}
