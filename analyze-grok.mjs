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
import { enrichSession } from './lib/enrich-session.mjs';
import { buildSessionsOutput } from './lib/analyze-orchestrator.mjs';
import { recordsToNormalized } from './adapters/grok.mjs';
import { reduceSession } from './lib/session-reducer.mjs';
import {
  deriveGrokProjectId,
  deriveGrokLabel,
  decodeGrokCwd,
  grokRecordTs,
} from './lib/grok-helpers.mjs';
import { GROK_SESSIONS_ROOT } from './lib/harness-paths.mjs';

export { GROK_SESSIONS_ROOT };

const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');
const SESSION_DIR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

function parseJsonlFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return { records, sizeBytes: Buffer.byteLength(raw, 'utf8') };
}

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
    capabilities:    { size_proxy: 'tool_calls' },
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
  let projectEntries;
  try {
    projectEntries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  const sessions = [];
  for (const proj of projectEntries.filter(d => d.isDirectory()).map(d => d.name).sort()) {
    const projDir = path.join(sessionsRoot, proj);
    let sessionDirs;
    try { sessionDirs = fs.readdirSync(projDir, { withFileTypes: true }); } catch { continue; }

    for (const ent of sessionDirs.filter(d => d.isDirectory())) {
      if (!SESSION_DIR_RE.test(ent.name)) continue;
      try {
        const session = analyzeGrokSession(proj, ent.name, sessionsRoot);
        if (session) sessions.push(session);
      } catch (err) {
        console.error(`  !! [grok] ${proj}/${ent.name}: ${err.message}`);
      }
    }
  }

  return { harness: 'grok', source_dir: sessionsRoot, sessions };
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