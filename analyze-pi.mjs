#!/usr/bin/env node
import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';
import {
  deriveLabel, normPath, parseJsonlFile, categorizeBash,
  buildProjectSummary, buildGlobalRollup,
} from './analyze.mjs';

// ── Config ────────────────────────────────────────────────────────────────────

const PI_SESSIONS_ROOT = path.join(os.homedir(), '.pi', 'agent', 'sessions');
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
  return session;
}

export { derivePiLabel, parsePiRecords, PI_SESSIONS_ROOT };

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  let projectEntries;
  try {
    projectEntries = fs.readdirSync(PI_SESSIONS_ROOT, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Pi sessions directory not found: ${PI_SESSIONS_ROOT}`);
      console.error('Is pi installed? Run: npm i -g @mariozechner/pi-coding-agent');
      process.exit(1);
    }
    throw err;
  }

  console.log('Scanning', PI_SESSIONS_ROOT, '...');

  const allSessions = [];
  const projectDirs = projectEntries.filter(d => d.isDirectory()).map(d => d.name).sort();

  for (const projectId of projectDirs) {
    const pdir  = path.join(PI_SESSIONS_ROOT, projectId);
    const files = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')).sort();
    console.log(`  ${projectId}: ${files.length} sessions`);
    for (const file of files) {
      try {
        allSessions.push(analyzePiSession(projectId, path.join(pdir, file)));
      } catch (err) {
        console.error(`  !! ${file}: ${err.message}`);
      }
    }
  }

  allSessions.sort((a, b) => (a.first_timestamp || '') < (b.first_timestamp || '') ? -1 : 1);

  const projectMap = {};
  for (const sess of allSessions) {
    if (!projectMap[sess.project_id]) projectMap[sess.project_id] = [];
    projectMap[sess.project_id].push(sess);
  }

  const projects = Object.entries(projectMap)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([id, sessions]) => buildProjectSummary(id, sessions));

  const rollup = buildGlobalRollup(allSessions);

  for (const sess of allSessions) {
    const t = sess.tokens;
    t.total = t.input + t.cache_create + t.cache_read + t.output;
    const inputSide = t.input + t.cache_create + t.cache_read;
    sess.cache_hit_rate = inputSide > 0 ? +(t.cache_read / inputSide * 100).toFixed(1) : 0;
    sess.duration_min   = sess.duration_ms != null ? +(sess.duration_ms / 60000).toFixed(1) : null;
    sess.tool_diversity = Object.keys(sess.tools).length;
    if (sess.first_timestamp) {
      const d = new Date(sess.first_timestamp);
      sess.day_of_week = d.getUTCDay();
      sess.hour_of_day = d.getUTCHours();
      sess.date_str    = sess.first_timestamp.slice(0, 10);
    }
  }

  const output = {
    meta: {
      generated_at:   new Date().toISOString(),
      source_dir:     PI_SESSIONS_ROOT,
      harness:        'pi',
      total_sessions: allSessions.length,
      total_projects: projects.length,
      date_range: {
        first: allSessions.find(s => s.first_timestamp)?.first_timestamp ?? null,
        last:  allSessions.findLast(s => s.last_timestamp)?.last_timestamp ?? null,
      },
    },
    projects,
    sessions: allSessions,
    rollup,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const t = rollup.tokens;
  const total = t.input + t.cache_create + t.cache_read + t.output;
  console.log(`\nSessions: ${allSessions.length}  Projects: ${projects.length}  Tokens: ${total.toLocaleString()}`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
