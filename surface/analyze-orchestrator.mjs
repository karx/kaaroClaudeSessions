/**
 * lib/analyze-orchestrator.mjs
 *
 * Pure merge of per-harness scan results into sessions-data.json shape.
 */

import { buildProjectSummary, buildGlobalRollup } from '../analyze.mjs';
import { enrichProject } from '../hooks/enrich-session.mjs';

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
    if (!projectMap[sess.project_id]) projectMap[sess.project_id] = [];
    projectMap[sess.project_id].push(sess);
  }

  const projects = Object.entries(projectMap)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([id, sessions]) => buildProjectSummary(id, sessions));

  for (const proj of projects) {
    const sample = projectMap[proj.id]?.[0];
    if (sample?.project_label) proj.label = sample.project_label;
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