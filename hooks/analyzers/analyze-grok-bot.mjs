#!/usr/bin/env node
/**
 * analyze-grok-bot.mjs
 *
 * Parser for Cursor/SpaceXAI Grok Bot desktop-assistant transcripts.
 * Reads <agent-data>/agent-transcripts/<uuid>/<uuid>.jsonl plus a sibling
 * agents/<uuid>/profile.json (name → ai_title).
 *
 * Default root is /home/box/agent-data; override with GROK_BOT_AGENT_DATA
 * so Windows kaaroSessions can point at a mounted or copied tree.
 *
 * sand-subagent-* transcripts are first-class sessions in the same grok-bot
 * project bucket (soft-linked on the Windows mirror under .local/).
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseJsonlFile } from '../jsonl-io.mjs';
import { buildSessionsOutput } from '../../surface/analyze-orchestrator.mjs';
import { recordsToNormalized, grokBotSlug } from '../adapters/grok-bot.mjs';
import { reduceSession } from '../session-reducer.mjs';
import { enrichSession } from '../enrich-session.mjs';
import { walkSessions, dirNames } from '../scan-walk.mjs';
import { GROK_BOT_AGENT_DATA } from '../harness-paths.mjs';

const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');
const PROJECT_ID = 'grok-bot';
const PROJECT_LABEL = 'Grok Bot';

export { GROK_BOT_AGENT_DATA };

/** Resolve the agent-data root, honoring GROK_BOT_AGENT_DATA at call time. */
export function grokBotRoot(explicit) {
  if (explicit !== undefined && explicit !== null) return explicit;
  return process.env.GROK_BOT_AGENT_DATA || GROK_BOT_AGENT_DATA;
}

export function readGrokBotProfile(root, sessionId) {
  const profilePath = path.join(root, 'agents', sessionId, 'profile.json');
  try {
    const meta = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const name = typeof meta.name === 'string' ? meta.name.trim() : '';
    return { ai_title: name || null };
  } catch {
    return { ai_title: null };
  }
}

/**
 * Read a transcript JSONL for /api/trace. `filePath` is the jsonl itself.
 * Title lives in agents/<uuid>/profile.json beside agent-transcripts/.
 */
export function readGrokBotSession(filePath) {
  const { records } = parseJsonlFile(filePath);
  const sessionId = path.basename(path.dirname(filePath));
  const root = path.dirname(path.dirname(path.dirname(filePath)));
  const profile = readGrokBotProfile(root, sessionId);
  return { records, traceOpts: { ai_title: profile.ai_title } };
}

export function parseGrokBotRecords(records, sessionId, opts = {}) {
  const session = reduceSession(recordsToNormalized(records), {
    session_id:    sessionId,
    project_id:    opts.project_id ?? PROJECT_ID,
    project_label: opts.project_label ?? PROJECT_LABEL,
    harness:       'grok-bot',
    capabilities:  { size_proxy: 'tool_calls' },
  });
  if (opts.ai_title) session.ai_title = opts.ai_title;
  session.slug = grokBotSlug(sessionId);
  return session;
}

function applyFileMtime(session, filePath) {
  if (session.first_timestamp && session.last_timestamp) return;
  try {
    const mtime = fs.statSync(filePath).mtime.toISOString();
    if (!session.first_timestamp) session.first_timestamp = mtime;
    if (!session.last_timestamp)  session.last_timestamp  = mtime;
  } catch { /* optional */ }
}

export function analyzeGrokBotSession(sessionId, root) {
  const r = grokBotRoot(root);
  const filePath = path.join(r, 'agent-transcripts', sessionId, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return null;

  const { records, sizeBytes } = parseJsonlFile(filePath);
  const profile = readGrokBotProfile(r, sessionId);
  const session = parseGrokBotRecords(records, sessionId, { ai_title: profile.ai_title });
  session.file_size_bytes = sizeBytes;
  session.source = 'grok-bot';
  applyFileMtime(session, filePath);
  enrichSession(session);
  return session;
}

export function scanGrokBotSessions(root) {
  const r = grokBotRoot(root);
  const transcripts = path.join(r, 'agent-transcripts');
  return walkSessions(transcripts, 'grok-bot', function* (entries) {
    for (const sessionId of dirNames(entries)) {
      yield { id: sessionId, analyze: () => analyzeGrokBotSession(sessionId, r) };
    }
  }, { sourceDir: r });
}

function main() {
  const r = grokBotRoot();
  console.log('Scanning', r, '...');
  const result = scanGrokBotSessions();
  if (!result) {
    console.error(`Grok Bot agent-data directory not found: ${r}`);
    console.error('Set GROK_BOT_AGENT_DATA to a copied or mounted agent-data tree.');
    process.exit(1);
  }

  const output = buildSessionsOutput([result]);
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nSessions: ${output.sessions.length}`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();