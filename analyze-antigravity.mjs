#!/usr/bin/env node
/**
 * analyze-antigravity.mjs
 *
 * Parser adapter for Google Antigravity coding-agent session logs.
 * Reads ~/.gemini/antigravity/brain/<conversationId>/.system_generated/logs/
 * and extracts per-session statistics into the normalized sessions-data.json
 * format consumed by the graph builder.
 *
 * Session log format:
 *   transcript.jsonl  — full record log (present only for active sessions)
 *   overview.txt      — compact record log (present for all sessions)
 *
 * Part of kaaro-sessions — a kaaroViewer companion tool.
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';
import {
  normPath, categorizeBash,
  buildProjectSummary, buildGlobalRollup, enrichSession,
} from './analyze.mjs';

// ── Config ────────────────────────────────────────────────────────────────────

export const ANTIGRAVITY_BRAIN_ROOT = path.join(
  os.homedir(), '.gemini', 'antigravity', 'brain'
);
const OUT_FILE = path.join(process.cwd(), 'sessions-data.json');

// ── Arg parsing ───────────────────────────────────────────────────────────────

/**
 * Tool call args in Antigravity transcripts are JSON-stringified values.
 * e.g. args.Cwd = '"d:\\\\src\\\\ebrain"' → parseArgValue → 'd:\\src\\ebrain'
 */
export function parseArgValue(val) {
  if (!val || typeof val !== 'string') return null;
  try { return JSON.parse(val); } catch { return val.trim(); }
}

// ── Project derivation ────────────────────────────────────────────────────────

/**
 * Convert a filesystem cwd path to a Claude-Code-compatible project slug.
 *   'D:\src\ebrain'              → 'D--src-ebrain'
 *   'D:\src\exp\art-of-mine'    → 'D--src-exp-art-of-mine'
 *   '/home/user/project'        → 'home-user-project'
 */
export function deriveAntigravityProjectId(cwdRaw) {
  if (!cwdRaw) return 'antigravity-unknown';
  const norm = cwdRaw.replace(/\\/g, '/').replace(/\/$/, '');
  const driveMatch = norm.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase();
    const rest  = norm.slice(3).replace(/\//g, '-');
    return `${drive}--${rest}`;
  }
  // Unix-style path or no drive letter
  return norm.replace(/^\//, '').replace(/\//g, '-') || 'antigravity-unknown';
}

/**
 * Human-readable label: last path segment.
 *   'D:\src\ebrain'     → 'ebrain'
 *   'D:\src\exp\proj'   → 'proj'
 */
export function deriveAntigravityLabel(cwdRaw) {
  if (!cwdRaw) return 'unknown';
  const norm = cwdRaw.replace(/\\/g, '/').replace(/\/$/, '');
  return norm.split('/').pop() || 'unknown';
}

// ── Workspace detection ───────────────────────────────────────────────────────

/**
 * Extract a workspace path from a single tool call.
 * Returns null if no path can be determined.
 */
function cwdFromToolCall(tc) {
  const name = tc.name || '';
  const args = tc.args || {};

  if (name === 'run_command') {
    return parseArgValue(args.Cwd) || null;
  }
  if (name === 'list_dir') {
    return parseArgValue(args.DirectoryPath) || null;
  }
  if (['view_file', 'write_to_file', 'replace_file_content',
       'multi_replace_file_content'].includes(name)) {
    const raw = parseArgValue(args.AbsolutePath || args.TargetFile);
    if (!raw) return null;
    const norm = raw.replace(/\\/g, '/');
    return norm.substring(0, norm.lastIndexOf('/')) || null;
  }
  return null;
}

/**
 * Detect the dominant workspace directory across all tool calls in a session.
 * Uses frequency voting — the most-called-from directory wins.
 */
export function detectWorkspace(records) {
  const counts = {};
  for (const rec of records) {
    if (rec.type !== 'PLANNER_RESPONSE') continue;
    for (const tc of (rec.tool_calls || [])) {
      const cwd = cwdFromToolCall(tc);
      if (cwd) counts[cwd] = (counts[cwd] || 0) + 1;
    }
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// ── Model extraction ──────────────────────────────────────────────────────────

/**
 * Extract model name from USER_SETTINGS_CHANGE block inside USER_INPUT content.
 * Matches: "changed setting `Model Selection` from X to <ModelName>."
 * Returns the model name string, or null.
 */
export function extractModelChange(content) {
  if (!content || typeof content !== 'string') return null;
  const m = content.match(/changed setting `Model Selection` from .+? to (.+?)\.\s/);
  return m ? m[1].trim() : null;
}

// ── User message extraction ───────────────────────────────────────────────────

/**
 * Extract the user's actual request from USER_INPUT content, which wraps the
 * request in XML-like tags (<USER_REQUEST>, <ADDITIONAL_METADATA>, etc.).
 */
export function extractUserMessage(content) {
  if (!content || typeof content !== 'string') return null;
  // Extract just the USER_REQUEST block if present
  const reqMatch = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  const text = reqMatch ? reqMatch[1] : content;
  // Strip remaining XML-like tags and normalize whitespace
  const stripped = text
    .replace(/<[A-Z_]+>[\s\S]*?<\/[A-Z_]+>/g, '')
    .replace(/<[A-Z_]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 8 ? stripped.slice(0, 200) : null;
}

// ── Tool name → file_ops mapping ──────────────────────────────────────────────

const FILE_OP_MAP = {
  view_file:                 'read',
  write_to_file:             'write',
  replace_file_content:      'edit',
  multi_replace_file_content:'edit',
};

// Record type → canonical tool name (for error attribution)
const REC_TYPE_TO_TOOL = {
  VIEW_FILE:      'view_file',
  LIST_DIRECTORY: 'list_dir',
  GREP_SEARCH:    'grep_search',
  RUN_COMMAND:    'run_command',
};

// ── JSONL parser ──────────────────────────────────────────────────────────────

function parseJsonlFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return { records, sizeBytes: Buffer.byteLength(raw, 'utf8') };
}

// ── Per-session analysis ──────────────────────────────────────────────────────

/**
 * Parse Antigravity transcript records for a single session.
 * Project fields (project_id, project_label, cwd) are filled in after scanning.
 */
export function parseAntigravityRecords(records, sessionId) {
  const session = {
    session_id:      sessionId,
    project_id:      null,   // filled after workspace detection
    project_label:   null,
    file_size_bytes: 0,

    first_timestamp: null,
    last_timestamp:  null,

    slug:            sessionId.slice(0, 8),
    duration_ms:     null,
    message_count:   null,
    cwd:             null,
    model:           null,

    harness:         'antigravity',

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
    // Track timestamps across all records
    const ts = rec.created_at;
    if (ts) {
      if (!session.first_timestamp || ts < session.first_timestamp)
        session.first_timestamp = ts;
      if (!session.last_timestamp  || ts > session.last_timestamp)
        session.last_timestamp = ts;
    }

    // ── User turns ───────────────────────────────────────────────────────────
    if (rec.type === 'USER_INPUT' && rec.source === 'USER_EXPLICIT') {
      session.user_turns++;
      const content = rec.content || '';

      // Model tracking: USER_SETTINGS_CHANGE embeds model selection changes
      const model = extractModelChange(content);
      if (model) session.model = model;

      // First user message
      if (!firstUserSeen) {
        const msg = extractUserMessage(content);
        if (msg) { session.first_user_message = msg; firstUserSeen = true; }
      }
    }

    // ── Assistant turns ──────────────────────────────────────────────────────
    if (rec.type === 'PLANNER_RESPONSE' && rec.source === 'MODEL') {
      session.assistant_turns++;

      for (const tc of (rec.tool_calls || [])) {
        session.tool_calls++;
        const name = tc.name || 'unknown';
        if (!session.tools[name]) session.tools[name] = { calls: 0, errors: 0 };
        session.tools[name].calls++;

        const args = tc.args || {};

        // File ops
        const op = FILE_OP_MAP[name];
        if (op) {
          const rawPath = parseArgValue(args.AbsolutePath || args.TargetFile);
          const fp = normPath(rawPath);
          if (fp) {
            if (!session.file_ops[fp]) session.file_ops[fp] = { read: 0, write: 0, edit: 0 };
            session.file_ops[fp][op]++;
          }
        }

        // Bash categories (run_command)
        if (name === 'run_command') {
          const cmd = parseArgValue(args.CommandLine);
          if (cmd) {
            const cat = categorizeBash(cmd);
            session.bash_categories[cat] = (session.bash_categories[cat] || 0) + 1;
          }
        }
      }
    }

    // ── Tool errors ──────────────────────────────────────────────────────────
    // Tool result records that carry status ERROR indicate a failed tool call
    if (rec.source === 'MODEL'
        && rec.type !== 'PLANNER_RESPONSE'
        && rec.status === 'ERROR') {
      session.tool_errors++;
      const toolName = REC_TYPE_TO_TOOL[rec.type];
      if (toolName && session.tools[toolName]) session.tools[toolName].errors++;
    }
  }

  // ── Post-scan derivations ─────────────────────────────────────────────────
  const cwd = detectWorkspace(records);
  session.cwd         = cwd;
  session.project_id  = deriveAntigravityProjectId(cwd);
  session.project_label = deriveAntigravityLabel(cwd);
  session.message_count = session.user_turns + session.assistant_turns;

  if (session.first_timestamp && session.last_timestamp) {
    session.duration_ms =
      new Date(session.last_timestamp).getTime() -
      new Date(session.first_timestamp).getTime();
  }

  return session;
}

export { ANTIGRAVITY_BRAIN_ROOT as default };

// ── Main ──────────────────────────────────────────────────────────────────────

function analyzeAntigravitySession(conversationId, brainDir) {
  const sessionDir = path.join(brainDir, conversationId, '.system_generated', 'logs');

  // Prefer transcript.jsonl (richer), fall back to overview.txt (compact)
  const transcriptPath = path.join(sessionDir, 'transcript.jsonl');
  const overviewPath   = path.join(sessionDir, 'overview.txt');

  let logPath;
  if (fs.existsSync(transcriptPath)) {
    logPath = transcriptPath;
  } else if (fs.existsSync(overviewPath)) {
    logPath = overviewPath;
  } else {
    return null; // No log file available for this session
  }

  const { records, sizeBytes } = parseJsonlFile(logPath);
  if (records.length === 0) return null;

  const session = parseAntigravityRecords(records, conversationId);
  session.file_size_bytes = sizeBytes;
  enrichSession(session);
  return session;
}

function main() {
  let conversationDirs;
  try {
    conversationDirs = fs.readdirSync(ANTIGRAVITY_BRAIN_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Antigravity brain directory not found: ${ANTIGRAVITY_BRAIN_ROOT}`);
      console.error('Is the Antigravity coding agent installed?');
      process.exit(1);
    }
    throw err;
  }

  console.log('Scanning', ANTIGRAVITY_BRAIN_ROOT, '...');

  const allSessions = [];
  for (const conversationId of conversationDirs) {
    try {
      const session = analyzeAntigravitySession(conversationId, ANTIGRAVITY_BRAIN_ROOT);
      if (session) {
        allSessions.push(session);
        console.log(`  ${conversationId.slice(0, 8)}: ${session.user_turns}u/${session.assistant_turns}a turns  [${session.project_label}]`);
      }
    } catch (err) {
      console.error(`  !! ${conversationId}: ${err.message}`);
    }
  }

  allSessions.sort((a, b) =>
    (a.first_timestamp || '') < (b.first_timestamp || '') ? -1 : 1
  );

  const projectMap = {};
  for (const sess of allSessions) {
    if (!projectMap[sess.project_id]) projectMap[sess.project_id] = [];
    projectMap[sess.project_id].push(sess);
  }

  const projects = Object.entries(projectMap)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([id, sessions]) => buildProjectSummary(id, sessions));

  // Override project labels with our cwd-derived labels
  for (const proj of projects) {
    const sample = projectMap[proj.id]?.[0];
    if (sample?.project_label) proj.label = sample.project_label;
  }

  const rollup = buildGlobalRollup(allSessions);

  const output = {
    meta: {
      generated_at:   new Date().toISOString(),
      source_dir:     ANTIGRAVITY_BRAIN_ROOT,
      harness:        'antigravity',
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
  console.log(`\nSessions: ${allSessions.length}  Projects: ${projects.length}  Tool calls: ${allSessions.reduce((s, a) => s + (a.tool_calls || 0), 0)}  Tokens: ${total.toLocaleString()} (not tracked by Antigravity)`);
  console.log(`Output: ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
