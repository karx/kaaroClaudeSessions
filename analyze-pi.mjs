#!/usr/bin/env node
import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';
import {
  deriveLabel, normPath, parseJsonlFile, categorizeBash,
  buildProjectSummary, buildGlobalRollup, enrichSession,
} from './analyze.mjs';
import { buildSessionsOutput } from './lib/analyze-orchestrator.mjs';

// ── Config ────────────────────────────────────────────────────────────────────

import { PI_SESSIONS_ROOT } from './lib/harness-paths.mjs';
const OUT_FILE         = path.join(process.cwd(), 'sessions-data.json');

// ── Pi project label ──────────────────────────────────────────────────────────

function derivePiLabel(slug) {
  return deriveLabel(slug.replace(/^--/, '').replace(/--$/, ''));
}

// ── Per-session analysis ──────────────────────────────────────────────────────

const FILE_OPS = new Set(['read', 'write', 'edit']);

function parsePiRecords(records, sessionId, projectId) {
  const session = {
    session_id:      sessionId,
    project_id:      projectId,
    project_label:   derivePiLabel(projectId),
    file_size_bytes: 0,

    first_timestamp: null,
    last_timestamp:  null,

    slug:            sessionId.slice(0, 8),
    duration_ms:     null,
    message_count:   null,
    cwd:             null,
    model:           null,

    harness:         'pi',

    user_turns:      0,
    assistant_turns: 0,
    tool_calls:      0,
    tool_errors:     0,

    tokens:          { input: 0, cache_create: 0, cache_read: 0, output: 0 },
    tools:           {},
    file_ops:        {},
    bash_categories: {},
    stop_reasons:    {},
    skills:          [],
    builtin_commands: [],
    first_user_message: null,
  };

  let firstUserSeen = false;

  for (const rec of records) {
    const ts = rec.timestamp;
    if (ts) {
      if (!session.first_timestamp || ts < session.first_timestamp) session.first_timestamp = ts;
      if (!session.last_timestamp  || ts > session.last_timestamp)  session.last_timestamp  = ts;
    }

    if (rec.type === 'session') {
      if (rec.cwd) session.cwd = rec.cwd;
    }

    if (rec.type === 'model_change') {
      session.model = [rec.provider, rec.modelId].filter(Boolean).join('/') || null;
    }

    if (rec.type === 'message' && rec.message) {
      const msg = rec.message;

      if (msg.role === 'user') {
        session.user_turns++;
        if (!firstUserSeen) {
          const text = (Array.isArray(msg.content) ? msg.content : [])
            .filter(b => b.type === 'text')
            .map(b => b.text || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (text.length >= 8) {
            session.first_user_message = text.slice(0, 200);
            firstUserSeen = true;
          }
        }
      }

      if (msg.role === 'assistant') {
        session.assistant_turns++;
        if (msg.model) {
          session.model = [msg.provider, msg.model].filter(Boolean).join('/') || null;
        }

        const u = msg.usage || {};
        session.tokens.input        += u.input      || 0;
        session.tokens.output       += u.output     || 0;
        session.tokens.cache_read   += u.cacheRead  || 0;
        session.tokens.cache_create += u.cacheWrite || 0;

        if (msg.stopReason) {
          session.stop_reasons[msg.stopReason] = (session.stop_reasons[msg.stopReason] || 0) + 1;
        }

        for (const block of (msg.content || [])) {
          if (block.type !== 'toolCall') continue;
          session.tool_calls++;
          const name = block.name || 'unknown';
          if (!session.tools[name]) session.tools[name] = { calls: 0, errors: 0 };
          session.tools[name].calls++;

          if (FILE_OPS.has(name) && block.arguments?.path) {
            const fp = normPath(block.arguments.path);
            if (fp) {
              if (!session.file_ops[fp]) session.file_ops[fp] = { read: 0, write: 0, edit: 0 };
              session.file_ops[fp][name]++;
            }
          }

          if (name === 'bash' && block.arguments?.command) {
            const cat = categorizeBash(block.arguments.command);
            session.bash_categories[cat] = (session.bash_categories[cat] || 0) + 1;
          }
        }
      }
    }
  }

  session.message_count = session.user_turns + session.assistant_turns;
  return session;
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

export { derivePiLabel, parsePiRecords, PI_SESSIONS_ROOT };

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
