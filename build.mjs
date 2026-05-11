#!/usr/bin/env node
/**
 * build.mjs — thin orchestrator
 *
 * Reads sessions-data.json → builds graph.html + graph-data.json.
 *
 * Pipeline:
 *   sessions-data.json
 *     → lib/graph-pipeline.mjs  (pure data transforms → nodes/edges/timeline)
 *     → src/template.html       (HTML skeleton with %%PLACEHOLDER%% markers)
 *     → src/client/01-*.js …    (browser JS concatenated in order)
 *     → graph.html              (self-contained, data inlined)
 *     → graph-data.json         (SSE incremental update payload)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  IN_FLIGHT_COLOR, parseMinSessions,
} from './lib/graph-data.mjs';
import { buildGraph } from './lib/graph-pipeline.mjs';

const CWD = path.dirname(fileURLToPath(import.meta.url));

// ── Re-export pure functions so existing tests can import from build.mjs ─────
export {
  MAX_AGE_MS, IN_FLIGHT_COLOR, PALETTE, EXT_COLORS,
  calcRecencyScore, calcRecencyLevel, assignProjectColors, parseMinSessions,
  buildFileNodesAndEdges, isSessionInFlight, filterSessionsByDateRange,
} from './lib/graph-data.mjs';

// ── Main pipeline ─────────────────────────────────────────────────────────────
function run() {
  const data        = JSON.parse(fs.readFileSync(path.join(CWD, 'sessions-data.json'), 'utf8'));
  const minSessions = parseMinSessions(process.argv);

  const { nodes, edges, timeline, stats, COLOR_TO_INDEX } =
    buildGraph(data, { minSessions });

  console.log(`Graph: ${nodes.length} nodes (${stats.project} project · ${stats.session} session · ${stats.file} file)`);
  console.log(`Edges: ${edges.length} (${stats.membership} membership · ${stats.branch} branch · ${stats.write} write · ${stats.edit} edit · ${stats.read} read)`);

  // ── graph-data.json (SSE payload) ─────────────────────────────────────────
  fs.writeFileSync(
    path.join(CWD, 'graph-data.json'),
    JSON.stringify({ nodes, edges, meta: data.meta, timeline }),
    'utf8'
  );

  // ── Concatenate client JS files in numeric order ───────────────────────────
  const clientDir = path.join(CWD, 'src', 'client');
  const clientJS  = fs.readdirSync(clientDir)
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(f => fs.readFileSync(path.join(clientDir, f), 'utf8'))
    .join('\n');

  // ── Substitute %%PLACEHOLDERS%% ───────────────────────────────────────────
  const graphJson      = JSON.stringify({ nodes, edges, meta: data.meta });
  const timelineJson   = JSON.stringify(timeline);
  const colorIndexJson = JSON.stringify(COLOR_TO_INDEX);

  const injectedJS = clientJS
    .replace('%%GRAPH_JSON%%',       graphJson)
    .replace('%%TIMELINE_JSON%%',    timelineJson)
    .replace('%%COLOR_INDEX_JSON%%', colorIndexJson)
    .replace(/%%IN_FLIGHT_COLOR%%/g, IN_FLIGHT_COLOR);

  const html = fs.readFileSync(path.join(CWD, 'src', 'template.html'), 'utf8')
    .replace(/%%MIN_FILE_SESSIONS%%/g, String(minSessions))
    .replace('%%CLIENT_JS%%', injectedJS);

  const outPath = path.join(CWD, 'graph.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Written: ${outPath}  (${(html.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
