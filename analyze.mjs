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
import { fileURLToPath } from 'url';
import { buildSessionsOutput } from './surface/analyze-orchestrator.mjs';
import { recordsToNormalized } from './hooks/adapters/claude-code.mjs';
import { reduceSession } from './hooks/session-reducer.mjs';
import { HARNESS_CAPABILITIES } from './hooks/harness-capabilities.mjs';
import { enrichSession, enrichProject } from './hooks/enrich-session.mjs';
import { loadPolicy } from './hooks/policy.mjs';
import { buildSignalsData } from './hooks/signal-evaluator.mjs';
import {
  deriveLabel, normPath, categorizeBash,
  extractTextFromContent, extractSkills, canonicalProjectId,
} from './hooks/helpers/analyze-helpers.mjs';

// ── Config ────────────────────────────────────────────────────────────────────

export const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
const OUT_FILE             = path.join(process.cwd(), 'sessions-data.json');
const SIGNALS_FILE         = path.join(process.cwd(), 'signals-data.json');

// ── JSONL I/O ─────────────────────────────────────────────────────────────────

import { parseJsonlFile } from './hooks/jsonl-io.mjs';
import { walkSessions, dirNames } from './hooks/scan-walk.mjs';

function analyzeSession(projectId, filePath) {
  const { records, sizeBytes } = parseJsonlFile(filePath);
  const sessionId = path.basename(filePath, '.jsonl');

  const session = reduceSession(recordsToNormalized(records), {
    session_id:      sessionId,
    project_id:      projectId,
    project_label:   deriveLabel(projectId),
    harness:         'claude-code',
    file_size_bytes: sizeBytes,
    capabilities:    HARNESS_CAPABILITIES['claude-code'],
  });

  session.tool_timeline = extractToolTimeline(records);
  enrichSession(session);
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

// ── Tool timeline ─────────────────────────────────────────────────────────────

const FILE_OP_TOOLS = new Set(['Read', 'Write', 'Edit']);

export function extractToolTimeline(records) {
  const timeline = [];
  let turn = 0;
  for (const rec of records) {
    if (rec.type !== 'assistant' || !rec.message?.content) continue;
    turn++;
    for (const block of rec.message.content) {
      if (block.type !== 'tool_use') continue;
      const name  = block.name || 'unknown';
      const input = block.input || {};
      let where = null;
      if (FILE_OP_TOOLS.has(name) && input.file_path) {
        where = input.file_path;
      } else if ((name === 'Bash' || name === 'PowerShell') && input.command) {
        where = String(input.command).slice(0, 120);
      } else if ((name === 'Grep' || name === 'Glob') && input.pattern) {
        where = input.pattern;
      }
      timeline.push({
        ts:   rec.timestamp || null,
        turn,
        name,
        where,
        why:  input.description || null,
      });
    }
  }
  return timeline;
}

// ── Incremental analysis ──────────────────────────────────────────────────────

export function parseSessionFlag(argv) {
  const arg = argv.find(a => a.startsWith('--session='));
  if (!arg) return null;
  const val = arg.slice('--session='.length);
  const slash = val.indexOf('/');
  if (slash === -1) {
    console.warn(`[analyze] malformed --session arg (no /): ${val}`);
    return null;
  }
  const projectId  = val.slice(0, slash);
  const rawSession = val.slice(slash + 1);
  const sessionId  = rawSession.replace(/\.jsonl$/, '');
  return { projectId, sessionId };
}

export function mergeSessionIntoData(existingData, updatedSession) {
  const projectId = canonicalProjectId(updatedSession.project_id);

  // Replace or append session
  const sessions = existingData.sessions.filter(s => s.session_id !== updatedSession.session_id);
  sessions.push(updatedSession);

  // Group by canonical id so live-tail matches buildSessionsOutput and keeps raw_ids complete.
  const projectSessions = sessions.filter(s => canonicalProjectId(s.project_id) === projectId);
  const newProjectSummary = buildProjectSummary(projectId, projectSessions);
  newProjectSummary.raw_ids   = [...new Set(projectSessions.map(s => s.project_id))].sort();
  newProjectSummary.harnesses = [...new Set(projectSessions.map(s => s.harness))].sort();
  enrichProject(newProjectSummary);

  const projects = existingData.projects
    .filter(p => p.id !== projectId)
    .concat(newProjectSummary)
    .sort((a, b) => a.id < b.id ? -1 : 1);

  // Recompute rollup
  const rollup = buildGlobalRollup(sessions);

  return {
    ...existingData,
    sessions,
    projects,
    rollup,
    meta: {
      ...existingData.meta,
      total_sessions: sessions.length,
      total_projects: projects.length,
    },
  };
}

export {
  deriveLabel, normPath, extractTextFromContent, extractSkills,
  buildProjectSummary, buildGlobalRollup, parseJsonlFile, categorizeBash,
  analyzeSession, enrichSession,
};

export function scanClaudeCodeSessions(root = PROJECTS_ROOT) {
  return walkSessions(root, 'claude-code', function* (entries) {
    for (const projectId of dirNames(entries)) {
      const pdir = path.join(root, projectId);
      for (const file of fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')).sort()) {
        yield { id: file, analyze: () => analyzeSession(projectId, path.join(pdir, file)) };
      }
    }
  });
}

function writeOutput(output) {
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  const t = output.rollup.tokens;
  const total = t.input + t.cache_create + t.cache_read + t.output;
  console.log(`\nSessions: ${output.sessions.length}  Projects: ${output.projects.length}  Tokens: ${total.toLocaleString()}`);
  console.log(`Output: ${OUT_FILE}`);
  writeSignals(output);
}

// Policy evaluation (W-POL-01..03): signals are derived, rebuilt on every run,
// and never block anything. signals-data.json is written even when empty so
// /api/signals always has a current payload.
function writeSignals(output) {
  const signals = buildSignalsData(output.sessions, loadPolicy());
  fs.writeFileSync(SIGNALS_FILE, JSON.stringify(signals, null, 2), 'utf8');
  if (signals.total_signals > 0)
    console.log(`Signals: ${signals.total_signals} (${Object.entries(signals.by_level).map(([k, v]) => `${v} ${k}`).join(' · ')})`);
}

async function main() {
  const { parseHarnessFlags, scanHarnesses } = await import('./surface/scan-harnesses.mjs');
  const harnessIds = parseHarnessFlags(process.argv);
  const multiHarness = harnessIds.length > 1 || process.argv.includes('--all-harnesses');

  const sessionFlag = !multiHarness ? parseSessionFlag(process.argv) : null;
  if (sessionFlag && harnessIds[0] === 'claude-code') {
    const { projectId, sessionId } = sessionFlag;
    const filePath = path.join(PROJECTS_ROOT, projectId, `${sessionId}.jsonl`);
    let existingData;
    try {
      existingData = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    } catch {
      console.log('No existing data — falling back to full scan');
    }
    if (existingData) {
      const updated = analyzeSession(projectId, filePath);
      const result = mergeSessionIntoData(existingData, updated);
      result.meta.generated_at = new Date().toISOString();
      writeOutput(result);
      console.log(`Incremental: updated ${projectId}/${sessionId}`);
      return;
    }
  }

  if (harnessIds.length === 1 && harnessIds[0] === 'claude-code') {
    console.log('Scanning', PROJECTS_ROOT, '...');
  }

  const results = await scanHarnesses(harnessIds);
  if (!results.length) {
    console.error('No harness data found.');
    process.exit(1);
  }

  writeOutput(buildSessionsOutput(results));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
