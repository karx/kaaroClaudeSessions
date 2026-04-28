#!/usr/bin/env node
/**
 * analyze.mjs
 *
 * Walks ~/.claude/projects/ and extracts per-session statistics from JSONL files.
 * Output: sessions-data.json in the current working directory.
 *
 * Part of kaaro-sessions — a kaaroViewer companion tool.
 * https://github.com/kaaro/kaaroViewer
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
const OUT_FILE      = path.join(process.cwd(), 'sessions-data.json');

const BUILTIN_COMMANDS = new Set([
  'exit', 'clear', 'compact', 'context', 'model', 'help', 'voice',
  'plan', 'fast', 'config', 'review', 'memory', 'doctor', 'status',
  'rate-limit-options', 'mcp', 'cost', 'log',
]);

// ── Project label derivation ──────────────────────────────────────────────────

function deriveLabel(projectId) {
  // D--src-kaaroViewer    → kaaroViewer
  // D--src-karx-github-io → karx-github-io
  // C--Users-karx0-foo    → foo
  return projectId
    .replace(/^[A-Za-z]--src-/, '')
    .replace(/^[A-Za-z]--Users-[^-]+-/, '');
}

// ── Path normaliser ───────────────────────────────────────────────────────────

function normPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/\\/g, '/').replace(/\/\//g, '/').trim() || null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJsonlFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
  const records = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return records;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content))    return '';
  return content.filter(b => b.type === 'text').map(b => b.text || '').join(' ');
}

function extractSkills(text) {
  return [...text.matchAll(/<command-name>\/?([\w-]+)<\/command-name>/g)].map(m => m[1]);
}

// ── Per-session analysis ──────────────────────────────────────────────────────

function analyzeSession(projectId, filePath) {
  const records  = parseJsonlFile(filePath);
  const sessionId = path.basename(filePath, '.jsonl');

  const session = {
    session_id:      sessionId,
    project_id:      projectId,
    project_label:   deriveLabel(projectId),
    file_size_bytes: fs.statSync(filePath).size,

    first_timestamp: null,
    last_timestamp:  null,

    slug:           null,
    duration_ms:    null,
    message_count:  null,
    version:        null,
    entrypoint:     null,
    git_branch:     null,
    cwd:            null,
    permission_mode: null,
    model:          null,

    user_turns:      0,
    assistant_turns: 0,
    tool_calls:      0,
    tool_errors:     0,

    tokens:          { input: 0, cache_create: 0, cache_read: 0, output: 0 },
    tools:           {},
    file_ops:        {},
    bash_categories: {},
    content_blocks:  {},
    stop_reasons:    {},
    skills:          [],
    builtin_commands: [],
    first_user_message: null,
  };

  let firstUserSeen = false;

  for (const rec of records) {
    if (rec.timestamp) {
      if (!session.first_timestamp || rec.timestamp < session.first_timestamp)
        session.first_timestamp = rec.timestamp;
      if (!session.last_timestamp  || rec.timestamp > session.last_timestamp)
        session.last_timestamp = rec.timestamp;
    }

    if (rec.type === 'permission-mode') session.permission_mode = rec.permissionMode;

    if (rec.type === 'system' && rec.subtype === 'turn_duration') {
      if (rec.durationMs   != null) session.duration_ms   = rec.durationMs;
      if (rec.messageCount != null) session.message_count = rec.messageCount;
      if (rec.slug)       session.slug       = rec.slug;
      if (rec.version)    session.version    = rec.version;
      if (rec.entrypoint) session.entrypoint = rec.entrypoint;
      if (rec.gitBranch)  session.git_branch = rec.gitBranch;
      if (rec.cwd)        session.cwd        = rec.cwd;
    }

    if (rec.type === 'user' && rec.message) {
      session.user_turns++;
      if (!session.version    && rec.version)    session.version    = rec.version;
      if (!session.entrypoint && rec.entrypoint) session.entrypoint = rec.entrypoint;
      if (!session.git_branch && rec.gitBranch)  session.git_branch = rec.gitBranch;
      if (!session.cwd        && rec.cwd)        session.cwd        = rec.cwd;

      const text = extractTextFromContent(rec.message.content);

      if (!firstUserSeen) {
        const stripped = text
          .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ').trim();
        if (stripped.length >= 8
            && !stripped.startsWith('Base directory for this skill')
            && !stripped.startsWith('Caveat:')) {
          session.first_user_message = stripped.slice(0, 200);
          firstUserSeen = true;
        }
      }

      for (const s of extractSkills(text)) {
        const bucket = BUILTIN_COMMANDS.has(s) ? 'builtin_commands' : 'skills';
        if (!session[bucket].includes(s)) session[bucket].push(s);
      }

      if (Array.isArray(rec.message.content)) {
        for (const block of rec.message.content) {
          if (block.type === 'tool_result' && block.is_error) session.tool_errors++;
        }
      }
    }

    if (rec.type === 'assistant' && rec.message) {
      session.assistant_turns++;
      if (!session.model && rec.message.model) session.model = rec.message.model;

      const u = rec.message.usage || {};
      session.tokens.input        += u.input_tokens                || 0;
      session.tokens.cache_create += u.cache_creation_input_tokens || 0;
      session.tokens.cache_read   += u.cache_read_input_tokens     || 0;
      session.tokens.output       += u.output_tokens               || 0;

      if (rec.message.stop_reason) {
        const sr = rec.message.stop_reason;
        session.stop_reasons[sr] = (session.stop_reasons[sr] || 0) + 1;
      }

      for (const block of (rec.message.content || [])) {
        const bt = block.type || 'unknown';
        session.content_blocks[bt] = (session.content_blocks[bt] || 0) + 1;

        if (bt === 'tool_use') {
          session.tool_calls++;
          const name = block.name || 'unknown';
          if (!session.tools[name]) session.tools[name] = { calls: 0, errors: 0 };
          session.tools[name].calls++;

          const FILE_OP = { Read: 'read', Write: 'write', Edit: 'edit' };
          if (FILE_OP[name] && block.input?.file_path) {
            const fp = normPath(block.input.file_path);
            if (fp) {
              if (!session.file_ops[fp]) session.file_ops[fp] = { read: 0, write: 0, edit: 0 };
              session.file_ops[fp][FILE_OP[name]]++;
            }
          }

          if (name === 'Bash' && block.input?.command) {
            const cmd = block.input.command.trimStart();
            const cat = cmd.startsWith('git ')    ? 'git'
                      : cmd.startsWith('npm ')    ? 'npm'
                      : cmd.startsWith('npx ')    ? 'npx'
                      : cmd.startsWith('node ')   ? 'node'
                      : cmd.startsWith('py ')     || cmd.startsWith('python') ? 'python'
                      : /^(ls|cat|head|tail|mkdir|rm |cp |mv )/.test(cmd)    ? 'fs'
                      : cmd.startsWith('curl ')   ? 'curl'
                      : 'other';
            session.bash_categories[cat] = (session.bash_categories[cat] || 0) + 1;
          }
        }
      }
    }
  }

  if (!session.slug) session.slug = session.session_id.slice(0, 8);
  return session;
}

// ── Project rollup ────────────────────────────────────────────────────────────

function buildProjectSummary(projectId, sessions) {
  const s = {
    id:            projectId,
    label:         deriveLabel(projectId),
    session_count: sessions.length,
    tokens:        { input: 0, cache_create: 0, cache_read: 0, output: 0 },
    tool_calls:    0,
    tool_errors:   0,
    skills:        [],
    builtin_commands: [],
    models:        {},
    git_branches:  [],
    total_bytes:   0,
    duration_ms:   0,
  };

  for (const sess of sessions) {
    s.tokens.input        += sess.tokens.input;
    s.tokens.cache_create += sess.tokens.cache_create;
    s.tokens.cache_read   += sess.tokens.cache_read;
    s.tokens.output       += sess.tokens.output;
    s.tool_calls          += sess.tool_calls;
    s.tool_errors         += sess.tool_errors;
    s.total_bytes         += sess.file_size_bytes;
    if (sess.duration_ms) s.duration_ms += sess.duration_ms;
    for (const sk of sess.skills)             if (!s.skills.includes(sk))            s.skills.push(sk);
    for (const cmd of (sess.builtin_commands||[])) if (!s.builtin_commands.includes(cmd)) s.builtin_commands.push(cmd);
    if (sess.model) s.models[sess.model] = (s.models[sess.model] || 0) + 1;
    if (sess.git_branch && !s.git_branches.includes(sess.git_branch)) s.git_branches.push(sess.git_branch);
  }

  s.git_branches.sort(); s.skills.sort(); s.builtin_commands.sort();
  return s;
}

// ── Global rollup ─────────────────────────────────────────────────────────────

function buildGlobalRollup(sessions) {
  const tools  = {}, skills = {}, models = {};
  const tokens = { input: 0, cache_create: 0, cache_read: 0, output: 0 };
  let   errors = 0;
  const fileMap = {};

  for (const sess of sessions) {
    tokens.input        += sess.tokens.input;
    tokens.cache_create += sess.tokens.cache_create;
    tokens.cache_read   += sess.tokens.cache_read;
    tokens.output       += sess.tokens.output;
    errors              += sess.tool_errors;

    for (const [name, data] of Object.entries(sess.tools)) {
      if (!tools[name]) tools[name] = { calls: 0, errors: 0 };
      tools[name].calls += data.calls;
    }
    for (const sk of sess.skills) skills[sk] = (skills[sk] || 0) + 1;
    if (sess.model) models[sess.model] = (models[sess.model] || 0) + 1;

    for (const [fp, ops] of Object.entries(sess.file_ops || {})) {
      if (!fileMap[fp]) fileMap[fp] = { path: fp, read: 0, write: 0, edit: 0, sessions: [] };
      fileMap[fp].read  += ops.read;
      fileMap[fp].write += ops.write;
      fileMap[fp].edit  += ops.edit;
      if (!fileMap[fp].sessions.includes(sess.session_id)) fileMap[fp].sessions.push(sess.session_id);
    }
  }

  return {
    tools:  Object.entries(tools).sort((a,b)=>b[1].calls-a[1].calls).map(([name,d])=>({name,...d})),
    skills: Object.entries(skills).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count})),
    models,
    tokens,
    total_errors: errors,
    files: Object.values(fileMap).sort((a,b)=>(b.write+b.edit+b.read)-(a.write+a.edit+a.read)),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    console.error(`Projects directory not found: ${PROJECTS_ROOT}`);
    console.error('Is Claude Code installed?');
    process.exit(1);
  }

  console.log('Scanning', PROJECTS_ROOT, '...');

  const allSessions = [];
  const projectDirs = fs.readdirSync(PROJECTS_ROOT)
    .filter(d => fs.statSync(path.join(PROJECTS_ROOT, d)).isDirectory())
    .sort();

  for (const projectId of projectDirs) {
    const pdir  = path.join(PROJECTS_ROOT, projectId);
    const files = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')).sort();
    console.log(`  ${projectId}: ${files.length} sessions`);
    for (const file of files) {
      try {
        allSessions.push(analyzeSession(projectId, path.join(pdir, file)));
      } catch (err) {
        console.error(`  !! ${file}: ${err.message}`);
      }
    }
  }

  allSessions.sort((a, b) => (a.first_timestamp||'') < (b.first_timestamp||'') ? -1 : 1);

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
    sess.cache_hit_rate  = inputSide > 0 ? +(t.cache_read / inputSide * 100).toFixed(1) : 0;
    sess.duration_min    = sess.duration_ms != null ? +(sess.duration_ms / 60000).toFixed(1) : null;
    sess.tool_diversity  = Object.keys(sess.tools).length;
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
      source_dir:     PROJECTS_ROOT,
      total_sessions: allSessions.length,
      total_projects: projects.length,
      date_range: {
        first: allSessions.find(s => s.first_timestamp)?.first_timestamp ?? null,
        last:  [...allSessions].reverse().find(s => s.last_timestamp)?.last_timestamp ?? null,
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

main();
