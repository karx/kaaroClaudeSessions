// ── Injected data (substituted by build.mjs) ─────────────────────────────────
let GRAPH    = %%GRAPH_JSON%%;
let TIMELINE = %%TIMELINE_JSON%%;
const COLOR_TO_INDEX = %%COLOR_INDEX_JSON%%;
const IN_FLIGHT_COLOR = '%%IN_FLIGHT_COLOR%%';

let MAX_WEIGHT = Math.max(1, ...GRAPH.edges.map(e => e.weight || 0));

const TL_H        = 154; // total bottom chrome: timeline 60 + stats 14 + DAW 80
const TIMELINE_H  = 60;  // height of #timeline strip only
let W = window.innerWidth, H = window.innerHeight - TL_H;
// Formatters, colors, and geometry come from the injected shared core
// (00-core.js ← experience/client-core.mjs): fmtTok, esc, TOOL_COLORS,
// nodeRadius, hexPath, harnessWedges, harnessBreakdown, HARNESS_MARK,
// EDGE_COLORS, edgeOpacity(d, MAX_WEIGHT), edgeWidth(d, MAX_WEIGHT).
// Project glyphs scale by sizeNorm; harness count fills the hex.

// Active history-view filters — consumed via sessionMatchesFilters (core).
const SESSION_FILTERS = { harnesses: null, projects: null, from: null, to: null };

// Bundle (cluster) view state — expansion persists like kaaro-shortcuts.
let BUNDLE_ON = true;
const expandedClusters = new Set(JSON.parse(localStorage.getItem('kaaro-expanded-clusters') || '[]'));
function _saveExpanded() { localStorage.setItem('kaaro-expanded-clusters', JSON.stringify([...expandedClusters])); }

// Harnesses whose sessions can serve /api/trace (from the registry at build time).
const TRACE_HARNESSES = new Set(%%TRACE_HARNESSES%%);
