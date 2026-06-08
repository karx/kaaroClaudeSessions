// ── Injected data (substituted by build.mjs) ─────────────────────────────────
let GRAPH    = %%GRAPH_JSON%%;
let TIMELINE = %%TIMELINE_JSON%%;
const COLOR_TO_INDEX = %%COLOR_INDEX_JSON%%;
const IN_FLIGHT_COLOR = '%%IN_FLIGHT_COLOR%%';

let MAX_WEIGHT = Math.max(1, ...GRAPH.edges.map(e => e.weight || 0));

const TL_H        = 154; // total bottom chrome: timeline 60 + stats 14 + DAW 80
const TIMELINE_H  = 60;  // height of #timeline strip only
let W = window.innerWidth, H = window.innerHeight - TL_H;
const PROJ_R = 26, SR_MIN = 5, SR_MAX = 20, FR_MIN = 3, FR_MAX = 13;

function nodeR(d) {
  if (d.type === 'project') return PROJ_R;
  if (d.type === 'session') return SR_MIN + (SR_MAX - SR_MIN) * (d.sizeNorm || 0);
  return FR_MIN + (FR_MAX - FR_MIN) * (d.sizeNorm || 0);
}

const EC = { membership:'#1e3d7a', write:'#00ff88', edit:'#ffcc00', read:'#1e4a66', branch:'#334455' };
const EO = { membership:.55, write:.65, edit:.65, read:.28, branch:.4 };
const EW = { membership:1.4, write:1, edit:1, read:.7, branch:.8 };

function edgeOpacity(d) { const b=EO[d.type]||.3; if(!d.weight) return b; const wn=Math.sqrt(d.weight/MAX_WEIGHT); return Math.min(1,b*(0.5+1.5*wn)); }
function edgeWidth(d)   { const b=EW[d.type]||1; if(!d.weight) return b; const wn=Math.sqrt(d.weight/MAX_WEIGHT); return b*(0.5+2*wn); }

// ── Shared UI helpers (used by 05-interaction, 17-trace-panel, 18-thread-view) ─
const TOOL_COLORS = {
  Write:'#00bb55', Edit:'#ccaa00', Read:'#2a5c8a',
  Bash:'#cc6622', Shell:'#cc6622', PowerShell:'#cc6622',
  Grep:'#7733aa', Glob:'#7733aa', Agent:'#cc2244',
  ToolSearch:'#6644aa', WebFetch:'#336688', WebSearch:'#336688',
};

function _fmtTok(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k';
  return String(n);
}

function _esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
