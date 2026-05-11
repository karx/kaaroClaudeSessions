#!/usr/bin/env node
/**
 * build.mjs
 *
 * Reads sessions-data.json → builds graph.html + graph-data.json.
 * Project colors are assigned dynamically from a palette — no hardcoded project IDs.
 *
 * Part of kaaro-sessions — a kaaroViewer companion tool.
 * https://github.com/kaaro/kaaroViewer
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CWD = process.cwd();

// ── Pure exports (used by tests) ─────────────────────────────────────────────

export const MAX_AGE_MS = 2 * 24 * 3600 * 1000;

export const PALETTE = [
  '#00aaff', '#ff4488', '#cc44ff', '#ff8800',
  '#00ff88', '#ffcc00', '#00cccc', '#ff6666',
  '#44ffaa', '#ff88cc', '#8844ff', '#88ccff',
];

export const EXT_COLORS = {
  mjs: '#00cccc', js: '#00aaff', ts: '#6688ff', svelte: '#ff8844',
  json: '#ffcc00', md: '#cc44ff', html: '#ff4488', css: '#33ee88',
  py: '#88cc44', txt: '#888888', sh: '#44ffaa',
};

export function calcRecencyScore(ts, referenceMs) {
  if (!ts) return 0;
  return Math.max(0, 1 - (referenceMs - new Date(ts).getTime()) / MAX_AGE_MS);
}

export function calcRecencyLevel(ts, referenceMs) {
  if (!ts) return 0;
  const age = referenceMs - new Date(ts).getTime();
  if (age <  5 * 60 * 1000)        return 3;
  if (age < 15 * 60 * 1000)        return 2;
  if (age <  2 * 24 * 3600 * 1000) return 1;
  return 0;
}

// Projects sorted alphabetically for stable colour assignment across runs.
export function assignProjectColors(projects, palette) {
  const PROJECT_COLORS = {};
  const COLOR_TO_INDEX = {};
  [...projects].sort((a, b) => a.id < b.id ? -1 : 1).forEach((p, i) => {
    PROJECT_COLORS[p.id]                  = palette[i % palette.length];
    COLOR_TO_INDEX[palette[i % palette.length]] = i;
  });
  return { PROJECT_COLORS, COLOR_TO_INDEX };
}

export function parseMinSessions(argv) {
  return parseInt(argv.find(a => a.startsWith('--min-sessions='))?.split('=')[1] ?? '1');
}

export function buildFileNodesAndEdges(globalFiles, sessById, { minSessions = 1, referenceMs = Date.now() } = {}) {
  const nodes = [];
  const edges = [];
  if (globalFiles.length === 0) return { nodes, edges };
  const MAX_FILE_W = Math.max(1, ...globalFiles.map(f => f.write + f.edit));
  const fileLastTs = {};
  for (const f of globalFiles) {
    fileLastTs[f.path] = f.sessions.map(sid => {
      const s = sessById[sid];
      return s ? (s.last_timestamp || s.first_timestamp) : null;
    }).filter(Boolean).sort().pop() || null;
  }
  for (const f of globalFiles) {
    if (f.sessions.length < minSessions) continue;
    const ext      = (f.path.split('.').pop() || '').toLowerCase().split('?')[0];
    const sizeNorm = Math.sqrt((f.write + f.edit) / MAX_FILE_W);
    const fLastTs  = fileLastTs[f.path] || null;
    nodes.push({
      id: f.path, type: 'file', label: f.path.split('/').pop(),
      full_path: f.path, color: EXT_COLORS[ext] || '#666666', ext,
      read: f.read, write: f.write, edit: f.edit,
      session_count: f.sessions.length, sizeNorm,
      last_activity: fLastTs,
      recency:       calcRecencyScore(fLastTs, referenceMs),
      recencyLevel:  calcRecencyLevel(fLastTs, referenceMs),
    });
    for (const sessId of f.sessions) {
      const sess = sessById[sessId];
      if (!sess?.file_ops?.[f.path]) continue;
      const ops = sess.file_ops[f.path];
      if (ops.write > 0) edges.push({ source: sessId, target: f.path, type: 'write', weight: ops.write });
      if (ops.edit  > 0) edges.push({ source: sessId, target: f.path, type: 'edit',  weight: ops.edit  });
      if (ops.read  > 0) edges.push({ source: sessId, target: f.path, type: 'read',  weight: ops.read  });
    }
  }
  return { nodes, edges };
}

export const IN_FLIGHT_COLOR = '#00ffcc';

export function isSessionInFlight(session, referenceMs = Date.now(), thresholdMs = 2 * 60 * 1000) {
  if (!session.last_timestamp) return false;
  const age = referenceMs - new Date(session.last_timestamp).getTime();
  return age >= 0 && age < thresholdMs;
}

export function filterSessionsByDateRange(sessions, fromTs = null, toTs = null) {
  return sessions.filter(s => {
    const ts = s.first_timestamp;
    if (!ts) return true;
    if (fromTs && ts < fromTs) return false;
    if (toTs   && ts > toTs)   return false;
    return true;
  });
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

function run() {
  const DATA = JSON.parse(fs.readFileSync(path.join(CWD, 'sessions-data.json'), 'utf8'));
  const MIN_FILE_SESSIONS = parseMinSessions(process.argv);

  const { PROJECT_COLORS, COLOR_TO_INDEX } = assignProjectColors(DATA.projects, PALETTE);

  const generatedAt  = new Date(DATA.meta.generated_at).getTime();
  const recencyScore = ts => calcRecencyScore(ts, generatedAt);
  const recencyLevel = ts => calcRecencyLevel(ts, generatedAt);

  const projLastTs = {};
  for (const s of DATA.sessions) {
    const ts = s.last_timestamp || s.first_timestamp;
    if (ts && (!projLastTs[s.project_id] || ts > projLastTs[s.project_id]))
      projLastTs[s.project_id] = ts;
  }

  const nodes = [];
  const edges = [];

  for (const proj of DATA.projects) {
    const t        = proj.tokens;
    const pLastTs  = projLastTs[proj.id] || null;
    const pRecency = recencyScore(pLastTs);
    nodes.push({
      id:            proj.id,
      type:          'project',
      label:         proj.label,
      color:         PROJECT_COLORS[proj.id] || '#888888',
      session_count: proj.session_count,
      tokens_total:  t.input + t.cache_create + t.cache_read + t.output,
      tokens_work:   t.output + t.cache_create,
      skills:        proj.skills,
      last_activity: pLastTs,
      recency:       pRecency,
      recencyLevel:  recencyLevel(pLastTs),
    });
  }

  const MAX_WORK = Math.max(1, ...DATA.sessions.map(s =>
    (s.tokens?.output || 0) + (s.tokens?.cache_create || 0)
  ));

  for (const sess of DATA.sessions) {
    const t           = sess.tokens || {};
    const tokens_work = (t.output || 0) + (t.cache_create || 0);
    nodes.push({
      id:               sess.session_id,
      type:             'session',
      label:            sess.slug || sess.session_id.slice(0, 8),
      color:            PROJECT_COLORS[sess.project_id] || '#888888',
      project_id:       sess.project_id,
      git_branch:       sess.git_branch || null,
      tokens_work,
      tokens_cached:    t.cache_read || 0,
      tokens_output:    t.output || 0,
      tokens_total:     t.total || 0,
      cache_hit_rate:   sess.cache_hit_rate,
      tool_calls:       sess.tool_calls,
      tool_errors:      sess.tool_errors,
      tool_diversity:   sess.tool_diversity,
      message_count:    sess.message_count,
      user_turns:       sess.user_turns,
      assistant_turns:  sess.assistant_turns,
      thinking_count:   (sess.content_blocks?.thinking || 0),
      hit_max_tokens:   (sess.stop_reasons?.max_tokens || 0) > 0,
      bash_git:         (sess.bash_categories?.git || 0),
      skills:           sess.skills || [],
      date_str:         sess.date_str,
      first_timestamp:  sess.first_timestamp,
      duration_min:     sess.duration_min,
      first_user_message: sess.first_user_message,
      model:            sess.model,
      sizeNorm:         Math.sqrt(tokens_work / MAX_WORK),
      errorLevel:       sess.tool_errors >= 8 ? 2 : sess.tool_errors >= 3 ? 1 : 0,
      last_activity:    sess.last_timestamp || sess.first_timestamp || null,
      recency:          recencyScore(sess.last_timestamp || sess.first_timestamp),
      recencyLevel:     recencyLevel(sess.last_timestamp || sess.first_timestamp),
      inFlight:         isSessionInFlight(sess, Date.now()),
    });
    edges.push({ source: sess.session_id, target: sess.project_id, type: 'membership' });
  }

  const branchGroups = {};
  for (const sess of DATA.sessions) {
    const b = sess.git_branch || '__unknown__';
    (branchGroups[b] = branchGroups[b] || []).push(sess);
  }
  for (const [, group] of Object.entries(branchGroups)) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.first_timestamp||'') < (b.first_timestamp||'') ? -1 : 1);
    for (let i = 0; i < sorted.length - 1; i++)
      edges.push({ source: sorted[i].session_id, target: sorted[i+1].session_id, type: 'branch', branch: sorted[i].git_branch });
  }

  const globalFiles = DATA.rollup?.files || [];
  const sessById    = {};
  DATA.sessions.forEach(s => sessById[s.session_id] = s);

  const { nodes: fileNodes, edges: fileEdges } =
    buildFileNodesAndEdges(globalFiles, sessById, { minSessions: MIN_FILE_SESSIONS, referenceMs: generatedAt });
  nodes.push(...fileNodes);
  edges.push(...fileEdges);

  const pN = nodes.filter(n => n.type === 'project').length;
  const sN = nodes.filter(n => n.type === 'session').length;
  const fN = nodes.filter(n => n.type === 'file').length;
  console.log(`Graph: ${nodes.length} nodes (${pN} project · ${sN} session · ${fN} file)`);
  console.log(`Edges: ${edges.length} (${edges.filter(e=>e.type==='membership').length} membership · ${edges.filter(e=>e.type==='branch').length} branch · ${edges.filter(e=>e.type==='write').length} write · ${edges.filter(e=>e.type==='edit').length} edit · ${edges.filter(e=>e.type==='read').length} read)`);

  const timelineSessions = DATA.sessions
    .filter(s => s.date_str)
    .sort((a, b) => (a.first_timestamp||'') < (b.first_timestamp||'') ? -1 : 1)
    .map(s => ({
      id:          s.session_id,
      date_str:    s.date_str,
      ts:          s.first_timestamp,
      color:       PROJECT_COLORS[s.project_id] || '#888',
      project:     s.project_label || s.project_id,
      slug:        s.slug || s.session_id.slice(0, 8),
      tokens_work: (s.tokens?.output || 0) + (s.tokens?.cache_create || 0),
      tool_errors: s.tool_errors,
      skills:      s.skills || [],
    }));

  const graphJson       = JSON.stringify({ nodes, edges, meta: DATA.meta });
  const timelineJson    = JSON.stringify(timelineSessions);
  const colorIndexJson  = JSON.stringify(COLOR_TO_INDEX);

  fs.writeFileSync(
    path.join(CWD, 'graph-data.json'),
    JSON.stringify({ nodes, edges, meta: DATA.meta, timeline: timelineSessions }),
    'utf8'
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Claude Code Sessions — kaaro-sessions</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #080810; color: #9aa0b8; font-family: 'Courier New',monospace; font-size: 11px; overflow: hidden; user-select: none; }
#canvas { display: block; position: fixed; top: 0; left: 0; }
#matrix-view { position: fixed; top: 0; left: 0; right: 0; bottom: 60px; overflow: auto; background: #080810; display: none; }
#three-view  { position: fixed; top: 0; left: 0; right: 0; bottom: 60px; display: none; }

/* layout switcher */
#layout-bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 3px; background: rgba(8,8,16,.92); border: 1px solid #1c1c34;
  padding: 5px 8px; z-index: 500; }
.lay-btn { background: #0e0e22; border: 1px solid #252548; color: #556688;
  padding: 4px 13px; cursor: pointer; font-family: inherit; font-size: 9px;
  letter-spacing: 1.5px; text-transform: uppercase; transition: background 0.15s; }
.lay-btn:hover  { background: #1a1a36; color: #8899cc; }
.lay-btn.active { background: #1e1e44; color: #aabbff; border-color: #4455cc; }

#tip { position: fixed; pointer-events: none; background: #0c0c1e; border: 1px solid #252540;
  padding: 10px 14px; max-width: 320px; display: none; line-height: 1.6; z-index: 300;
  box-shadow: 0 4px 24px rgba(0,0,0,.7); }
#tip strong { color: #fff; display: block; margin-bottom: 2px; font-size: 12px; }
#tip .meta  { color: #5566aa; }
#tip .body  { color: #8899bb; margin-top: 6px; font-size: 10px; line-height: 1.4; }

#legend { position: fixed; top: 48px; left: 16px; background: rgba(8,8,16,.9);
  border: 1px solid #1c1c34; padding: 12px 16px; min-width: 200px; z-index: 200; }
#legend h3 { color: #4455cc; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; }
.leg { display: flex; align-items: center; gap: 8px; margin: 5px 0; color: #667; }
.dot  { width:12px; height:12px; border-radius:50%; flex-shrink:0; }
.dia  { width:10px; height:10px; transform:rotate(45deg); flex-shrink:0; }
.ring { width:12px; height:12px; border-radius:50%; border:2px solid; background:transparent; flex-shrink:0; }
.line { width:22px; height:2px; flex-shrink:0; }
.dash { width:22px; height:1px; border-top:2px dashed; flex-shrink:0; }
.sep  { border-top: 1px solid #1c1c34; margin: 8px 0; }
.widget-toggle { float:right; cursor:pointer; color:#334; font-size:16px; line-height:1; margin-top:-1px; }
.widget-toggle:hover { color:#8899cc; }
.widget.collapsed .widget-body { display:none; }
@keyframes pulse-ring {
  0%   { transform:scale(1);   opacity:var(--po,.7); }
  100% { transform:scale(2.6); opacity:0; }
}
.pring { fill:none; stroke-width:1.5; pointer-events:none;
  animation:pulse-ring linear infinite;
  transform-box:fill-box; transform-origin:center; }
#controls { position: fixed; top: 48px; right: 16px; background: rgba(8,8,16,.9);
  border: 1px solid #1c1c34; padding: 12px 16px; min-width: 230px; z-index: 200; }
#controls h3 { color: #4455cc; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; }
.ctrl { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
.ctrl label { flex: 1; cursor: pointer; color: #778; }
input[type=checkbox] { accent-color: #4455cc; cursor: pointer; }
input[type=range]    { flex: 1; accent-color: #4455cc; cursor: pointer; }
.val { min-width: 18px; text-align: right; color: #9ab; }
button.btn { background:#12122a; border:1px solid #2a2a50; color:#8899cc;
  padding:3px 12px; cursor:pointer; font-family:inherit; font-size:11px; }
button.btn:hover { background:#1e1e40; }
#stats { position: fixed; bottom: 74px; left: 16px; color: #2a2a44; font-size: 10px; letter-spacing: 1px; pointer-events: none; }
#panel { position: fixed; top: 0; right: 0; bottom: 60px; width: 300px;
  background: rgba(8,8,16,.96); border-left: 1px solid #1c1c34;
  padding: 20px 18px; display: none; overflow-y: auto; z-index: 250; }
#panel-x { position:absolute; top:12px; right:14px; cursor:pointer; color:#334; font-size:18px; }
#panel-x:hover { color: #fff; }
#panel h3 { font-size:13px; margin-bottom:14px; word-break:break-all; }
.prow { display:flex; justify-content:space-between; gap:8px; margin:5px 0; }
.pk { color:#445566; flex-shrink:0; }
.pv { color:#c0cce0; text-align:right; word-break:break-all; }
.ptag { display:inline-block; background:#1a1a30; border:1px solid #2a2a50;
  padding:1px 6px; margin:2px 2px 0 0; font-size:10px; color:#8899cc; }
.psep { border-top:1px solid #1c1c34; margin:10px 0; }
.pmsg { margin-top:8px; color:#6677aa; font-size:10px; line-height:1.5; }
#timeline { position: fixed; bottom: 0; left: 0; right: 0; height: 60px;
  background: #06060e; border-top: 1px solid #14142a; overflow: hidden; z-index: 100; }
#tl-svg { display: block; width: 100%; height: 100%; }

/* matrix layout */
.mx-empty { color: #2a2a44; padding: 60px; text-align: center; font-size: 13px; }
.mx-legend { display: flex; gap: 16px; padding: 10px 16px; border-bottom: 1px solid #14142a;
  position: sticky; top: 0; background: #080810; z-index: 10; }
.mx-leg-item { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #556; }
.mx-leg-swatch { width: 14px; height: 14px; }
</style>
</head>
<body>
<svg id="canvas"></svg>
<div id="matrix-view"></div>
<div id="three-view"></div>

<div id="layout-bar">
  <button class="lay-btn active" data-layout="force">Force</button>
  <button class="lay-btn" data-layout="swimlane">Swimlane</button>
  <button class="lay-btn" data-layout="arc">Arc</button>
  <button class="lay-btn" data-layout="matrix">Matrix</button>
  <button class="lay-btn" data-layout="3d">3D</button>
</div>

<div id="tip"></div>
<div id="legend" class="widget">
  <h3>◆ LEGEND <span class="widget-toggle" onclick="toggleWidget('legend')">−</span></h3>
  <div class="widget-body">
  <div class="leg"><div class="dot" style="background:#08081a;border:2px solid #aaa;box-sizing:border-box"></div>Project cluster</div>
  <div class="leg"><div class="dot" style="background:#00aaff;opacity:.85"></div>Session (size = AI work)</div>
  <div class="leg"><div class="dia" style="background:#00cccc"></div>File (size = edits)</div>
  <div class="sep"></div>
  <div class="leg"><div class="line" style="background:#00ff88;opacity:.7"></div>write op</div>
  <div class="leg"><div class="line" style="background:#ffcc00;opacity:.7"></div>edit op</div>
  <div class="leg"><div class="dash" style="border-color:#1e4a66;opacity:.9;border-style:dotted"></div>read op</div>
  <div class="leg"><div class="line" style="background:#19304a;opacity:1"></div>membership</div>
  <div class="leg"><div class="dash" style="border-color:#557;opacity:.8"></div>branch lineage</div>
  <div class="sep"></div>
  <div class="leg"><div class="ring" style="border-color:#ff2244"></div>high error (≥8)</div>
  <div class="leg"><div class="ring" style="border-color:#ffcc00"></div>custom skill used</div>
  <div class="leg"><div class="dot" style="background:#fff;width:7px;height:7px;margin:2px 2px"></div>thinking blocks</div>
  <div class="leg"><span style="color:#ff4444;font-size:12px;line-height:1">✕</span>&nbsp;hit max_tokens</div>
  <div class="sep"></div>
  <div class="leg" style="color:#556;font-size:10px">edge thickness = visit frequency</div>
  </div>
</div>
<div id="controls" class="widget">
  <h3>◆ DISPLAY <span class="widget-toggle" onclick="toggleWidget('controls')">−</span></h3>
  <div class="widget-body">
  <div class="ctrl"><input type="checkbox" id="cb-files" checked><label for="cb-files">File nodes</label></div>
  <div class="ctrl"><input type="checkbox" id="cb-ro-files" checked><label for="cb-ro-files">Read-only files</label></div>
  <div class="ctrl"><input type="checkbox" id="cb-branch" checked><label for="cb-branch">Branch lineage edges</label></div>
  <div class="ctrl"><input type="checkbox" id="cb-reads"><label for="cb-reads">Read edges</label></div>
  <div class="ctrl"><input type="checkbox" id="cb-group"><label for="cb-group">Group by project (force)</label></div>
  <div class="ctrl">
    <label for="sl-min">File min sessions:</label>
    <input type="range" id="sl-min" min="1" max="12" value="${MIN_FILE_SESSIONS}">
    <span class="val" id="sl-min-val">${MIN_FILE_SESSIONS}</span>
  </div>
  <div class="sep"></div>
  <div class="ctrl"><label style="flex-shrink:0;color:#556">From:</label><input type="date" id="tf-from" style="flex:1;min-width:0;background:#0c0c1e;border:1px solid #2a2a50;color:#8899cc;padding:2px 6px;font-family:inherit;font-size:10px"><button class="btn" id="tf-clear" style="padding:3px 7px">✕</button></div>
  <div class="ctrl"><button class="btn" id="btn-shake">⟳ Shake</button>&nbsp;<button class="btn" id="btn-reset">⌂ Reset</button>&nbsp;<button class="btn" id="btn-fit">⊡ Fit</button></div>
  </div>
</div>
<div id="stats"></div>
<div id="panel"><span id="panel-x" onclick="closePanel()">✕</span><div id="panel-content"></div></div>
<div id="timeline"><svg id="tl-svg"></svg></div>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script src="https://unpkg.com/3d-force-graph@1/dist/3d-force-graph.min.js" defer></script>
<script>
// ── Shared data ───────────────────────────────────────────────────────────────
let GRAPH    = ${graphJson};
let TIMELINE = ${timelineJson};
const COLOR_TO_INDEX = ${colorIndexJson};
let MAX_WEIGHT = Math.max(1, ...GRAPH.edges.map(e => e.weight || 0));

const TL_H = 60;
let W = window.innerWidth, H = window.innerHeight - TL_H;
const PROJ_R = 26, SR_MIN = 5, SR_MAX = 20, FR_MIN = 3, FR_MAX = 13;

function nodeR(d) {
  if (d.type === 'project') return PROJ_R;
  if (d.type === 'session') return SR_MIN + (SR_MAX - SR_MIN) * (d.sizeNorm || 0);
  return FR_MIN + (FR_MAX - FR_MIN) * (d.sizeNorm || 0);
}

const EC = { membership:'#162035', write:'#00ff88', edit:'#ffcc00', read:'#1e4a66', branch:'#334455' };
const EO = { membership:.55, write:.65, edit:.65, read:.28, branch:.4 };
const EW = { membership:1.4, write:1, edit:1, read:.7, branch:.8 };

function edgeOpacity(d) { const b=EO[d.type]||.3; if(!d.weight) return b; const wn=Math.sqrt(d.weight/MAX_WEIGHT); return Math.min(1,b*(0.5+1.5*wn)); }
function edgeWidth(d)   { const b=EW[d.type]||1; if(!d.weight) return b; const wn=Math.sqrt(d.weight/MAX_WEIGHT); return b*(0.5+2*wn); }

// ── SVG canvas ────────────────────────────────────────────────────────────────
const svg  = d3.select('#canvas').attr('width', W).attr('height', H);
const root = svg.append('g');
const zoom = d3.zoom().scaleExtent([0.05, 16]).on('zoom', e => root.attr('transform', e.transform));
svg.call(zoom);
const initialTransform = d3.zoomIdentity.translate(W * 0.12, H * 0.05).scale(0.88);
svg.call(zoom.transform, initialTransform);

const decorLayer = root.append('g').attr('id', 'decor');
const edgeLayer  = root.append('g').attr('id', 'edges');
const nodeLayer  = root.append('g').attr('id', 'nodes');
const labelLayer = root.append('g').attr('id', 'labels');

// ── D3 simulation (force layout) ──────────────────────────────────────────────
const projPos = {};
function seedPositions(graphData) {
  const pnodes = graphData.nodes.filter(n => n.type === 'project');
  pnodes.forEach((p, i) => {
    if (projPos[p.id]) { p.x = projPos[p.id].x; p.y = projPos[p.id].y; }
    else { const a = (i / pnodes.length) * 2 * Math.PI - Math.PI / 2; p.x = W*.5 + 240*Math.cos(a); p.y = H*.5 + 210*Math.sin(a); }
    p.fx = p.x; p.fy = p.y; projPos[p.id] = { x: p.x, y: p.y };
  });
  const sm = {}; graphData.nodes.filter(n=>n.type==='session').forEach(s=>sm[s.id]=s);
  graphData.nodes.filter(n=>n.type==='session').forEach(s => {
    if (s.x != null) return;
    const pp = projPos[s.project_id]||{x:W/2,y:H/2};
    s.x = pp.x+(Math.random()-.5)*120; s.y = pp.y+(Math.random()-.5)*120;
  });
  graphData.nodes.filter(n=>n.type==='file').forEach(f => {
    if (f.x != null) return;
    const linked = graphData.edges.filter(e=>e.target===f.id||e.source===f.id).map(e=>sm[e.source===f.id?e.target:e.source]).filter(Boolean);
    f.x = linked.length ? linked.reduce((s,n)=>s+n.x,0)/linked.length+(Math.random()-.5)*50 : W/2+(Math.random()-.5)*300;
    f.y = linked.length ? linked.reduce((s,n)=>s+n.y,0)/linked.length+(Math.random()-.5)*50 : H/2+(Math.random()-.5)*300;
  });
}
seedPositions(GRAPH);

function makeForceLink() {
  return d3.forceLink(GRAPH.edges).id(d=>d.id)
    .distance(d=>d.type==='membership'?125:d.type==='branch'?95:d.type==='read'?80:60)
    .strength(d=>d.type==='membership'?.65:d.type==='branch'?.15:d.type==='read'?.08:.3);
}

const simulation = d3.forceSimulation(GRAPH.nodes)
  .force('link',      makeForceLink())
  .force('charge',    d3.forceManyBody().strength(d=>d.type==='project'?-700:d.type==='session'?-130:-55))
  .force('collision', d3.forceCollide(d=>nodeR(d)+4).strength(0.85))
  .alphaDecay(0.006).velocityDecay(0.38);

// ── Edge rendering (paths, so arc layout can curve them) ──────────────────────
let currentLayout = 'force';

function edgePathD(d) {
  const sx = d.source.x ?? 0, sy = d.source.y ?? 0;
  const tx = d.target.x ?? 0, ty = d.target.y ?? 0;
  if (currentLayout === 'arc') {
    if (d.type === 'branch') {
      const mx = (sx + tx) / 2;
      const span = Math.abs(tx - sx);
      const h = Math.min(span * 0.45, 140);
      return \`M\${sx},\${sy} Q\${mx},\${sy - h} \${tx},\${ty}\`;
    }
    if (d.type === 'write' || d.type === 'edit' || d.type === 'read') {
      const mx = (sx + tx) / 2;
      const span = Math.abs(tx - sx) + Math.abs(ty - sy);
      const h = Math.min(span * 0.3, 90);
      return \`M\${sx},\${sy} Q\${mx},\${sy + h} \${tx},\${ty}\`;
    }
  }
  if (currentLayout === 'swimlane' && d.type === 'branch') {
    const mx = (sx + tx) / 2;
    const h = Math.min(Math.abs(tx - sx) * 0.25, 50);
    return \`M\${sx},\${sy} Q\${mx},\${sy - h} \${tx},\${ty}\`;
  }
  return \`M\${sx},\${sy} L\${tx},\${ty}\`;
}

const edgeKey = e => \`\${e.source?.id??e.source}::\${e.type}::\${e.target?.id??e.target}\`;

function styleEdge(sel) {
  return sel
    .attr('stroke',         d => EC[d.type] || '#222')
    .attr('stroke-opacity', d => edgeOpacity(d))
    .attr('stroke-width',   d => edgeWidth(d))
    .attr('stroke-dasharray', d => d.type==='branch'?'5 3':d.type==='read'?'2 4':null)
    .attr('fill', 'none')
    .attr('class', d => 'e-' + d.type);
}

let edgeSel = edgeLayer.selectAll('path').data(GRAPH.edges, edgeKey)
  .join(enter => enter.append('path').call(styleEdge));

const nodeById = {};
GRAPH.nodes.forEach(n => nodeById[n.id] = n);

// ── Node rendering ────────────────────────────────────────────────────────────
function renderNodeContent(el, d) {
  const r = nodeR(d);
  if (d.recencyLevel > 0) {
    const spd=['','4s','2.4s','1.4s'][d.recencyLevel];
    const opa=['','0.2','0.45','0.75'][d.recencyLevel];
    const pr=d.type==='project'?PROJ_R+6:r+5;
    el.append('circle').attr('class','pring').attr('r',pr).attr('stroke',d.color)
      .style('animation-duration',spd).style('--po',opa);
    if (d.recencyLevel===3)
      el.append('circle').attr('class','pring').attr('r',pr).attr('stroke',d.color)
        .style('animation-duration',spd).style('animation-delay','-0.7s').style('--po',opa);
  }
  if (d.type === 'project') {
    el.append('circle').attr('r',PROJ_R).attr('fill','#080814').attr('stroke',d.color).attr('stroke-width',2.5);
    el.append('circle').attr('r',PROJ_R-7).attr('fill',d.color).attr('fill-opacity',.1);
  } else if (d.type === 'session') {
    if (d.inFlight) el.append('circle').attr('class','pring').attr('r',r+8).attr('stroke','${IN_FLIGHT_COLOR}').attr('stroke-width',2).attr('stroke-opacity',.9).style('animation-duration','0.8s');
    if (d.errorLevel===2) el.append('circle').attr('r',r+6).attr('fill','none').attr('stroke','#ff2244').attr('stroke-width',1.5).attr('stroke-opacity',.7);
    else if (d.errorLevel===1) el.append('circle').attr('r',r+4).attr('fill','none').attr('stroke','#ff6633').attr('stroke-width',1).attr('stroke-opacity',.5);
    if (d.skills?.length) el.append('circle').attr('r',r+4).attr('fill','none').attr('stroke','#ffcc00').attr('stroke-width',1).attr('stroke-opacity',.6).attr('stroke-dasharray','3 2');
    el.append('circle').attr('r',r).attr('fill',d.color).attr('fill-opacity',.83).attr('stroke', d.inFlight ? '${IN_FLIGHT_COLOR}' : '#000').attr('stroke-width', d.inFlight ? 1.5 : .4);
    if (d.thinking_count>0) el.append('circle').attr('r',2.5).attr('fill','#fff').attr('fill-opacity',.9);
    if (d.hit_max_tokens) el.append('text').attr('text-anchor','middle').attr('dy','.35em').attr('font-size',r*.8).attr('fill','#ff4444').attr('pointer-events','none').text('✕');
  } else {
    el.append('path').attr('d',\`M0,\${-r} L\${r},0 L0,\${r} L\${-r},0 Z\`)
      .attr('fill',d.color).attr('fill-opacity',.82).attr('stroke',d.color).attr('stroke-width',.5).attr('stroke-opacity',.4);
  }
}

function joinNodes(graphData) {
  return nodeLayer.selectAll('g.node').data(graphData.nodes, d=>d.id).join(
    enter => { const g = enter.append('g').attr('class',d=>'node node-'+d.type).style('cursor','pointer'); g.each(function(d){renderNodeContent(d3.select(this),d);}); return g; },
    update => update,
    exit   => exit.remove()
  );
}
let nodeSel = joinNodes(GRAPH);

let projLabelSel = labelLayer.selectAll('text.pl').data(GRAPH.nodes.filter(n=>n.type==='project'), d=>d.id)
  .join('text').attr('class','pl').attr('text-anchor','middle').attr('fill',d=>d.color)
  .attr('font-size',9).attr('letter-spacing',1).attr('pointer-events','none').text(d=>d.label.toUpperCase());

// ── Simulation tick ───────────────────────────────────────────────────────────
simulation.on('tick', () => {
  edgeSel.attr('d', edgePathD);
  nodeSel.attr('transform', d=>\`translate(\${d.x},\${d.y})\`);
  projLabelSel.attr('x',d=>d.x).attr('y',d=>d.y+PROJ_R+13);
});

// ── Drag ──────────────────────────────────────────────────────────────────────
const drag = d3.drag()
  .on('start',(ev,d)=>{ if(!ev.active && currentLayout==='force') simulation.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
  .on('drag', (ev,d)=>{ d.fx=ev.x; d.fy=ev.y; })
  .on('end',  (ev,d)=>{ if(!ev.active && currentLayout==='force') simulation.alphaTarget(0); if(d.type!=='project'&&currentLayout==='force'){d.fx=null;d.fy=null;} });

// ── Tooltip ───────────────────────────────────────────────────────────────────
const tip = document.getElementById('tip');
const fmtT = n => n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'K':n;

function attachTooltip(sel) {
  sel.on('mouseover',(ev,d)=>{
    tip.style.display='block';
    if (d.type==='project') {
      tip.innerHTML=\`<strong style="color:\${d.color}">\${d.label}</strong>
        <div class="meta">\${d.session_count} sessions</div>
        <div class="meta">AI work: \${fmtT(d.tokens_work)}</div>
        \${d.skills.length?'<div class="meta">Skills: /'+d.skills.join(' /')+'</div>':''}\`;
    } else if (d.type==='session') {
      tip.innerHTML=\`<strong style="color:\${d.color}">\${d.label}</strong>
        <div class="meta">\${d.date_str||'?'} · \${d.duration_min!=null?d.duration_min+'min':'?'} · \${d.model||'?'}</div>
        \${d.recencyLevel>0?'<div class="meta" style="color:'+(['','#446','#88a','#adf'][d.recencyLevel])+'">● '+(['','< 2 days','< 15 min','< 5 min'][d.recencyLevel])+'</div>':''}
        <div class="meta">branch: \${d.git_branch||'?'}</div>
        <div class="meta">AI work: \${fmtT(d.tokens_work)} · cache: \${fmtT(d.tokens_cached)} (\${d.cache_hit_rate}%)</div>
        <div class="meta">\${d.tool_calls} calls · \${d.tool_errors} errors · \${d.tool_diversity} tool types</div>
        \${d.thinking_count?'<div class="meta">thinking: '+d.thinking_count+'</div>':''}
        \${d.hit_max_tokens?'<div class="meta" style="color:#ff4444">⚠ hit max_tokens</div>':''}
        \${d.inFlight?'<div class="meta" style="color:${IN_FLIGHT_COLOR}">⬤ in flight</div>':''}
        \${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}
        \${d.first_user_message?'<div class="body">'+d.first_user_message.slice(0,130)+'</div>':''}\`;
    } else {
      tip.innerHTML=\`<strong style="color:\${d.color}">\${d.label}</strong>
        <div class="meta">\${d.session_count} sessions · \${d.edit} edits · \${d.write} writes · \${d.read} reads</div>
        <div class="meta" style="word-break:break-all;font-size:10px">\${d.full_path}</div>\`;
    }
  }).on('mousemove',ev=>{
    const tx=ev.clientX+16,ow=tip.offsetWidth;
    tip.style.left=(tx+ow>W-10?ev.clientX-ow-16:tx)+'px';
    tip.style.top=Math.min(ev.clientY-8,H-tip.offsetHeight-10)+'px';
  }).on('mouseout',()=>tip.style.display='none');
}
attachTooltip(nodeSel);

// ── Highlight & click ─────────────────────────────────────────────────────────
let selectedId = null;
function neighbours(id) {
  const s=new Set([id]);
  GRAPH.edges.forEach(e=>{ const a=e.source?.id??e.source,b=e.target?.id??e.target; if(a===id)s.add(b);if(b===id)s.add(a); });
  return s;
}
function highlight(id) {
  if (!id) { nodeSel.attr('opacity',1); edgeSel.call(styleEdge); d3.selectAll('.tl-dot').attr('opacity',1); return; }
  const nb=neighbours(id);
  nodeSel.attr('opacity',d=>nb.has(d.id)?1:.05);
  edgeSel.attr('stroke-opacity',e=>{ const a=e.source?.id??e.source,b=e.target?.id??e.target; return (a===id||b===id)?Math.min(1,edgeOpacity(e)*2):.025; });
  d3.selectAll('.tl-dot').attr('opacity',d=>d.id===id?1:.2);
}

function attachClick(sel) {
  sel.on('click',(ev,d)=>{ ev.stopPropagation(); if(selectedId===d.id){selectedId=null;highlight(null);closePanel();}else{selectedId=d.id;highlight(d.id);showPanel(d);} });
}
attachClick(nodeSel);
svg.on('click',()=>{ selectedId=null;highlight(null);closePanel(); });

// ── Detail panel ──────────────────────────────────────────────────────────────
function showPanel(d) {
  document.getElementById('panel').style.display='block';
  const nb=neighbours(d.id); let html='';
  if (d.type==='project') {
    const ss=[...nb].filter(id=>id!==d.id).map(id=>nodeById[id]).filter(n=>n?.type==='session');
    html=\`<h3 style="color:\${d.color}">\${d.label}</h3>
      <div class="prow"><span class="pk">Sessions</span><span class="pv">\${d.session_count}</span></div>
      <div class="prow"><span class="pk">AI work</span><span class="pv">\${fmtT(d.tokens_work)}</span></div>
      <div class="prow"><span class="pk">Skills</span><span class="pv">\${d.skills.map(s=>'<span class="ptag">/'+s+'</span>').join('')||'none'}</span></div>
      <div class="psep"></div>
      \${ss.map(s=>\`<div class="prow" style="font-size:10px"><span class="pk">\${s.date_str||'?'}</span><span class="pv" style="color:\${d.color}">\${s.label}</span></div>\`).join('')}\`;
  } else if (d.type==='session') {
    const files=[...nb].filter(id=>id!==d.id&&nodeById[id]?.type==='file').map(id=>nodeById[id]);
    const peers=[...nb].filter(id=>id!==d.id&&nodeById[id]?.type==='session').map(id=>nodeById[id]);
    html=\`<h3 style="color:\${d.color}">\${d.label}</h3>
      <div class="prow"><span class="pk">Date</span><span class="pv">\${d.date_str||'?'}</span></div>
      <div class="prow"><span class="pk">Duration</span><span class="pv">\${d.duration_min!=null?d.duration_min+' min':'?'}</span></div>
      \${d.last_activity?'<div class="prow"><span class="pk">Last active</span><span class="pv">'+d.last_activity.slice(0,16).replace('T',' ')+'</span></div>':''}
      <div class="prow"><span class="pk">Model</span><span class="pv">\${d.model||'?'}</span></div>
      <div class="prow"><span class="pk">Branch</span><span class="pv">\${d.git_branch||'?'}</span></div>
      <div class="psep"></div>
      <div class="prow"><span class="pk">AI work</span><span class="pv">\${fmtT(d.tokens_work)}</span></div>
      <div class="prow"><span class="pk">Cache read</span><span class="pv">\${fmtT(d.tokens_cached)} (\${d.cache_hit_rate}%)</span></div>
      <div class="prow"><span class="pk">Output</span><span class="pv">\${fmtT(d.tokens_output)}</span></div>
      <div class="psep"></div>
      <div class="prow"><span class="pk">Tool calls</span><span class="pv">\${d.tool_calls}</span></div>
      <div class="prow"><span class="pk">Errors</span><span class="pv" style="color:\${d.errorLevel>0?'#ff6633':'inherit'}">\${d.tool_errors}</span></div>
      <div class="prow"><span class="pk">Tool types</span><span class="pv">\${d.tool_diversity}</span></div>
      <div class="prow"><span class="pk">Thinking blocks</span><span class="pv">\${d.thinking_count}</span></div>
      <div class="prow"><span class="pk">Git commands</span><span class="pv">\${d.bash_git}</span></div>
      \${d.hit_max_tokens?'<div class="prow"><span class="pk" style="color:#ff4444">Max tokens hit</span><span class="pv">✕</span></div>':''}
      \${d.skills.length?'<div class="prow"><span class="pk">Skills</span><span class="pv">'+d.skills.map(s=>'<span class="ptag">/'+s+'</span>').join('')+'</span></div>':''}
      \${d.first_user_message?'<div class="pmsg">'+d.first_user_message.slice(0,250)+'</div>':''}
      \${peers.length?'<div class="psep"></div><div style="color:#445566;margin-bottom:4px;font-size:10px">Branch peers:</div>'+peers.map(p=>\`<div class="prow" style="font-size:10px"><span class="pk">\${p.date_str||'?'}</span><span class="pv">\${p.label}</span></div>\`).join(''):''}
      \${files.length?'<div class="psep"></div><div style="color:#445566;margin-bottom:4px;font-size:10px">Files ('+files.length+'):</div>'+files.map(f=>\`<div class="prow" style="font-size:10px"><span class="pk" style="color:\${f.color}">\${f.label}</span><span class="pv">\${f.edit}e \${f.write}w</span></div>\`).join(''):''}
      \`;
  } else {
    const ss=[...nb].filter(id=>id!==d.id&&nodeById[id]?.type==='session').map(id=>nodeById[id]);
    html=\`<h3 style="color:\${d.color}">\${d.label}</h3>
      <div class="prow"><span class="pk">Extension</span><span class="pv">.\${d.ext}</span></div>
      <div class="prow"><span class="pk">Sessions</span><span class="pv">\${d.session_count}</span></div>
      <div class="prow"><span class="pk">Edits</span><span class="pv">\${d.edit}</span></div>
      <div class="prow"><span class="pk">Writes</span><span class="pv">\${d.write}</span></div>
      <div class="prow"><span class="pk">Reads</span><span class="pv">\${d.read}</span></div>
      <div class="pmsg" style="word-break:break-all">\${d.full_path}</div>
      \${ss.length?'<div class="psep"></div>'+ss.map(s=>\`<div class="prow" style="font-size:10px"><span class="pk" style="color:\${s.color}">\${s.date_str||'?'}</span><span class="pv">\${s.label}</span></div>\`).join(''):''}
      \`;
  }
  document.getElementById('panel-content').innerHTML = html;
}
function closePanel() { document.getElementById('panel').style.display='none'; }
window.closePanel = closePanel;

// ── Layout: force ─────────────────────────────────────────────────────────────
function restoreForceLayout() {
  GRAPH.nodes.forEach(n => { if (n.type !== 'project') { n.fx = null; n.fy = null; } });
  GRAPH.nodes.filter(n => n.type === 'project').forEach(p => {
    const pos = projPos[p.id];
    if (pos) { p.fx = pos.x; p.fy = pos.y; }
  });
  simulation
    .force('link',      makeForceLink())
    .force('charge',    d3.forceManyBody().strength(d=>d.type==='project'?-700:d.type==='session'?-130:-55))
    .force('collision', d3.forceCollide(d=>nodeR(d)+4).strength(0.85));
  const grouped = document.getElementById('cb-group').checked;
  if (grouped) {
    simulation
      .force('gx', d3.forceX(d => { const p = projPos[d.project_id]; return p?.x ?? W/2; }).strength(d => d.type==='project'?0:0.06))
      .force('gy', d3.forceY(d => { const p = projPos[d.project_id]; return p?.y ?? H/2; }).strength(d => d.type==='project'?0:0.06));
  } else {
    simulation.force('gx', null).force('gy', null);
  }
}

// ── Layout: swimlane ──────────────────────────────────────────────────────────
let swimXScale = null;

function computeSwimlanePositions() {
  const projects = GRAPH.nodes.filter(n => n.type === 'project');
  const sessions = GRAPH.nodes.filter(n => n.type === 'session');
  const files    = GRAPH.nodes.filter(n => n.type === 'file');

  const ML = 150, MT = 55;
  const laneH = Math.min(110, Math.max(55, (H - MT - 80) / Math.max(1, projects.length)));

  const tsSess = sessions.filter(s => s.first_timestamp);
  const tMin = tsSess.length ? new Date(d3.min(tsSess, s=>s.first_timestamp)) : new Date(Date.now()-7*864e5);
  const tMax = tsSess.length ? new Date(d3.max(tsSess, s=>s.first_timestamp)) : new Date();
  swimXScale = d3.scaleTime().domain([tMin, tMax]).range([ML, W - 50]).nice();

  const laneY = {};
  projects.forEach((p, i) => {
    const cy = MT + laneH * i + laneH / 2;
    laneY[p.id] = cy;
    p.x = 60; p.y = cy; p.fx = p.x; p.fy = p.y;
  });

  // Within each lane: bucket sessions by X pixel, distribute vertically within lane
  const projSessions = {};
  sessions.forEach(s => (projSessions[s.project_id] = projSessions[s.project_id] || []).push(s));
  for (const [pid, ss] of Object.entries(projSessions)) {
    const cy = laneY[pid] ?? H / 2;
    const byBucket = {};
    ss.forEach(s => {
      const x = s.first_timestamp ? swimXScale(new Date(s.first_timestamp)) : W / 2;
      s.x = x; s.fx = x;
      const bk = Math.round(x / 10);
      (byBucket[bk] = byBucket[bk] || []).push(s);
    });
    const inner = laneH * 0.5;
    for (const bucket of Object.values(byBucket)) {
      const n = bucket.length;
      bucket.forEach((s, i) => {
        const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * inner;
        s.y = cy + off; s.fy = s.y;
      });
    }
  }

  // Files: below all lanes, X = avg connected session X
  const fileY = MT + laneH * projects.length + 40;
  files.forEach(f => {
    const xs = GRAPH.edges
      .filter(e => { const t=e.target?.id??e.target; return t===f.id; })
      .map(e => nodeById[e.source?.id??e.source])
      .filter(n=>n?.type==='session'&&n.x!=null)
      .map(n=>n.x);
    f.x = xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : W/2;
    f.y = fileY; f.fx = f.x; f.fy = f.y;
  });
}

function drawSwimlaneDecor() {
  decorLayer.selectAll('*').remove();
  const projects = GRAPH.nodes.filter(n => n.type === 'project');
  const ML = 150, MT = 55;
  const laneH = Math.min(110, Math.max(55, (H - MT - 80) / Math.max(1, projects.length)));

  // Lane separator lines
  projects.forEach((p, i) => {
    const y = MT + laneH * i;
    decorLayer.append('line').attr('x1',0).attr('x2',W).attr('y1',y).attr('y2',y)
      .attr('stroke','#12122a').attr('stroke-width',1);
  });
  const yLast = MT + laneH * projects.length;
  decorLayer.append('line').attr('x1',0).attr('x2',W).attr('y1',yLast).attr('y2',yLast)
    .attr('stroke','#12122a').attr('stroke-width',1);

  // Time axis ticks at top
  if (swimXScale) {
    const ticks = swimXScale.ticks(8);
    ticks.forEach(t => {
      const x = swimXScale(t);
      decorLayer.append('line').attr('x1',x).attr('x2',x).attr('y1',MT-2).attr('y2',yLast+2)
        .attr('stroke','#16162e').attr('stroke-width',1);
      decorLayer.append('text').attr('x',x).attr('y',MT-6).attr('text-anchor','middle')
        .attr('font-size',8).attr('fill','#2a2a44').attr('font-family','Courier New,monospace')
        .text(d3.timeFormat('%m/%d')(t));
    });
  }

  // Files lane label
  const fileY = MT + laneH * projects.length + 40;
  decorLayer.append('text').attr('x',ML-6).attr('y',fileY+4).attr('text-anchor','end')
    .attr('font-size',8).attr('fill','#2a2a44').attr('font-family','Courier New,monospace').attr('letter-spacing',1)
    .text('FILES');
}

// ── Layout: arc ───────────────────────────────────────────────────────────────
let arcXScale = null;

function computeArcPositions() {
  const sessions = GRAPH.nodes.filter(n => n.type === 'session');
  const projects = GRAPH.nodes.filter(n => n.type === 'project');
  const files    = GRAPH.nodes.filter(n => n.type === 'file');

  const axisY = H * 0.52;
  const tsSess = sessions.filter(s => s.first_timestamp);
  const tMin = tsSess.length ? new Date(d3.min(tsSess, s=>s.first_timestamp)) : new Date(Date.now()-7*864e5);
  const tMax = tsSess.length ? new Date(d3.max(tsSess, s=>s.first_timestamp)) : new Date();
  arcXScale = d3.scaleTime().domain([tMin, tMax]).range([60, W - 60]).nice();

  sessions.forEach(s => {
    s.x = s.first_timestamp ? arcXScale(new Date(s.first_timestamp)) : W / 2;
    s.y = axisY; s.fx = s.x; s.fy = s.y;
  });

  // Projects: above axis at centroid of their sessions
  const projXs = {};
  sessions.forEach(s => (projXs[s.project_id] = projXs[s.project_id] || []).push(s.x));
  projects.forEach(p => {
    const xs = projXs[p.id] || [W/2];
    p.x = xs.reduce((a,b)=>a+b,0)/xs.length; p.y = axisY - 130;
    p.fx = p.x; p.fy = p.y;
  });

  // Files: below axis at centroid of connected sessions
  const fileY = axisY + 100;
  files.forEach(f => {
    const xs = GRAPH.edges
      .filter(e => (e.target?.id??e.target)===f.id)
      .map(e => nodeById[e.source?.id??e.source])
      .filter(n=>n?.type==='session'&&n.x!=null)
      .map(n=>n.x);
    f.x = xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : W/2;
    f.y = fileY; f.fx = f.x; f.fy = f.y;
  });
}

function drawArcDecor() {
  decorLayer.selectAll('*').remove();
  if (!arcXScale) return;
  const axisY = H * 0.52;

  // Main horizontal axis baseline
  decorLayer.append('line').attr('x1',50).attr('x2',W-50).attr('y1',axisY).attr('y2',axisY)
    .attr('stroke','#1a1a30').attr('stroke-width',1.5);

  // Date ticks
  arcXScale.ticks(10).forEach(t => {
    const x = arcXScale(t);
    decorLayer.append('line').attr('x1',x).attr('x2',x).attr('y1',axisY-4).attr('y2',axisY+4)
      .attr('stroke','#2a2a44').attr('stroke-width',1);
    decorLayer.append('text').attr('x',x).attr('y',axisY+16).attr('text-anchor','middle')
      .attr('font-size',8).attr('fill','#2a2a44').attr('font-family','Courier New,monospace')
      .text(d3.timeFormat('%m/%d')(t));
  });
}

// ── Apply static node positions ───────────────────────────────────────────────
function applyStaticPositions() {
  GRAPH.nodes.forEach(n => { if (n.fx != null) n.x = n.fx; if (n.fy != null) n.y = n.fy; });
  nodeSel.attr('transform', d=>\`translate(\${d.x??0},\${d.y??0})\`);
  edgeSel.attr('d', edgePathD);
  projLabelSel.attr('x', d=>d.x??0).attr('y', d=>(d.y??0)+PROJ_R+13);
}

// ── Layout: matrix ────────────────────────────────────────────────────────────
let tlFrom = null;

function renderMatrix() {
  const mv = document.getElementById('matrix-view');
  mv.innerHTML = '';

  const minSess = +document.getElementById('sl-min').value;
  const showRo  = document.getElementById('cb-ro-files').checked;
  let files = GRAPH.nodes.filter(n => n.type === 'file' && n.session_count >= minSess);
  if (!showRo) files = files.filter(f => f.write > 0 || f.edit > 0);
  let sessions = GRAPH.nodes.filter(n => n.type === 'session')
    .filter(n => !tlFrom || !n.date_str || n.date_str >= tlFrom)
    .sort((a,b) => (a.first_timestamp||'') < (b.first_timestamp||'') ? -1 : 1);

  if (!files.length || !sessions.length) {
    mv.innerHTML = '<div class="mx-empty">No data — adjust filters</div>';
    return;
  }
  files.sort((a,b) => (b.write + b.edit) - (a.write + a.edit));

  // Build op lookup: opMap[sessId][fileId] = {read,write,edit}
  const opMap = {};
  GRAPH.edges.forEach(e => {
    if (!['write','edit','read'].includes(e.type)) return;
    const sId = e.source?.id??e.source, fId = e.target?.id??e.target;
    if (!opMap[sId]) opMap[sId] = {};
    if (!opMap[sId][fId]) opMap[sId][fId] = {read:0,write:0,edit:0};
    opMap[sId][fId][e.type] = (opMap[sId][fId][e.type]||0) + (e.weight||1);
  });

  const LABEL_W = 180, HEADER_H = 84, CELL_H = 18;
  const CELL_W = Math.max(10, Math.min(36, (W - LABEL_W - 20) / sessions.length));
  const svgW = LABEL_W + sessions.length * CELL_W + 4;
  const svgH = HEADER_H + files.length * CELL_H + 20;

  // Sticky legend bar
  const bar = document.createElement('div');
  bar.className = 'mx-legend';
  bar.innerHTML = \`
    <span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#ffcc00" fill-opacity=".75"/></svg>edit</span>
    <span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#00ff88" fill-opacity=".75"/></svg>write</span>
    <span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#1e4a66" fill-opacity=".8"/></svg>read only</span>
    <span style="margin-left:auto;color:#2a2a44;font-size:10px">\${files.length} files × \${sessions.length} sessions</span>
  \`;
  mv.appendChild(bar);

  const msvg = d3.select(mv).append('svg')
    .attr('width', svgW).attr('height', svgH).style('display','block');

  // Session column headers (rotated)
  const hg = msvg.append('g').attr('transform',\`translate(\${LABEL_W},0)\`);
  sessions.forEach((s, si) => {
    const x = si * CELL_W + CELL_W / 2;
    hg.append('text').attr('x',x).attr('y',HEADER_H-4)
      .attr('transform',\`rotate(-45,\${x},\${HEADER_H-4})\`)
      .attr('text-anchor','end').attr('font-size',8).attr('fill',s.color)
      .attr('font-family','Courier New,monospace')
      .text(s.date_str||s.label);
  });

  // File rows
  const rg = msvg.append('g').attr('transform',\`translate(0,\${HEADER_H})\`);
  files.forEach((f, fi) => {
    const gy = fi * CELL_H;
    if (fi % 2 === 0)
      rg.append('rect').attr('x',0).attr('y',gy).attr('width',svgW).attr('height',CELL_H).attr('fill','#0a0a18');

    rg.append('text').attr('x',LABEL_W-6).attr('y',gy+CELL_H/2+3)
      .attr('text-anchor','end').attr('font-size',9).attr('fill',f.color)
      .attr('font-family','Courier New,monospace').text(f.label)
      .append('title').text(f.full_path);

    sessions.forEach((s, si) => {
      const ops = opMap[s.id]?.[f.id];
      let fill = 'transparent', opacity = 1;
      if (ops) {
        if (ops.edit  > 0) { fill = '#ffcc00'; opacity = 0.75; }
        else if (ops.write > 0) { fill = '#00ff88'; opacity = 0.75; }
        else if (ops.read  > 0) { fill = '#1e4a66'; opacity = 0.8; }
      }
      const cell = rg.append('rect')
        .attr('x', LABEL_W + si * CELL_W).attr('y', gy + 1)
        .attr('width', CELL_W - 1).attr('height', CELL_H - 2)
        .attr('fill', fill).attr('fill-opacity', opacity)
        .style('cursor', ops ? 'pointer' : 'default');

      if (ops) {
        const opsStr = [ops.write?\`\${ops.write}w\`:'', ops.edit?\`\${ops.edit}e\`:'', ops.read?\`\${ops.read}r\`:''].filter(Boolean).join(' ');
        cell
          .on('mouseover', ev => {
            tip.style.display='block';
            tip.innerHTML=\`<strong style="color:\${s.color}">\${s.label}</strong><div class="meta">\${f.label}</div><div class="meta">\${opsStr}</div>\`;
            tip.style.left=(ev.clientX+12)+'px'; tip.style.top=(ev.clientY-20)+'px';
          })
          .on('mousemove', ev => { tip.style.left=(ev.clientX+12)+'px'; tip.style.top=(ev.clientY-20)+'px'; })
          .on('mouseout', () => tip.style.display='none')
          .on('click', ev => { ev.stopPropagation(); selectedId=s.id; showPanel(s); highlight(s.id); });
      }
    });
  });
}

// ── Layout: 3D ────────────────────────────────────────────────────────────────
const layout3D = {
  _g: null,
  enter() {
    document.getElementById('canvas').style.display='none';
    document.getElementById('matrix-view').style.display='none';
    document.getElementById('three-view').style.display='block';
    simulation.stop();
    if (typeof ForceGraph3D === 'undefined') {
      document.getElementById('three-view').innerHTML=
        '<div style="color:#445;padding:60px;text-align:center;font-family:monospace;font-size:13px">Loading 3D library…<br>Try switching back and forth once loaded.</div>';
      return;
    }
    const nodes3d = GRAPH.nodes.map(n=>({...n}));
    const links3d = GRAPH.edges.map(e=>({
      source: e.source?.id??e.source, target: e.target?.id??e.target,
      type: e.type, weight: e.weight
    }));
    // Filter per current checkboxes
    const showBranch = document.getElementById('cb-branch').checked;
    const showReads  = document.getElementById('cb-reads').checked;
    const showFiles  = document.getElementById('cb-files').checked;
    const minSess    = +document.getElementById('sl-min').value;
    const hiddenIds  = new Set(GRAPH.nodes.filter(n =>
      (n.type==='file' && (!showFiles || n.session_count < minSess)) ||
      (n.type==='session' && tlFrom && n.date_str && n.date_str < tlFrom)
    ).map(n=>n.id));
    const links3dF = links3d.filter(e => {
      if (hiddenIds.has(e.source)||hiddenIds.has(e.target)) return false;
      if (e.type==='branch' && !showBranch) return false;
      if (e.type==='read'   && !showReads)  return false;
      return true;
    });
    const nodes3dF = nodes3d.filter(n=>!hiddenIds.has(n.id));

    this._g = ForceGraph3D({ controlType:'orbit' })(document.getElementById('three-view'))
      .width(W).height(H)
      .backgroundColor('#080810')
      .graphData({ nodes: nodes3dF, links: links3dF })
      .nodeId('id').nodeLabel('label')
      .nodeColor(d=>d.color)
      .nodeVal(d=>nodeR(d)*1.8)
      .nodeOpacity(0.85)
      .linkColor(e=>EC[e.type]||'#444')
      .linkOpacity(0.4)
      .linkWidth(e=>edgeWidth(e))
      .onNodeClick((node,ev)=>{
        ev.stopPropagation();
        selectedId=node.id;
        const orig=nodeById[node.id]; if(orig) showPanel(orig);
      })
      .onBackgroundClick(()=>{ selectedId=null; closePanel(); });
  },
  exit() {
    document.getElementById('three-view').style.display='none';
    document.getElementById('canvas').style.display='block';
    if (this._g) { document.getElementById('three-view').innerHTML=''; this._g=null; }
  }
};

// ── Layout manager ────────────────────────────────────────────────────────────
const LAYOUT_HANDLERS = {
  force: {
    enter() {
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      decorLayer.selectAll('*').remove();
      restoreForceLayout();
      simulation.alpha(0.25).restart();
      nodeSel.call(drag);
    },
    exit() {}
  },
  swimlane: {
    enter() {
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      simulation.stop();
      computeSwimlanePositions();
      drawSwimlaneDecor();
      applyStaticPositions();
      nodeSel.on('.drag', null); // disable drag in static layouts
    },
    exit() { decorLayer.selectAll('*').remove(); }
  },
  arc: {
    enter() {
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      simulation.stop();
      computeArcPositions();
      drawArcDecor();
      applyStaticPositions();
      nodeSel.on('.drag', null);
    },
    exit() { decorLayer.selectAll('*').remove(); }
  },
  matrix: {
    enter() {
      document.getElementById('canvas').style.display='none';
      document.getElementById('matrix-view').style.display='block';
      document.getElementById('three-view').style.display='none';
      simulation.stop();
      renderMatrix();
    },
    exit() {}
  },
  '3d': layout3D
};

function setLayout(name) {
  if (name === currentLayout) return;
  LAYOUT_HANDLERS[currentLayout]?.exit?.();
  currentLayout = name;
  document.querySelectorAll('[data-layout]').forEach(b=>b.classList.toggle('active', b.dataset.layout===name));
  LAYOUT_HANDLERS[currentLayout]?.enter?.();
  applyFilters();
}

document.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>setLayout(b.dataset.layout)));

// ── Filters ───────────────────────────────────────────────────────────────────
function applyFilters() {
  if (currentLayout === 'matrix') { renderMatrix(); return; }
  if (currentLayout === '3d')     { layout3D.exit(); layout3D.enter(); return; }

  const showFiles   = document.getElementById('cb-files').checked;
  const showRoFiles = document.getElementById('cb-ro-files').checked;
  const showBranch  = document.getElementById('cb-branch').checked;
  const showReads   = document.getElementById('cb-reads').checked;
  const minSess     = +document.getElementById('sl-min').value;

  const hiddenNodes = new Set();
  nodeSel.attr('display', d => {
    if (d.type === 'session') {
      if (tlFrom && d.date_str && d.date_str < tlFrom) { hiddenNodes.add(d.id); return 'none'; }
      return null;
    }
    if (d.type === 'file') {
      if (!showFiles)                                    { hiddenNodes.add(d.id); return 'none'; }
      if (d.session_count < minSess)                     { hiddenNodes.add(d.id); return 'none'; }
      if (!showRoFiles && d.write === 0 && d.edit === 0) { hiddenNodes.add(d.id); return 'none'; }
      return null;
    }
    return null;
  });
  edgeSel.attr('display', e => {
    const src = e.source?.id??e.source, tgt = e.target?.id??e.target;
    if (hiddenNodes.has(src) || hiddenNodes.has(tgt)) return 'none';
    if (e.type === 'read'   && !showReads)  return 'none';
    if (e.type === 'branch' && !showBranch) return 'none';
    return null;
  });
  projLabelSel.attr('display', null);
}

document.getElementById('cb-files').addEventListener('change',    applyFilters);
document.getElementById('cb-ro-files').addEventListener('change', applyFilters);
document.getElementById('cb-branch').addEventListener('change',   applyFilters);
document.getElementById('cb-reads').addEventListener('change',    applyFilters);
document.getElementById('cb-group').addEventListener('change', () => {
  if (currentLayout === 'force') { restoreForceLayout(); simulation.alpha(0.3).restart(); }
});
document.getElementById('sl-min').addEventListener('input', function() {
  document.getElementById('sl-min-val').textContent = this.value;
  applyFilters();
});
document.getElementById('tf-from').addEventListener('change', function() {
  tlFrom = this.value || null;
  applyFilters();
  if (currentLayout === 'swimlane') { computeSwimlanePositions(); drawSwimlaneDecor(); applyStaticPositions(); }
  if (currentLayout === 'arc')      { computeArcPositions(); drawArcDecor(); applyStaticPositions(); }
});
document.getElementById('tf-clear').addEventListener('click', () => {
  document.getElementById('tf-from').value = ''; tlFrom = null;
  applyFilters();
});
document.getElementById('btn-shake').addEventListener('click', ()=> {
  if (currentLayout === 'force') simulation.alpha(.4).restart();
});
document.getElementById('btn-reset').addEventListener('click', ()=>
  svg.transition().duration(600).call(zoom.transform, initialTransform)
);
document.getElementById('btn-fit').addEventListener('click', () => {
  // zoom to fit all visible nodes
  const vis = GRAPH.nodes.filter(n=>n.x!=null&&n.y!=null&&n.type!=='project'||n.type==='project');
  if (!vis.length) return;
  const x0=d3.min(vis,d=>d.x)-30, x1=d3.max(vis,d=>d.x)+30;
  const y0=d3.min(vis,d=>d.y)-30, y1=d3.max(vis,d=>d.y)+30;
  const scale = Math.min(8, 0.9 / Math.max((x1-x0)/W, (y1-y0)/H));
  const tx = W/2 - scale*(x0+x1)/2, ty = H/2 - scale*(y0+y1)/2;
  svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
});
applyFilters();

// ── Stats ──────────────────────────────────────────────────────────────────────
function updateStats() {
  const dr=GRAPH.meta.date_range;
  document.getElementById('stats').textContent=
    \`\${GRAPH.nodes.filter(n=>n.type==='project').length} projects · \${GRAPH.nodes.filter(n=>n.type==='session').length} sessions · \${GRAPH.nodes.filter(n=>n.type==='file').length} files · \${GRAPH.edges.length} edges · \${dr.first.slice(0,10)} → \${dr.last.slice(0,10)}\`;
}
updateStats();

// ── Timeline ──────────────────────────────────────────────────────────────────
function buildTimeline() {
  const tlSvg=d3.select('#tl-svg'), tw=window.innerWidth, th=TL_H;
  tlSvg.attr('width',tw).attr('height',th);
  const dates=TIMELINE.map(d=>new Date(d.ts));
  if (!dates.length) return;
  const xScale=d3.scaleTime().domain([d3.min(dates),d3.max(dates)]).range([40,tw-40]);
  const days=d3.timeDay.range(d3.min(dates),d3.timeDay.offset(d3.max(dates),1));
  tlSvg.selectAll('line.tl-tick').data(days).join('line').attr('class','tl-tick')
    .attr('x1',d=>xScale(d)).attr('x2',d=>xScale(d)).attr('y1',th-20).attr('y2',th-4)
    .attr('stroke','#1a1a2e').attr('stroke-width',1);
  tlSvg.selectAll('text.tl-label').data(days.filter((_,i)=>i%3===0)).join('text').attr('class','tl-label')
    .attr('x',d=>xScale(d)).attr('y',th-22).attr('text-anchor','middle').attr('font-size',8)
    .attr('fill','#2a2a44').attr('font-family','Courier New,monospace').text(d=>d3.timeFormat('%m/%d')(d));
  tlSvg.selectAll('line.tl-base').data([0]).join('line').attr('class','tl-base')
    .attr('x1',40).attr('x2',tw-40).attr('y1',th-20).attr('y2',th-20).attr('stroke','#14142a').attr('stroke-width',1);
  const maxWork=Math.max(...TIMELINE.map(t=>t.tokens_work||1));
  tlSvg.selectAll('circle.tl-dot').data(TIMELINE,d=>d.id).join('circle').attr('class','tl-dot')
    .attr('cx',d=>xScale(new Date(d.ts)))
    .attr('cy',d=>{ const idx=COLOR_TO_INDEX[d.color]??0; return th-28-(idx%5)*4; })
    .attr('r',d=>3+4*Math.sqrt(d.tokens_work/maxWork))
    .attr('fill',d=>d.color).attr('fill-opacity',.85)
    .attr('stroke',d=>d.tool_errors>=8?'#ff2244':'none').attr('stroke-width',1.5).style('cursor','pointer')
    .on('mouseover',(ev,d)=>{ tip.style.display='block'; tip.innerHTML=\`<strong style="color:\${d.color}">\${d.slug}</strong><div class="meta">\${d.date_str} · \${d.project}</div><div class="meta">AI work: \${fmtT(d.tokens_work)}</div>\${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}\`; })
    .on('mousemove',ev=>{ tip.style.left=Math.min(ev.clientX+16,W-340)+'px'; tip.style.top=(ev.clientY-tip.offsetHeight-10)+'px'; })
    .on('mouseout',()=>tip.style.display='none')
    .on('click',(ev,d)=>{ ev.stopPropagation(); const node=nodeById[d.id]; if(!node) return;
      if(selectedId===d.id){selectedId=null;highlight(null);closePanel();}
      else { selectedId=d.id;highlight(d.id);showPanel(node);
        if (currentLayout==='force'||currentLayout==='swimlane'||currentLayout==='arc') {
          const t=d3.zoomTransform(svg.node()),nx=node.x*t.k+t.x,ny=node.y*t.k+t.y;
          svg.transition().duration(500).call(zoom.translateBy,(W/2-nx)/t.k,(H/2-ny)/t.k);
        }
      }
    });
}

function toggleWidget(id) {
  const el=document.getElementById(id);
  const col=el.classList.toggle('collapsed');
  el.querySelector('.widget-toggle').textContent=col?'+':'−';
}

buildTimeline();
nodeSel.call(drag);

// ── Live graph updates (SSE) ───────────────────────────────────────────────────
window.updateGraph = function(newData) {
  const posById={};
  simulation.nodes().forEach(n=>{ posById[n.id]={x:n.x,y:n.y,vx:n.vx||0,vy:n.vy||0,fx:n.fx,fy:n.fy}; });
  newData.nodes.forEach(n=>{ if(posById[n.id]) Object.assign(n,posById[n.id]); });
  seedPositions(newData);
  GRAPH=newData; TIMELINE=newData.timeline||TIMELINE;
  MAX_WEIGHT=Math.max(1,...GRAPH.edges.map(e=>e.weight||0));
  GRAPH.nodes.forEach(n=>nodeById[n.id]=n);
  simulation.nodes(GRAPH.nodes);
  simulation.force('link').links(GRAPH.edges);
  edgeSel=edgeLayer.selectAll('path').data(GRAPH.edges,edgeKey)
    .join(enter=>enter.append('path').call(styleEdge), update=>update, exit=>exit.remove());
  nodeSel=joinNodes(GRAPH); nodeSel.call(drag); attachTooltip(nodeSel); attachClick(nodeSel);
  projLabelSel=labelLayer.selectAll('text.pl').data(GRAPH.nodes.filter(n=>n.type==='project'),d=>d.id)
    .join('text').attr('class','pl').attr('text-anchor','middle').attr('fill',d=>d.color)
    .attr('font-size',9).attr('letter-spacing',1).attr('pointer-events','none').text(d=>d.label.toUpperCase());
  // Re-enter the current layout to recompute positions with fresh data
  LAYOUT_HANDLERS[currentLayout]?.enter?.();
  buildTimeline(); updateStats();
  applyFilters();
};

// ── Live status badge ──────────────────────────────────────────────────────────
if (window.location.protocol==='http:'||window.location.protocol==='https:') {
  const badge=document.createElement('div');
  badge.style.cssText='position:fixed;top:8px;right:12px;background:#00ff88;color:#000;font:bold 10px monospace;padding:3px 8px;border-radius:3px;z-index:9999;cursor:default;user-select:none;transition:background 0.3s';
  badge.title='Live — updates when sessions change'; document.body.appendChild(badge);
  function setBadge(t,c){badge.textContent=t;badge.style.background=c;}
  setBadge('⬤ LIVE','#00ff88');
  const es=new EventSource('/events');
  es.addEventListener('updated',async()=>{ setBadge('◌ updating…','#555');
    try { const r=await fetch('/graph-data.json?t='+Date.now()); const d=await r.json(); window.updateGraph(d);
      setBadge('↻ '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),'#00cc66');
      setTimeout(()=>setBadge('⬤ LIVE','#00ff88'),3000); } catch(e){ setBadge('⚠ error','#ff4444'); } });
  es.addEventListener('status',e=>{ if(e.data==='rebuilding') setBadge('◌ building…','#555'); });
  es.onerror=()=>setBadge('◌ reconnecting','#888');
  es.onopen=()=>setBadge('⬤ LIVE','#00ff88');
}

window.addEventListener('resize',()=>{
  W=window.innerWidth; H=window.innerHeight-TL_H;
  svg.attr('width',W).attr('height',H);
  d3.select('#tl-svg').attr('width',W);
  if (currentLayout==='3d' && layout3D._g) layout3D._g.width(W).height(H);
  if (currentLayout==='swimlane') { computeSwimlanePositions(); drawSwimlaneDecor(); applyStaticPositions(); }
  if (currentLayout==='arc')      { computeArcPositions(); drawArcDecor(); applyStaticPositions(); }
  if (currentLayout==='matrix')   renderMatrix();
});
</script>
</body>
</html>`;

  const outPath = path.join(CWD, 'graph.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Written: ${outPath}  (${(html.length/1024).toFixed(0)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
