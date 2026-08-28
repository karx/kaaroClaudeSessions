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
} from './experience/graph-data.mjs';
import { buildGraph } from './experience/graph-pipeline.mjs';
import { validateClusterOverrides } from './experience/session-clusters.mjs';
import { TOKENS, tokensToCss } from './experience/design-tokens.mjs';
import { HARNESS_REGISTRY } from './hooks/registry.mjs';
import { EVENT_TYPES } from './experience/audio/event-registry.mjs';
import { renderKindMapPage } from './experience/kind-map-widget.mjs';
import { buildKindMap } from './surface/kind-map-build.mjs';

const CWD = path.dirname(fileURLToPath(import.meta.url));

// ── Re-export pure functions so existing tests can import from build.mjs ─────
export {
  MAX_AGE_MS, IN_FLIGHT_COLOR, PALETTE, EXT_COLORS,
  calcRecencyScore, calcRecencyLevel, assignProjectColors, parseMinSessions,
  buildFileNodesAndEdges, isSessionInFlight, filterSessionsByDateRange,
  filterVisibleGraph,
  EDGE_COLORS, GRAPH_BACKGROUND,
  FORCE_PARAMS_DEFAULTS, FORCE_PARAMS_BOUNDS, clampForceParam,
} from './experience/graph-data.mjs';

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

/**
 * Strip top-level `export ` prefixes so experience/client-core.mjs (ESM for
 * Node tests) doubles as a plain script for browser bundle injection.
 * The core file's syntax contract: only `export function` / `export const`.
 */
export function stripExports(src) {
  return src.replace(/^export (function|const)/gm, '$1');
}

function loadClientCore() {
  return stripExports(fs.readFileSync(path.join(CWD, 'experience', 'client-core.mjs'), 'utf8'));
}

// Substitutions shared by every page artifact (Register A tokens).
function tokenSubs() {
  return {
    '%%TOKENS_CSS%%':   tokensToCss(),
    '%%KAARO_TOKENS%%': JSON.stringify(TOKENS),
  };
}

// ── Static pages (Mission Control, Home) through the substitution path ───────
function buildStaticPage(templateName, outName, label) {
  const templatePath = path.join(CWD, 'experience', 'pages', templateName);
  if (!fs.existsSync(templatePath)) {
    console.warn(`${templateName} missing — skipping ${outName}`);
    return;
  }
  const html = applySubstitutions(fs.readFileSync(templatePath, 'utf8'), {
    '%%CLIENT_CORE%%': loadClientCore(),
    ...tokenSubs(),
  });
  const outPath = path.join(CWD, outName);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Written: ${outPath}  (${(html.length / 1024).toFixed(0)} KB) — ${label}`);
}

function buildNow()  { buildStaticPage('now.html',  'now.html',  'Mission Control'); }
function buildHome() { buildStaticPage('home.html', 'home.html', 'Landing'); }

function buildKindMapPage() {
  const html = renderKindMapPage(buildKindMap({ eventTypes: EVENT_TYPES }), {
    tokensCss: tokensToCss(),
    live: false,
  });
  const outPath = path.join(CWD, 'kind-map.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Written: ${outPath}  (${(html.length / 1024).toFixed(0)} KB) — kind map`);
  const publicDir = path.join(CWD, 'public');
  if (fs.existsSync(publicDir)) {
    const pub = path.join(publicDir, 'kind-map.html');
    fs.writeFileSync(pub, html, 'utf8');
    console.log(`Written: ${pub}`);
  }
}

// ── DAW Builder (dedicated live-pulse pure audio profile builder) ────────────
function buildDaw() {
  const dawTemplatePath = path.join(CWD, 'experience', 'pages', 'daw-template.html');
  if (!fs.existsSync(dawTemplatePath)) {
    console.warn('DAW template missing — skipping daw-builder.html');
    return;
  }

  // Curated modules for the builder: shared core + audio engine + builder UI.
  // These run standalone (no full GRAPH dependency) when the page is the dedicated DAW view.
  const dawModules = [
    '00-core.js',
    '14-pulse-audio.js',
    '19-daw-builder.js',
  ];

  const clientDir = path.join(CWD, 'experience', 'client');
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
  const injected = applySubstitutions(dawClientSrc, {
    '%%CLIENT_CORE%%': loadClientCore(),
    ...tokenSubs(),
  });

  const dawHtml = applySubstitutions(
    fs.readFileSync(dawTemplatePath, 'utf8'),
    { '%%DAW_CLIENT_JS%%': injected, ...tokenSubs() },
  );

  const dawOut = path.join(CWD, 'daw-builder.html');
  fs.writeFileSync(dawOut, dawHtml, 'utf8');
  console.log(`Written: ${dawOut}  (${(dawHtml.length / 1024).toFixed(0)} KB) — dedicated live DAW builder`);
}

/**
 * Read + validate cluster-overrides.json. Absent → null; malformed or
 * schema-invalid → console.warn + null. The build never fails on overrides.
 */
/**
 * Order client modules for concatenation. Lexical sort IS the load order, so
 * every filename must be NN-name.js (two-digit prefix): a stray `09b-*.js` or
 * unprefixed file would silently load out of order — fail the build instead.
 */
export function orderClientModules(filenames) {
  const bad = filenames.filter(f => !/^\d\d-[\w.-]+\.js$/.test(f));
  if (bad.length) {
    throw new Error(`client modules must be named NN-name.js (two-digit prefix); invalid: ${bad.join(', ')}`);
  }
  return [...filenames].sort();
}

export function loadClusterOverrides(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { ok, errors } = validateClusterOverrides(obj);
    if (!ok) {
      console.warn(`cluster-overrides.json invalid — ignoring: ${errors.join('; ')}`);
      return null;
    }
    return obj;
  } catch (err) {
    console.warn(`cluster-overrides.json unreadable — ignoring: ${err.message}`);
    return null;
  }
}

function run() {
  const data        = JSON.parse(fs.readFileSync(path.join(CWD, 'sessions-data.json'), 'utf8'));
  const minSessions = parseMinSessions(process.argv);
  const clusterOverrides = loadClusterOverrides(path.join(CWD, 'cluster-overrides.json'));

  const { nodes, edges, timeline, stats, COLOR_TO_INDEX } =
    buildGraph(data, { minSessions, clusterOverrides });

  console.log(`Graph: ${nodes.length} nodes (${stats.project} project · ${stats.session} session · ${stats.cluster} cluster · ${stats.file} file)`);
  console.log(`Edges: ${edges.length} (${stats.membership} membership · ${stats.bundle} bundle · ${stats.branch} · ${stats.write} write · ${stats.edit} edit · ${stats.read} read)`);

  // ── graph-data.json (SSE payload) ─────────────────────────────────────────
  fs.writeFileSync(
    path.join(CWD, 'graph-data.json'),
    JSON.stringify({ nodes, edges, meta: data.meta, timeline }),
    'utf8'
  );

  // ── Concatenate client JS files in numeric order ───────────────────────────
  const clientDir = path.join(CWD, 'experience', 'client');
  const clientJS  = orderClientModules(
      fs.readdirSync(clientDir).filter(f => f.endsWith('.js'))
    )
    .map(f => fs.readFileSync(path.join(clientDir, f), 'utf8'))
    .join('\n');

  // ── Substitute %%PLACEHOLDERS%% — single-pass via applySubstitutions ─────────
  const injectedJS = applySubstitutions(clientJS, {
    '%%CLIENT_CORE%%':      loadClientCore(),
    '%%GRAPH_JSON%%':       JSON.stringify({ nodes, edges, meta: data.meta }),
    '%%TIMELINE_JSON%%':    JSON.stringify(timeline),
    '%%COLOR_INDEX_JSON%%': JSON.stringify(COLOR_TO_INDEX),
    '%%IN_FLIGHT_COLOR%%':  IN_FLIGHT_COLOR,
    '%%TRACE_HARNESSES%%':  JSON.stringify(
      HARNESS_REGISTRY.filter(h => h.capabilities.trace).map(h => h.id)),
    ...tokenSubs(),
  });

  const html = applySubstitutions(
    fs.readFileSync(path.join(CWD, 'experience', 'pages', 'template.html'), 'utf8'),
    { '%%MIN_FILE_SESSIONS%%': String(minSessions), '%%CLIENT_JS%%': injectedJS, ...tokenSubs() },
  );

  const outPath = path.join(CWD, 'graph.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Written: ${outPath}  (${(html.length / 1024).toFixed(0)} KB)`);

  // Always produce the dedicated live-pulse DAW builder + static pages.
  buildDaw();
  buildNow();
  buildHome();
  buildKindMapPage();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
