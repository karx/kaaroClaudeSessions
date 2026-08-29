#!/usr/bin/env node
/**
 * analyze-antigravity.mjs
 *
 * Parser adapter for Google Antigravity coding-agent session logs.
 * Reads ~/.gemini/antigravity/brain/<conversationId>/.system_generated/logs/
 * and extracts per-session statistics into the normalized sessions-data.json
 * format consumed by the graph builder.
 *
 * Session log format:
 *   transcript.jsonl  — full record log (present only for active sessions)
 *   overview.txt      — compact record log (present for all sessions)
 *
 * Part of kaaro-sessions — a kaaroViewer companion tool.
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';
import { enrichSession } from '../enrich-session.mjs';
import { buildSessionsOutput } from '../session-output.mjs';
import { recordsToNormalized } from '../adapters/antigravity.mjs';
import { reduceSession } from '../session-reducer.mjs';
import {
  parseArgValue,
  deriveAntigravityProjectId,
  deriveAntigravityLabel,
  detectWorkspace,
  extractModelChange,
  extractUserMessage,
} from '../helpers/antigravity-helpers.mjs';

export {
  parseArgValue,
  deriveAntigravityProjectId,
  deriveAntigravityLabel,
  detectWorkspace,
  extractModelChange,
  extractUserMessage,
};

// ── Config ────────────────────────────────────────────────────────────────────

import { ANTIGRAVITY_BRAIN_ROOT } from '../harness-paths.mjs';
export { ANTIGRAVITY_BRAIN_ROOT };
const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');

// ── JSONL parser ──────────────────────────────────────────────────────────────

import { parseJsonlFile } from '../jsonl-io.mjs';
import { walkSessions, dirNames } from '../scan-walk.mjs';

// ── Per-session analysis ──────────────────────────────────────────────────────

/**
 * Parse Antigravity transcript records for a single session.
 * Project fields (project_id, project_label, cwd) are filled in after scanning.
 */
function applyAntigravityWorkspace(session, records) {
  for (const rec of records) {
    const ts = rec.created_at;
    if (!ts) continue;
    if (!session.first_timestamp || ts < session.first_timestamp) session.first_timestamp = ts;
    if (!session.last_timestamp  || ts > session.last_timestamp)  session.last_timestamp  = ts;
  }

  const cwd = detectWorkspace(records);
  session.cwd           = cwd;
  session.project_id    = deriveAntigravityProjectId(cwd);
  session.project_label = deriveAntigravityLabel(cwd);

  if (session.first_timestamp && session.last_timestamp) {
    session.duration_ms =
      new Date(session.last_timestamp).getTime() -
      new Date(session.first_timestamp).getTime();
  }
}

export function parseAntigravityRecords(records, sessionId) {
  const session = reduceSession(recordsToNormalized(records), {
    session_id:      sessionId,
    project_id:      null,
    project_label:   null,
    harness:         'antigravity',
    capabilities:    { size_proxy: 'tool_calls' },
  });
  applyAntigravityWorkspace(session, records);
  return session;
}

// ── Session scan ──────────────────────────────────────────────────────────────

export function analyzeAntigravitySession(conversationId, brainDir) {
  const sessionDir = path.join(brainDir, conversationId, '.system_generated', 'logs');

  // Prefer transcript.jsonl (richer), fall back to overview.txt (compact)
  const transcriptPath = path.join(sessionDir, 'transcript.jsonl');
  const overviewPath   = path.join(sessionDir, 'overview.txt');

  let logPath;
  if (fs.existsSync(transcriptPath)) {
    logPath = transcriptPath;
  } else if (fs.existsSync(overviewPath)) {
    logPath = overviewPath;
  } else {
    return null; // No log file available for this session
  }

  const { records, sizeBytes } = parseJsonlFile(logPath);
  if (records.length === 0) return null;

  const session = parseAntigravityRecords(records, conversationId);
  session.file_size_bytes = sizeBytes;
  session.source = 'antigravity';
  enrichSession(session);
  return session;
}

/**
 * Scan all Antigravity conversations. Returns null if brain root is absent.
 */
export function scanAntigravitySessions(brainDir = ANTIGRAVITY_BRAIN_ROOT) {
  return walkSessions(brainDir, 'antigravity', function* (entries) {
    for (const conversationId of dirNames(entries, { skipHidden: true })) {
      yield { id: conversationId, analyze: () => analyzeAntigravitySession(conversationId, brainDir) };
    }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const result = scanAntigravitySessions();
  if (!result) {
    console.error(`Antigravity brain directory not found: ${ANTIGRAVITY_BRAIN_ROOT}`);
    console.error('Is the Antigravity coding agent installed?');
    process.exit(1);
  }

  console.log('Scanning', ANTIGRAVITY_BRAIN_ROOT, '...');
  for (const session of result.sessions) {
    console.log(`  ${session.session_id.slice(0, 8)}: ${session.user_turns}u/${session.assistant_turns}a turns  [${session.project_label}]`);
  }

  const output = buildSessionsOutput([result]);
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const t = output.rollup.tokens;
  const total = t.input + t.cache_create + t.cache_read + t.output;
  console.log(`\nSessions: ${output.sessions.length}  Projects: ${output.projects.length}  Tool calls: ${output.sessions.reduce((s, a) => s + (a.tool_calls || 0), 0)}  Tokens: ${total.toLocaleString()} (not tracked by Antigravity)`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
