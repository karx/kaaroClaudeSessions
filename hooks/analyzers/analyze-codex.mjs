#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { deriveLabel } from '../helpers/analyze-helpers.mjs';
import { parseJsonlFile } from '../jsonl-io.mjs';
import { buildSessionsOutput } from '../../surface/analyze-orchestrator.mjs';
import { recordsToNormalized } from '../adapters/codex.mjs';
import { reduceSession } from '../session-reducer.mjs';
import { enrichSession } from '../enrich-session.mjs';
import { walkSessions, dirNames } from '../scan-walk.mjs';
import { CODEX_HOME_ROOT } from '../harness-paths.mjs';

const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');

function sessionIdFromFilename(file) {
  const base = path.basename(file, '.jsonl');
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : base.replace(/^rollout-[^-]+-/, '');
}

function projectFromRecords(records) {
  const meta = records.find(r => r.type === 'session_meta')?.payload || {};
  const ctx = records.find(r => r.type === 'turn_context')?.payload || {};
  const cwd = meta.cwd || ctx.cwd || 'codex';
  const projectId = cwd.replace(/\\/g, '/').replace(/^\/Users\/[^/]+\//, 'Users--').replace(/[/:]+/g, '-');
  return {
    cwd,
    project_id: projectId,
    project_label: deriveLabel(path.basename(cwd) || 'codex'),
  };
}

export function readCodexSessionIndex(indexPath = path.join(CODEX_HOME_ROOT, 'session_index.jsonl')) {
  const out = {};
  let parsed;
  try {
    parsed = parseJsonlFile(indexPath).records;
  } catch {
    return out;
  }
  for (const rec of parsed) {
    if (!rec?.id) continue;
    const prev = out[rec.id];
    if (!prev || String(rec.updated_at || '') >= String(prev.updated_at || '')) out[rec.id] = rec;
  }
  return out;
}

export function analyzeCodexSession(filePath, opts = {}) {
  const { records, sizeBytes } = parseJsonlFile(filePath);
  const sessionId = sessionIdFromFilename(filePath);
  const project = projectFromRecords(records);
  const session = reduceSession(recordsToNormalized(records), {
    session_id: sessionId,
    project_id: project.project_id,
    project_label: project.project_label,
    harness: 'codex',
    file_size_bytes: sizeBytes,
    capabilities: { size_proxy: 'tokens_work', cache_accounting: false },
  });

  session.file_size_bytes = sizeBytes;
  session.source = 'codex';
  session.cwd ||= project.cwd;
  const title = opts.titleIndex?.[sessionId]?.thread_name;
  if (title) session.ai_title = title;
  enrichSession(session);
  return session;
}

function* rolloutFiles(root) {
  const sessionsRoot = path.join(root, 'sessions');
  const years = fs.existsSync(sessionsRoot)
    ? fs.readdirSync(sessionsRoot, { withFileTypes: true })
    : [];
  for (const year of dirNames(years)) {
    const yearDir = path.join(sessionsRoot, year);
    for (const month of dirNames(fs.readdirSync(yearDir, { withFileTypes: true }))) {
      const monthDir = path.join(yearDir, month);
      for (const day of dirNames(fs.readdirSync(monthDir, { withFileTypes: true }))) {
        const dayDir = path.join(monthDir, day);
        for (const file of fs.readdirSync(dayDir).filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl')).sort()) {
          yield path.join(dayDir, file);
        }
      }
    }
  }
}

export function scanCodexSessions(root = CODEX_HOME_ROOT) {
  const titleIndex = readCodexSessionIndex(path.join(root, 'session_index.jsonl'));
  return walkSessions(root, 'codex', function* () {
    for (const filePath of rolloutFiles(root)) {
      yield {
        id: path.relative(root, filePath),
        analyze: () => analyzeCodexSession(filePath, { root, titleIndex }),
      };
    }
  });
}

export { CODEX_HOME_ROOT, sessionIdFromFilename };

function main() {
  console.log('Scanning', CODEX_HOME_ROOT, '...');
  const result = scanCodexSessions();
  if (!result) {
    console.error(`Codex home directory not found: ${CODEX_HOME_ROOT}`);
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
