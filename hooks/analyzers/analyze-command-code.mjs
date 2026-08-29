#!/usr/bin/env node
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveLabel, parseJsonlFile } from '../../analyze.mjs';
import { buildSessionsOutput } from '../../surface/analyze-orchestrator.mjs';
import { recordsToNormalized } from '../adapters/command-code.mjs';
import { reduceSession } from '../session-reducer.mjs';
import { enrichSession } from '../enrich-session.mjs';
import { walkSessions, dirNames } from '../scan-walk.mjs';

import { COMMANDCODE_PROJECTS_ROOT } from '../harness-paths.mjs';
import { HARNESS_CAPABILITIES } from '../harness-capabilities.mjs';
const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');

// ── CC project label ─────────────────────────────────────────────────────────

function deriveCCLabel(projectId) {
  // Project IDs are like "users-arshigoyal-kaaro-src-kaaro-sessions"
  return deriveLabel(projectId.replace(/^users-[^-]+-/, ''));
}

// ── Per-session analysis ─────────────────────────────────────────────────────

export function parseCCRecords(records, sessionId, projectId) {
  const session = reduceSession(recordsToNormalized(records), {
    session_id: sessionId,
    project_id: projectId,
    project_label: deriveCCLabel(projectId),
    harness: 'command-code',
    capabilities: HARNESS_CAPABILITIES['command-code'],
  });

  // Read title from .meta.json if it exists
  const metaPath = path.join(COMMANDCODE_PROJECTS_ROOT, projectId, `${sessionId}.meta.json`);
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.title) session.ai_title = meta.title;
    }
  } catch { /* meta file is optional */ }

  return session;
}

// ── File reader ──────────────────────────────────────────────────────────────

function analyzeCCSession(projectId, filePath) {
  const { records, sizeBytes } = parseJsonlFile(filePath);
  const sessionId = path.basename(filePath, '.jsonl');
  const session = parseCCRecords(records, sessionId, projectId);
  session.file_size_bytes = sizeBytes;
  session.source = 'command-code';
  enrichSession(session);
  return session;
}

export function scanCommandCodeSessions(root = COMMANDCODE_PROJECTS_ROOT) {
  return walkSessions(root, 'command-code', function* (entries) {
    for (const projectId of dirNames(entries)) {
      const pdir = path.join(root, projectId);
      for (const file of fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl') && !f.endsWith('.checkpoints.jsonl')).sort()) {
        yield { id: file, analyze: () => analyzeCCSession(projectId, path.join(pdir, file)) };
      }
    }
  });
}

export { deriveCCLabel, COMMANDCODE_PROJECTS_ROOT };

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('Scanning', COMMANDCODE_PROJECTS_ROOT, '...');
  const result = scanCommandCodeSessions();
  if (!result) {
    console.error(`Command Code sessions directory not found: ${COMMANDCODE_PROJECTS_ROOT}`);
    console.error('Is command-code installed? Run: npm i -g command-code');
    process.exit(1);
  }

  const output = buildSessionsOutput([result]);
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const t = output.rollup.tokens;
  const total = t.input + t.cache_create + t.cache_read + t.output;
  console.log(`\nSessions: ${output.sessions.length}  Projects: ${output.projects.length}  Tool calls: ${output.rollup.tools ? Object.values(output.rollup.tools).reduce((a,b)=>a+b,0) : 0}`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
