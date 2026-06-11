#!/usr/bin/env node
import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';
import { deriveLabel, parseJsonlFile } from '../../analyze.mjs';
import { buildSessionsOutput } from '../../surface/analyze-orchestrator.mjs';
import { recordsToNormalized } from '../adapters/pi.mjs';
import { reduceSession } from '../session-reducer.mjs';
import { enrichSession } from '../enrich-session.mjs';

// ── Config ────────────────────────────────────────────────────────────────────

import { PI_SESSIONS_ROOT } from '../harness-paths.mjs';
const OUT_FILE         = path.join(process.cwd(), 'sessions-data.json');

// ── Pi project label ──────────────────────────────────────────────────────────

function derivePiLabel(slug) {
  return deriveLabel(slug.replace(/^--/, '').replace(/--$/, ''));
}

// ── Per-session analysis ──────────────────────────────────────────────────────

export function parsePiRecords(records, sessionId, projectId) {
  return reduceSession(recordsToNormalized(records), {
    session_id:      sessionId,
    project_id:      projectId,
    project_label:   derivePiLabel(projectId),
    harness:         'pi',
    capabilities:    { size_proxy: 'tokens_work' },
  });
}

// ── File reader ───────────────────────────────────────────────────────────────

function analyzePiSession(projectId, filePath) {
  const { records, sizeBytes } = parseJsonlFile(filePath);
  const base      = path.basename(filePath, '.jsonl');
  const sessionId = base.includes('_') ? base.slice(base.indexOf('_') + 1) : base;
  const session   = parsePiRecords(records, sessionId, projectId);
  session.file_size_bytes = sizeBytes;
  session.source = 'pi';
  enrichSession(session);
  return session;
}

export function scanPiSessions(root = PI_SESSIONS_ROOT) {
  let projectEntries;
  try {
    projectEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  const allSessions = [];
  for (const projectId of projectEntries.filter(d => d.isDirectory()).map(d => d.name).sort()) {
    const pdir  = path.join(root, projectId);
    const files = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')).sort();
    for (const file of files) {
      try {
        allSessions.push(analyzePiSession(projectId, path.join(pdir, file)));
      } catch (err) {
        console.error(`  !! ${file}: ${err.message}`);
      }
    }
  }

  return { harness: 'pi', source_dir: root, sessions: allSessions };
}

export { derivePiLabel, PI_SESSIONS_ROOT };

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('Scanning', PI_SESSIONS_ROOT, '...');
  const result = scanPiSessions();
  if (!result) {
    console.error(`Pi sessions directory not found: ${PI_SESSIONS_ROOT}`);
    console.error('Is pi installed? Run: npm i -g @mariozechner/pi-coding-agent');
    process.exit(1);
  }

  const output = buildSessionsOutput([result]);
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const t = output.rollup.tokens;
  const total = t.input + t.cache_create + t.cache_read + t.output;
  console.log(`\nSessions: ${output.sessions.length}  Projects: ${output.projects.length}  Tokens: ${total.toLocaleString()}`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
