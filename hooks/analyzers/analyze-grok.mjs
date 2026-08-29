#!/usr/bin/env node
/**
 * analyze-grok.mjs
 *
 * Parser adapter for Grok Build coding-agent sessions.
 * Reads ~/.grok/sessions/<url-encoded-cwd>/<session-uuid>/updates.jsonl
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enrichSession } from '../enrich-session.mjs';
import { buildSessionsOutput } from '../../surface/analyze-orchestrator.mjs';
import { recordsToNormalized } from '../adapters/grok.mjs';
import { reduceSession } from '../session-reducer.mjs';
import {
  deriveGrokProjectId,
  deriveGrokLabel,
  decodeGrokCwd,
  grokRecordTs,
} from '../helpers/grok-helpers.mjs';
import { GROK_SESSIONS_ROOT } from '../harness-paths.mjs';
import { HARNESS_CAPABILITIES } from '../harness-capabilities.mjs';

export { GROK_SESSIONS_ROOT };

const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');
const SESSION_DIR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

import { parseJsonlFile } from '../jsonl-io.mjs';
import { walkSessions, dirNames } from '../scan-walk.mjs';

/**
 * Read a Grok session directory (multi-file).
 * @param {string} sessionDir
 * @returns {{ records: object[], summary: object|null, signals: object|null, sizeBytes: number }}
 */
export function readGrokSession(sessionDir) {
  const updatesPath = path.join(sessionDir, 'updates.jsonl');
  const { records, sizeBytes } = parseJsonlFile(updatesPath);

  let summary = null;
  let signals = null;
  try {
    summary = JSON.parse(fs.readFileSync(path.join(sessionDir, 'summary.json'), 'utf8'));
  } catch { /* optional */ }
  try {
    signals = JSON.parse(fs.readFileSync(path.join(sessionDir, 'signals.json'), 'utf8'));
  } catch { /* optional */ }

  return { records, summary, signals, sizeBytes };
}

function trackAllTimestamps(session, records) {
  for (const rec of records) {
    const ts = grokRecordTs(rec);
    if (!ts) continue;
    if (!session.first_timestamp || ts < session.first_timestamp) session.first_timestamp = ts;
    if (!session.last_timestamp  || ts > session.last_timestamp)  session.last_timestamp  = ts;
  }
}

function applyGrokMeta(session, encodedCwd, summary, signals, records) {
  trackAllTimestamps(session, records);

  const cwd = summary?.info?.cwd || decodeGrokCwd(encodedCwd);
  session.cwd           = cwd;
  session.project_id    = deriveGrokProjectId(encodedCwd);
  session.project_label = deriveGrokLabel(encodedCwd);

  if (summary) {
    session.model    = summary.current_model_id || session.model;
    session.ai_title = summary.generated_title || summary.session_summary || session.ai_title;
    session.git_branch = summary.head_branch || session.git_branch;
    if (summary.head_branch) session.branches = [summary.head_branch];
    if (summary.created_at && !session.first_timestamp) session.first_timestamp = summary.created_at;
    if (summary.updated_at) session.last_timestamp = summary.updated_at;
  }

  if (signals) {
    if (signals.primaryModelId && !session.model) session.model = signals.primaryModelId;
    if (typeof signals.contextTokensUsed === 'number') {
      session.tokens.input = signals.contextTokensUsed;
    }
    if (!session.context_resets && typeof signals.compactionCount === 'number') {
      session.context_resets = signals.compactionCount;
    }
    if (typeof signals.sessionDurationSeconds === 'number') {
      session.duration_ms = signals.sessionDurationSeconds * 1000;
    }
  }

  if (!session.duration_ms && session.first_timestamp && session.last_timestamp) {
    session.duration_ms =
      new Date(session.last_timestamp).getTime() -
      new Date(session.first_timestamp).getTime();
  }
}

export function parseGrokRecords(records, sessionId, encodedCwd, summary = null, signals = null) {
  const session = reduceSession(recordsToNormalized(records), {
    session_id:      sessionId,
    project_id:      deriveGrokProjectId(encodedCwd),
    project_label:   deriveGrokLabel(encodedCwd),
    harness:         'grok',
    capabilities:    HARNESS_CAPABILITIES.grok,
  });
  applyGrokMeta(session, encodedCwd, summary, signals, records);
  return session;
}

export function analyzeGrokSession(encodedCwd, sessionId, sessionsRoot = GROK_SESSIONS_ROOT) {
  const sessionDir = path.join(sessionsRoot, encodedCwd, sessionId);
  const updatesPath = path.join(sessionDir, 'updates.jsonl');
  if (!fs.existsSync(updatesPath)) return null;

  const { records, summary, signals, sizeBytes } = readGrokSession(sessionDir);
  if (!records.length) return null;

  const session = parseGrokRecords(records, sessionId, encodedCwd, summary, signals);
  session.file_size_bytes = sizeBytes;
  session.source = 'grok';
  enrichSession(session);
  return session;
}

export function scanGrokSessions(sessionsRoot = GROK_SESSIONS_ROOT) {
  return walkSessions(sessionsRoot, 'grok', function* (entries) {
    for (const proj of dirNames(entries)) {
      const projDir = path.join(sessionsRoot, proj);
      let sessionDirs;
      try { sessionDirs = fs.readdirSync(projDir, { withFileTypes: true }); } catch { continue; }

      for (const name of dirNames(sessionDirs)) {
        if (!SESSION_DIR_RE.test(name)) continue;
        yield { id: `${proj}/${name}`, analyze: () => analyzeGrokSession(proj, name, sessionsRoot) };
      }
    }
  });
}

function main() {
  const result = scanGrokSessions();
  if (!result?.sessions?.length) {
    console.error(`Grok sessions directory not found or empty: ${GROK_SESSIONS_ROOT}`);
    process.exit(1);
  }

  console.log('Scanning', GROK_SESSIONS_ROOT, '...');
  const output = buildSessionsOutput([result]);
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nSessions: ${output.sessions.length}  Projects: ${output.projects.length}`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();