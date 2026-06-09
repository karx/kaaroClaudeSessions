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
  filterVisibleGraph,
  EDGE_COLORS, GRAPH_BACKGROUND,
  FORCE_PARAMS_DEFAULTS, FORCE_PARAMS_BOUNDS, clampForceParam,
} from './lib/graph-data.mjs';

/**
 * Single-pass %%PLACEHOLDER%% substitution (autoconf / CMake configure_file pattern).
 *
 * Scans `template` exactly once; each match is replaced with `subs[match]`.
 * Unknown placeholders are left intact.  The replacement function return value
 * is used as a literal string — no $& / $1 backreference expansion, no rescan.
 *
 * @param {string} template
 * @param {Record<string, string>} subs  e.g. { '%%FOO%%': 'bar' }
 * @returns {string}
 */
export function applySubstitutions(template, subs) {
  return template.replace(/%%[A-Z_]+%%/g, k => subs[k] ?? k);
}

// ── DAW Builder (dedicated live-pulse pure audio profile builder) ────────────
function buildDaw() {
  const dawTemplatePath = path.join(CWD, 'src', 'daw-template.html');
  if (!fs.existsSync(dawTemplatePath)) {
    console.warn('DAW template missing — skipping daw-builder.html');
    return;
  }

  // Curated modules for the builder: core audio engine + live pulse bits + builder UI.
  // These run standalone (no full GRAPH dependency) when the page is the dedicated DAW view.
  const dawModules = [
    '14-pulse-audio.js',
    '19-daw-builder.js',
  ];

  const clientDir = path.join(CWD, 'src', 'client');
  let dawClientSrc = '';
  for (const m of dawModules) {
    const p = path.join(clientDir, m);
    if (fs.existsSync(p)) {
      dawClientSrc += fs.readFileSync(p, 'utf8') + '\n';
    } else {
      console.warn(`  DAW module missing: ${m}`);
    }
  }

  // No heavy data injection needed for the pure live builder (it consumes /events directly).
  // We still run applySubstitutions in case future %% placeholders appear in the modules.
  const injected = applySubstitutions(dawClientSrc, {
    // Future: could inject server-known defaults or example profile here.
  });

  const dawHtml = applySubstitutions(
    fs.readFileSync(dawTemplatePath, 'utf8'),
    { '%%DAW_CLIENT_JS%%': injected },
  );

  const dawOut = path.join(CWD, 'daw-builder.html');
  fs.writeFileSync(dawOut, dawHtml, 'utf8');
  console.log(`Written: ${dawOut}  (${(dawHtml.length / 1024).toFixed(0)} KB) — dedicated live DAW builder`);
}

function run() {
  const data        = JSON.parse(fs.readFileSync(path.join(CWD, 'sessions-data.json'), 'utf8'));
  const minSessions = parseMinSessions(process.argv);

  const { nodes, edges, timeline, stats, COLOR_TO_INDEX } =
    buildGraph(data, { minSessions });

  console.log(`Graph: ${nodes.length} nodes (${stats.project} project · ${stats.session} session · ${stats.file} file)`);
  console.log(`Edges: ${edges.length} (${stats.membership} membership · ${stats.branch} · ${stats.write} write · ${stats.edit} edit · ${stats.read} read)`);

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

  // ── Substitute %%PLACEHOLDERS%% — single-pass via applySubstitutions ─────────
  const injectedJS = applySubstitutions(clientJS, {
    '%%GRAPH_JSON%%':       JSON.stringify({ nodes, edges, meta: data.meta }),
    '%%TIMELINE_JSON%%':    JSON.stringify(timeline),
    '%%COLOR_INDEX_JSON%%': JSON.stringify(COLOR_TO_INDEX),
    '%%IN_FLIGHT_COLOR%%':  IN_FLIGHT_COLOR,
  });

  const html = applySubstitutions(
    fs.readFileSync(path.join(CWD, 'src', 'template.html'), 'utf8'),
    { '%%MIN_FILE_SESSIONS%%': String(minSessions), '%%CLIENT_JS%%': injectedJS },
  );

  const outPath = path.join(CWD, 'graph.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Written: ${outPath}  (${(html.length / 1024).toFixed(0)} KB)`);

  // Always produce the dedicated live-pulse DAW builder page as well.
  buildDaw();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
