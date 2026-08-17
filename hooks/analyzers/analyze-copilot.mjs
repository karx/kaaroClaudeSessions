#!/usr/bin/env node
/**
 * analyze-copilot.mjs
 *
 * Harness Hook scanner/analyzer for GitHub Copilot (VS Code chat) sessions.
 *
 * Layout (probed 2026-06-11):
 *   <workspaceStorage>/<hash>/workspace.json            — { folder: "file:///…" } project attribution
 *   <workspaceStorage>/<hash>/chatSessions/<uuid>.jsonl — op-log (current format, live-tailable)
 *   <workspaceStorage>/<hash>/chatSessions/<uuid>.json  — single dump (older format)
 *   <workspaceStorage>/<hash>/state.vscdb               — SQLite; chat.ChatSessionStore.index
 *                                                         { entries: { <uuid>: { title, lastMessageDate, isEmpty } } }
 *
 * The SQLite index is optional enrichment, read zero-dep via node:sqlite
 * (Node ≥22.5, experimental) — any failure degrades silently to {}.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { enrichSession } from '../enrich-session.mjs';
import { buildSessionsOutput } from '../../surface/analyze-orchestrator.mjs';
import { recordsToNormalized } from '../adapters/copilot.mjs';
import { reduceSession } from '../session-reducer.mjs';
import { walkSessions, dirNames } from '../scan-walk.mjs';
import { copilotUriToPath, workspaceFolderPath } from '../helpers/copilot-helpers.mjs';
import {
  deriveAntigravityProjectId as deriveProjectIdFromPath,
  deriveAntigravityLabel as deriveLabelFromPath,
} from '../helpers/antigravity-helpers.mjs';
import { COPILOT_WORKSPACE_STORAGE_ROOT } from '../harness-paths.mjs';

export { COPILOT_WORKSPACE_STORAGE_ROOT };
export { workspaceFolderPath }; // canonical home: hooks/helpers/copilot-helpers.mjs

const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');

/** Read chat.ChatSessionStore.index entries from state.vscdb; {} on any failure. */
export function readChatSessionIndex(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) return {};
    // Dynamic require-style import keeps node:sqlite optional (experimental API).
    const { DatabaseSync } = process.getBuiltinModule?.('node:sqlite') ?? {};
    if (!DatabaseSync) return {};
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare(
        "SELECT value FROM ItemTable WHERE key='chat.ChatSessionStore.index'"
      ).get();
      if (!row?.value) return {};
      return JSON.parse(String(row.value)).entries ?? {};
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

/**
 * Read one chatSessions file → op records.
 * .jsonl → parsed op lines; .json (old dump) → [dump] (adapter treats it as snapshot).
 */
export function readCopilotSession(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const sizeBytes = Buffer.byteLength(raw, 'utf8');
  if (filePath.endsWith('.jsonl')) {
    const records = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return { records, sizeBytes };
  }
  try { return { records: [JSON.parse(raw)], sizeBytes }; }
  catch { return { records: [], sizeBytes }; }
}

export function analyzeCopilotSession(filePath, projectInfo = {}) {
  const { records, sizeBytes } = readCopilotSession(filePath);
  if (!records.length) return null;

  const sessionId = path.basename(filePath).replace(/\.(jsonl|json)$/, '');
  const session = reduceSession(recordsToNormalized(records), {
    session_id:    sessionId,
    project_id:    projectInfo.project_id ?? 'copilot-unknown',
    project_label: projectInfo.project_label ?? 'copilot',
    harness:       'copilot',
    capabilities:  { size_proxy: 'tokens_work' },
  });

  if (projectInfo.cwd) session.cwd = projectInfo.cwd;
  if (!session.duration_ms && session.first_timestamp && session.last_timestamp) {
    session.duration_ms =
      new Date(session.last_timestamp).getTime() - new Date(session.first_timestamp).getTime();
  }
  session.file_size_bytes = sizeBytes;
  session.source = 'copilot';
  enrichSession(session);
  return session;
}

export function scanCopilotSessions(wsRoot = COPILOT_WORKSPACE_STORAGE_ROOT) {
  return walkSessions(wsRoot, 'copilot', function* (entries) {
    for (const ws of dirNames(entries)) {
      const wsDir = path.join(wsRoot, ws);
      const chatDir = path.join(wsDir, 'chatSessions');
      let files;
      try { files = fs.readdirSync(chatDir); } catch { continue; }

      let projectInfo = {};
      try {
        const folder = workspaceFolderPath(
          JSON.parse(fs.readFileSync(path.join(wsDir, 'workspace.json'), 'utf8'))
        );
        if (folder) {
          projectInfo = {
            project_id: deriveProjectIdFromPath(folder),
            project_label: deriveLabelFromPath(folder),
            cwd: folder,
          };
        }
      } catch { /* unattributed workspace */ }

      const index = readChatSessionIndex(path.join(wsDir, 'state.vscdb'));

      for (const f of files) {
        if (!/\.(jsonl|json)$/.test(f)) continue;
        yield { id: `${ws}/${f}`, analyze: () => {
          const session = analyzeCopilotSession(path.join(chatDir, f), projectInfo);
          if (!session) return null;
          const entry = index[session.session_id];
          if (entry?.title && !session.ai_title && entry.title !== 'New Chat') {
            session.ai_title = entry.title;
          }
          if (entry?.lastMessageDate) {
            const last = new Date(entry.lastMessageDate).toISOString();
            if (!session.last_timestamp || last > session.last_timestamp) session.last_timestamp = last;
          }
          if (entry?.isEmpty && !session.user_turns) return null; // indexed-empty + no turns → skip
          return session;
        } };
      }
    }
  });
}

function main() {
  const result = scanCopilotSessions();
  if (!result?.sessions?.length) {
    console.error(`Copilot workspaceStorage not found or empty: ${COPILOT_WORKSPACE_STORAGE_ROOT}`);
    process.exit(1);
  }

  console.log('Scanning', COPILOT_WORKSPACE_STORAGE_ROOT, '...');
  const output = buildSessionsOutput([result]);
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nSessions: ${output.sessions.length}  Projects: ${output.projects.length}`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
