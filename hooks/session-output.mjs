/**
 * hooks/session-output.mjs
 *
 * Assembles the canonical sessions-data.json shape (projects + sessions +
 * rollup) from normalized per-session objects — either a full multi-harness
 * scan (buildSessionsOutput) or a single updated session merged into
 * existing data (mergeSessionIntoData, the incremental --session= path).
 * Pure data assembly, no I/O.
 *
 * This used to be split across analyze.mjs (buildProjectSummary,
 * buildGlobalRollup, mergeSessionIntoData) and surface/analyze-orchestrator.mjs
 * (buildSessionsOutput, importing the two analyze.mjs functions back) — a
 * hooks/analyzers -> surface -> root circular import, since all six
 * per-harness analyzers also depended on buildSessionsOutput. Consolidated
 * here so hooks/ stays the innermost layer with no outward dependencies.
 * analyze.mjs re-exports all four for backward-compat imports.
 */
import { enrichProject } from './enrich-session.mjs';
import { deriveLabel, canonicalProjectId } from './helpers/analyze-helpers.mjs';

// ── Project rollup ────────────────────────────────────────────────────────────

export function buildProjectSummary(projectId, sessions) {
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

export function buildGlobalRollup(sessions) {
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

// ── Full-scan merge ───────────────────────────────────────────────────────────

/**
 * Merge harness scan results into sessions-data.json shape.
 * @param {{ harness: string, source_dir: string, sessions: object[] }[]} scanResults
 */
export function buildSessionsOutput(scanResults) {
  const allSessions = [];
  for (const r of scanResults)
    allSessions.push(...r.sessions);

  allSessions.sort((a, b) =>
    (a.first_timestamp || '') < (b.first_timestamp || '') ? -1 : 1
  );

  const projectMap = {};
  for (const sess of allSessions) {
    const key = canonicalProjectId(sess.project_id);
    if (!projectMap[key]) projectMap[key] = [];
    projectMap[key].push(sess);
  }

  const projects = Object.entries(projectMap)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([id, sessions]) => buildProjectSummary(id, sessions));

  for (const proj of projects) {
    const bucket = projectMap[proj.id];
    const sample = bucket?.[0];
    if (sample?.project_label) proj.label = sample.project_label;
    proj.raw_ids   = [...new Set(bucket.map(s => s.project_id))].sort();
    proj.harnesses = [...new Set(bucket.map(s => s.harness))].sort();
    enrichProject(proj);
  }

  const rollup = buildGlobalRollup(allSessions);

  return {
    meta: {
      generated_at:   new Date().toISOString(),
      harnesses:      scanResults.map(r => r.harness),
      source_dirs:    Object.fromEntries(scanResults.map(r => [r.harness, r.source_dir])),
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
}

// ── Incremental merge ─────────────────────────────────────────────────────────

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
