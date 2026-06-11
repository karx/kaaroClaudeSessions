#!/usr/bin/env node
/**
 * analyze-opencode.mjs
 *
 * Harness Hook scanner/analyzer for opencode sessions.
 * Reads ~/.local/share/opencode/storage/{session,message,part}/ JSON trees.
 *
 * Layout (probed 2026-06-11, opencode 1.0.201):
 *   storage/session/<projectID|global>/ses_*.json   — session info (title, directory, times)
 *   storage/message/<sessionID>/msg_*.json          — messages (role, model, tokens)
 *   storage/part/<messageID>/prt_*.json             — parts (text, reasoning, tool, …)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { enrichSession } from '../enrich-session.mjs';
import { buildSessionsOutput } from '../../surface/analyze-orchestrator.mjs';
import { recordsToNormalized } from '../adapters/opencode.mjs';
import { reduceSession } from '../session-reducer.mjs';
import {
  deriveAntigravityProjectId as deriveProjectIdFromPath,
  deriveAntigravityLabel as deriveLabelFromPath,
} from '../helpers/antigravity-helpers.mjs';
import { OPENCODE_STORAGE_ROOT } from '../harness-paths.mjs';

export { OPENCODE_STORAGE_ROOT };

const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');

export function opencodeSlug(sessionId) {
  return sessionId.replace(/^ses_/, '').slice(0, 8);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function listJsonFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  return entries.filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
}

/**
 * Assemble one session: info + messages (chronological) with parts embedded.
 * @returns {{ info: object, records: object[], sizeBytes: number }}
 */
export function readOpencodeSession(storageRoot, infoPath) {
  const info = readJson(infoPath);
  let sizeBytes = fs.statSync(infoPath).size;

  const messages = [];
  for (const msgPath of listJsonFiles(path.join(storageRoot, 'message', info.id))) {
    try {
      const msg = readJson(msgPath);
      sizeBytes += fs.statSync(msgPath).size;
      const parts = [];
      for (const partPath of listJsonFiles(path.join(storageRoot, 'part', msg.id))) {
        try {
          parts.push(readJson(partPath));
          sizeBytes += fs.statSync(partPath).size;
        } catch { /* skip malformed part */ }
      }
      parts.sort((a, b) => String(a.id).localeCompare(String(b.id))); // prt_ ids are monotonic
      msg._parts = parts;
      messages.push(msg);
    } catch { /* skip malformed message */ }
  }
  messages.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));

  return { info, records: [info, ...messages], sizeBytes };
}

export function analyzeOpencodeSession(storageRoot, infoPath) {
  const { info, records, sizeBytes } = readOpencodeSession(storageRoot, infoPath);
  if (!info?.id) return null;

  const session = reduceSession(recordsToNormalized(records), {
    session_id:    info.id,
    project_id:    deriveProjectIdFromPath(info.directory), // CC-style path slug → cross-harness project unify
    project_label: deriveLabelFromPath(info.directory),
    harness:       'opencode',
    capabilities:  { size_proxy: 'tokens_work' },
  });

  session.slug = opencodeSlug(info.id);
  const updatedIso = info.time?.updated ? new Date(info.time.updated).toISOString() : null;
  if (updatedIso && (!session.last_timestamp || updatedIso > session.last_timestamp)) {
    session.last_timestamp = updatedIso;
  }
  if (!session.duration_ms && session.first_timestamp && session.last_timestamp) {
    session.duration_ms =
      new Date(session.last_timestamp).getTime() - new Date(session.first_timestamp).getTime();
  }
  session.file_size_bytes = sizeBytes;
  session.source = 'opencode';
  enrichSession(session);
  return session;
}

export function scanOpencodeSessions(storageRoot = OPENCODE_STORAGE_ROOT) {
  const sessionRoot = path.join(storageRoot, 'session');
  let buckets;
  try {
    buckets = fs.readdirSync(sessionRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  const sessions = [];
  for (const bucket of buckets.filter(d => d.isDirectory()).map(d => d.name).sort()) {
    for (const infoPath of listJsonFiles(path.join(sessionRoot, bucket))) {
      if (!path.basename(infoPath).startsWith('ses_')) continue;
      try {
        const session = analyzeOpencodeSession(storageRoot, infoPath);
        if (session) sessions.push(session);
      } catch (err) {
        console.error(`  !! [opencode] ${bucket}/${path.basename(infoPath)}: ${err.message}`);
      }
    }
  }

  return { harness: 'opencode', source_dir: storageRoot, sessions };
}

function main() {
  const result = scanOpencodeSessions();
  if (!result?.sessions?.length) {
    console.error(`opencode storage not found or empty: ${OPENCODE_STORAGE_ROOT}`);
    process.exit(1);
  }

  console.log('Scanning', OPENCODE_STORAGE_ROOT, '...');
  const output = buildSessionsOutput([result]);
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nSessions: ${output.sessions.length}  Projects: ${output.projects.length}`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
