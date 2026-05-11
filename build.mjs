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
  border: 1px solid #1c1c34; padding: 12px 16px; min-width: 230px; z-index: 200;
  max-height: calc(100vh - 130px); overflow-y: auto; }
#controls h3 { color: #4455cc; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; }
.ctrl { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
.ctrl label { flex: 1; cursor: pointer; color: #778; }
input[type=checkbox] { accent-color: #4455cc; cursor: pointer; }
input[type=range]    { flex: 1; accent-color: #4455cc; cursor: pointer; }
select.ctrl-sel { flex:1; background:#0c0c1e; border:1px solid #2a2a50; color:#8899cc;
  padding:2px 4px; font-family:inherit; font-size:10px; cursor:pointer; }
select.ctrl-sel:focus { outline: none; border-color: #4455cc; }
.val { min-width: 18px; text-align: right; color: #9ab; }
button.btn { background:#12122a; border:1px solid #2a2a50; color:#8899cc;
  padding:3px 12px; cursor:pointer; font-family:inherit; font-size:11px; }
button.btn:hover { background:#1e1e40; }
.sl-section-hd { color:#4455cc; font-size:9px; letter-spacing:2px; margin:8px 0 6px 0; }
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

  <div id="sl-options" style="display:none">
    <div class="sep"></div>
    <div class="sl-section-hd">◆ SWIMLANE</div>
    <div class="ctrl"><label for="sl-height-sel">Bar height</label>
      <select id="sl-height-sel" class="ctrl-sel">
        <option value="tokens">Token work</option>
        <option value="calls">Tool calls</option>
        <option value="duration">Duration</option>
        <option value="errors">Errors</option>
      </select>
    </div>
    <div class="ctrl"><label for="sl-width-sel">Bar width</label>
      <select id="sl-width-sel" class="ctrl-sel">
        <option value="duration">Duration</option>
        <option value="tokens">Token work</option>
        <option value="fixed">Fixed</option>
      </select>
    </div>
    <div class="ctrl"><label for="sl-color-sel">Color by</label>
      <select id="sl-color-sel" class="ctrl-sel">
        <option value="project">Project</option>
        <option value="branch">Branch</option>
        <option value="model">Model</option>
        <option value="recency">Recency</option>
        <option value="errors">Error level</option>
      </select>
    </div>
    <div class="ctrl"><input type="checkbox" id="sl-subbranch" checked><label for="sl-subbranch">Branch sub-rows</label></div>
    <div class="ctrl"><input type="checkbox" id="sl-blabels" checked><label for="sl-blabels">Branch labels</label></div>
    <div class="ctrl"><label for="sl-order-sel">Lane order</label>
      <select id="sl-order-sel" class="ctrl-sel">
        <option value="recent">Most recent</option>
        <option value="work">Most work</option>
        <option value="count">Session count</option>
        <option value="alpha">Alphabetical</option>
      </select>
    </div>
    <div class="ctrl"><label for="sl-grid-sel">Time grid</label>
      <select id="sl-grid-sel" class="ctrl-sel">
        <option value="auto">Auto</option>
        <option value="day">Day</option>
        <option value="week">Week</option>
        <option value="month">Month</option>
      </select>
    </div>
    <div class="ctrl"><label for="sl-label-sel">Bar label</label>
      <select id="sl-label-sel" class="ctrl-sel">
        <option value="date">Date</option>
        <option value="branch">Branch</option>
        <option value="msg">First message</option>
        <option value="off">Off</option>
      </select>
    </div>
  </div>
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
const slLayer    = root.append('g').attr('id', 'sl-layer').style('display', 'none');
const edgeLayer  = root.append('g').attr('id', 'edges');
const nodeLayer  = root.append('g').attr('id', 'nodes');
const labelLayer = root.append('g').attr('id', 'labels');

// ── D3 simulation ─────────────────────────────────────────────────────────────
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

// ── Edge rendering ────────────────────────────────────────────────────────────
let currentLayout = 'force';

function edgePathD(d) {
  const sx = d.source.x ?? 0, sy = d.source.y ?? 0;
  const tx = d.target.x ?? 0, ty = d.target.y ?? 0;
  if (currentLayout === 'arc') {
    if (d.type === 'branch') {
      const mx = (sx + tx) / 2, span = Math.abs(tx - sx);
      return \`M\${sx},\${sy} Q\${mx},\${sy - Math.min(span * 0.45, 140)} \${tx},\${ty}\`;
    }
    if (d.type === 'write' || d.type === 'edit' || d.type === 'read') {
      const mx = (sx + tx) / 2, span = Math.abs(tx - sx) + Math.abs(ty - sy);
      return \`M\${sx},\${sy} Q\${mx},\${sy + Math.min(span * 0.3, 90)} \${tx},\${ty}\`;
    }
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
        <div class="meta">\${d.session_count} sessions · AI work: \${fmtT(d.tokens_work)}</div>
        \${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}\`;
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
function slHighlight(id) {
  slLayer.selectAll('[data-sid]').attr('opacity', id
    ? function() { return this.getAttribute('data-sid')===id ? 1 : 0.2; }
    : 1);
  d3.selectAll('.tl-dot').attr('opacity', id ? d=>d.id===id?1:.2 : 1);
}

function attachClick(sel) {
  sel.on('click',(ev,d)=>{ ev.stopPropagation(); if(selectedId===d.id){selectedId=null;highlight(null);closePanel();}else{selectedId=d.id;highlight(d.id);showPanel(d);} });
}
attachClick(nodeSel);
svg.on('click',()=>{
  selectedId=null;
  if (currentLayout==='swimlane') slHighlight(null); else highlight(null);
  closePanel();
});

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
      <div class="prow"><span class="pk">Thinking</span><span class="pv">\${d.thinking_count}</span></div>
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

// ── Force layout ──────────────────────────────────────────────────────────────
function restoreForceLayout() {
  GRAPH.nodes.forEach(n => { if (n.type !== 'project') { n.fx = null; n.fy = null; } });
  GRAPH.nodes.filter(n => n.type === 'project').forEach(p => {
    const pos = projPos[p.id]; if (pos) { p.fx = pos.x; p.fy = pos.y; }
  });
  simulation
    .force('link',      makeForceLink())
    .force('charge',    d3.forceManyBody().strength(d=>d.type==='project'?-700:d.type==='session'?-130:-55))
    .force('collision', d3.forceCollide(d=>nodeR(d)+4).strength(0.85));
  if (document.getElementById('cb-group').checked) {
    simulation
      .force('gx', d3.forceX(d=>{ const p=projPos[d.project_id]; return p?.x??W/2; }).strength(d=>d.type==='project'?0:0.06))
      .force('gy', d3.forceY(d=>{ const p=projPos[d.project_id]; return p?.y??H/2; }).strength(d=>d.type==='project'?0:0.06));
  } else {
    simulation.force('gx', null).force('gy', null);
  }
}

// ── Swimlane: settings accessors ──────────────────────────────────────────────
const SL = {
  get heightMetric() { return document.getElementById('sl-height-sel')?.value ?? 'tokens'; },
  get widthMode()    { return document.getElementById('sl-width-sel')?.value  ?? 'duration'; },
  get colorBy()      { return document.getElementById('sl-color-sel')?.value  ?? 'project'; },
  get subBranch()    { return document.getElementById('sl-subbranch')?.checked ?? true; },
  get branchLabels() { return document.getElementById('sl-blabels')?.checked  ?? true; },
  get laneOrder()    { return document.getElementById('sl-order-sel')?.value   ?? 'recent'; },
  get gridUnit()     { return document.getElementById('sl-grid-sel')?.value    ?? 'auto'; },
  get labelMode()    { return document.getElementById('sl-label-sel')?.value   ?? 'date'; },
};

// ── Swimlane: color helpers ───────────────────────────────────────────────────
const BRANCH_PALETTE = ['#00aaff','#ff4488','#cc44ff','#ff8800','#00ff88','#ffcc00','#00cccc','#44ffaa','#ff88cc','#8844ff'];
function branchColor(branch) {
  if (!branch || branch === '__no-branch__') return '#334455';
  let h = 0;
  for (let i = 0; i < branch.length; i++) h = (Math.imul(h, 31) + branch.charCodeAt(i)) | 0;
  return BRANCH_PALETTE[Math.abs(h) % BRANCH_PALETTE.length];
}
function modelColor(model) {
  if (!model) return '#445566';
  if (model.includes('opus'))   return '#cc44ff';
  if (model.includes('sonnet')) return '#00aaff';
  if (model.includes('haiku'))  return '#00cccc';
  return '#888888';
}
function getSessionMetric(s, metric) {
  if (metric === 'tokens')   return s.tokens_work   || 0;
  if (metric === 'calls')    return s.tool_calls     || 0;
  if (metric === 'duration') return s.duration_min   || 0;
  if (metric === 'errors')   return s.tool_errors    || 0;
  return s.tokens_work || 0;
}
function getSessionColor(s, colorBy) {
  if (colorBy === 'branch')  return branchColor(s.git_branch);
  if (colorBy === 'model')   return modelColor(s.model);
  if (colorBy === 'recency') {
    const r = s.recency || 0;
    return r > 0.66 ? '#00ffcc' : r > 0.33 ? '#00aaff' : r > 0 ? '#334488' : '#223344';
  }
  if (colorBy === 'errors')  return s.errorLevel===2?'#ff2244':s.errorLevel===1?'#ff8833':s.color;
  return s.color; // project
}

// ── Swimlane: bar positions (for timeline pan-to) ─────────────────────────────
const slBarPos = {};

// ── Swimlane: main render ─────────────────────────────────────────────────────
function renderSwimlane() {
  slLayer.selectAll('*').remove();
  decorLayer.selectAll('*').remove();
  Object.keys(slBarPos).forEach(k => delete slBarPos[k]);

  const ML = 170, MT = 46, MR = 20, MB = 20;

  let sessions = GRAPH.nodes.filter(n => n.type === 'session')
    .filter(s => !tlFrom || !s.date_str || s.date_str >= tlFrom);

  const projects = GRAPH.nodes.filter(n => n.type === 'project');

  // Lane ordering
  const orderedProjects = [...projects].sort((a, b) => {
    if (SL.laneOrder === 'work') {
      const aw = d3.sum(sessions.filter(s=>s.project_id===a.id), s=>s.tokens_work||0);
      const bw = d3.sum(sessions.filter(s=>s.project_id===b.id), s=>s.tokens_work||0);
      return bw - aw;
    }
    if (SL.laneOrder === 'count') return b.session_count - a.session_count;
    if (SL.laneOrder === 'recent') {
      const aTs = d3.max(sessions.filter(s=>s.project_id===a.id).map(s=>s.first_timestamp||'')) || '';
      const bTs = d3.max(sessions.filter(s=>s.project_id===b.id).map(s=>s.first_timestamp||'')) || '';
      return bTs < aTs ? -1 : 1;
    }
    return a.label < b.label ? -1 : 1; // alpha
  });

  // Time scale
  const tsSess = sessions.filter(s => s.first_timestamp);
  if (!tsSess.length) {
    decorLayer.append('text').attr('x', W/2).attr('y', H/2)
      .attr('text-anchor','middle').attr('font-size',13).attr('fill','#2a2a44')
      .attr('font-family','Courier New,monospace').text('No sessions in range');
    return;
  }
  const tMin = new Date(d3.min(tsSess, s=>s.first_timestamp));
  const tMax = new Date(d3.max(tsSess, s=>s.first_timestamp));
  const span = Math.max(tMax - tMin, 1);
  const tMinPad = new Date(tMin.getTime() - span * 0.015);
  const tMaxPad = new Date(tMax.getTime() + span * 0.04);
  const xScale  = d3.scaleTime().domain([tMinPad, tMaxPad]).range([ML, W - MR]);

  // Metric normalization
  const metric    = SL.heightMetric;
  const maxMetric = Math.max(1, d3.max(sessions, s => getSessionMetric(s, metric)));
  const maxDur    = Math.max(1, d3.max(sessions, s => s.duration_min || 0));

  // Branch groups per project
  const projBranches = {};
  sessions.forEach(s => {
    const b = s.git_branch || '__no-branch__';
    if (!projBranches[s.project_id]) projBranches[s.project_id] = new Set();
    projBranches[s.project_id].add(b);
  });
  const sortBranches = set => [...set].sort((a, b) => {
    const main = s => s==='main'||s==='master';
    if (main(a)&&!main(b)) return -1; if (!main(a)&&main(b)) return 1;
    return a < b ? -1 : 1;
  });

  // Lane geometry
  const BRANCH_ROW_H = 46;
  const FLAT_LANE_H  = 66;
  const LANE_PAD     = 8;
  const MAX_BAR_FRAC = 0.80;
  const MIN_BAR_W    = 5;

  const laneInfo = {};
  let curY = MT;
  for (const proj of orderedProjects) {
    const branches = sortBranches(projBranches[proj.id] || new Set(['__no-branch__']));
    const laneH = SL.subBranch
      ? Math.max(FLAT_LANE_H, branches.length * BRANCH_ROW_H + LANE_PAD * 2)
      : FLAT_LANE_H;
    const branchRows = {};
    branches.forEach((b, i) => {
      branchRows[b] = SL.subBranch
        ? { y: curY + LANE_PAD + i * BRANCH_ROW_H, h: BRANCH_ROW_H }
        : { y: curY + LANE_PAD, h: laneH - LANE_PAD * 2 };
    });
    laneInfo[proj.id] = { y: curY, h: laneH, branches, branchRows };
    curY += laneH;
  }
  const totalH = curY + MB;

  // ── Time grid ─────────────────────────────────────────────────────────────
  const autoGrid  = span < 14*864e5 ? 'day' : span < 90*864e5 ? 'week' : 'month';
  const gridUnit  = SL.gridUnit === 'auto' ? autoGrid : SL.gridUnit;
  const timeIntvl = gridUnit==='day' ? d3.timeDay : gridUnit==='week' ? d3.timeMonday : d3.timeMonth;
  const gridTicks = timeIntvl.range(tMinPad, tMaxPad);
  const timeFmt   = d3.timeFormat(gridUnit==='month' ? '%b %Y' : '%m/%d');

  gridTicks.forEach((t, i) => {
    const x  = xScale(t);
    const x2 = i+1 < gridTicks.length ? xScale(gridTicks[i+1]) : W - MR;
    // alternating band fill
    if (i % 2 === 0)
      decorLayer.append('rect').attr('x',x).attr('y',MT).attr('width',Math.max(0,x2-x)).attr('height',totalH-MT)
        .attr('fill','#0a0a1a').attr('fill-opacity',0.45);
    decorLayer.append('line').attr('x1',x).attr('x2',x).attr('y1',MT).attr('y2',totalH)
      .attr('stroke','#141428').attr('stroke-width',0.5);
    decorLayer.append('text').attr('x',x+3).attr('y',MT-6).attr('font-size',8)
      .attr('fill','#252548').attr('font-family','Courier New,monospace').text(timeFmt(t));
  });

  // ── Lane backgrounds + labels ─────────────────────────────────────────────
  orderedProjects.forEach(proj => {
    const { y, h, branches, branchRows } = laneInfo[proj.id];

    // Faint project colour tint
    decorLayer.append('rect').attr('x',0).attr('y',y).attr('width',W).attr('height',h)
      .attr('fill', proj.color).attr('fill-opacity', 0.025);
    // Top border
    decorLayer.append('line').attr('x1',0).attr('x2',W).attr('y1',y).attr('y2',y)
      .attr('stroke','#1a1a2e').attr('stroke-width',1);
    // Project label top-left of lane
    decorLayer.append('text').attr('x',6).attr('y',y+13).attr('font-size',9)
      .attr('fill',proj.color).attr('fill-opacity',0.85)
      .attr('font-family','Courier New,monospace').attr('letter-spacing',1)
      .text(proj.label.toUpperCase());

    // Branch sub-row dividers + labels
    if (SL.subBranch && branches.length > 1) {
      branches.forEach((b, i) => {
        const row = branchRows[b];
        if (i > 0) {
          decorLayer.append('line')
            .attr('x1',ML).attr('x2',W-MR).attr('y1',row.y).attr('y2',row.y)
            .attr('stroke','#111128').attr('stroke-width',0.5).attr('stroke-dasharray','4 4');
        }
        if (SL.branchLabels) {
          const lbl = b==='__no-branch__' ? '?' : b.length>24 ? '…'+b.slice(-22) : b;
          decorLayer.append('text').attr('x',ML-6).attr('y',row.y + row.h/2 + 3)
            .attr('text-anchor','end').attr('font-size',8)
            .attr('fill', branchColor(b)).attr('fill-opacity',0.7)
            .attr('font-family','Courier New,monospace').text(lbl);
        }
      });
    } else if (!SL.subBranch && SL.branchLabels === false) {
      // nothing
    }
  });
  // Bottom border
  decorLayer.append('line').attr('x1',0).attr('x2',W).attr('y1',curY).attr('y2',curY)
    .attr('stroke','#1a1a2e').attr('stroke-width',1);
  // Left-margin separator
  decorLayer.append('line').attr('x1',ML).attr('x2',ML).attr('y1',MT).attr('y2',curY)
    .attr('stroke','#141428').attr('stroke-width',1);

  // ── Bar width helper ──────────────────────────────────────────────────────
  const wm = SL.widthMode;
  function barW(s) {
    if (wm === 'duration' && s.duration_min && s.first_timestamp) {
      const endX = xScale(new Date(new Date(s.first_timestamp).getTime() + s.duration_min * 60000));
      return Math.max(MIN_BAR_W, endX - xScale(new Date(s.first_timestamp)));
    }
    if (wm === 'tokens') return Math.max(MIN_BAR_W, 7 + 52 * Math.sqrt(s.tokens_work / maxMetric));
    return 12; // fixed
  }

  // ── Group sessions by project → branch for lineage ────────────────────────
  const pbSessions = {};
  sessions.forEach(s => {
    const b = s.git_branch || '__no-branch__';
    if (!pbSessions[s.project_id]) pbSessions[s.project_id] = {};
    if (!pbSessions[s.project_id][b]) pbSessions[s.project_id][b] = [];
    pbSessions[s.project_id][b].push(s);
  });
  for (const pid in pbSessions)
    for (const b in pbSessions[pid])
      pbSessions[pid][b].sort((a,c)=>(a.first_timestamp||'')<(c.first_timestamp||'')?-1:1);

  // ── Draw branch lineage connectors (behind bars) ──────────────────────────
  const colorBy = SL.colorBy;
  for (const [pid, branchMap] of Object.entries(pbSessions)) {
    const info = laneInfo[pid]; if (!info) continue;
    for (const [branch, ss] of Object.entries(branchMap)) {
      const row = info.branchRows[branch] ?? Object.values(info.branchRows)[0];
      if (!row) continue;
      const rowMid = row.y + row.h * 0.72; // align with bar midpoint
      for (let i = 0; i < ss.length - 1; i++) {
        const a = ss[i], c = ss[i+1];
        if (!a.first_timestamp || !c.first_timestamp) continue;
        const ax = xScale(new Date(a.first_timestamp)) + barW(a);
        const cx = xScale(new Date(c.first_timestamp));
        if (cx > ax && (cx - ax) < W * 0.6) {
          slLayer.append('line')
            .attr('x1',ax).attr('y1',rowMid).attr('x2',cx).attr('y2',rowMid)
            .attr('stroke', branchColor(branch)).attr('stroke-opacity',0.3)
            .attr('stroke-width',1.5).attr('stroke-dasharray','3 3')
            .attr('pointer-events','none');
        }
      }
    }
  }

  // ── Draw session bars ─────────────────────────────────────────────────────
  const labelMode = SL.labelMode;

  sessions.forEach(s => {
    const info = laneInfo[s.project_id]; if (!info) return;
    const branch = s.git_branch || '__no-branch__';
    const row    = info.branchRows[branch] ?? Object.values(info.branchRows)[0];
    if (!row || !s.first_timestamp) return;

    const bx  = xScale(new Date(s.first_timestamp));
    const bw  = barW(s);
    const mVal = getSessionMetric(s, metric);
    const maxBH = row.h * MAX_BAR_FRAC;
    const bh  = Math.max(4, maxBH * (mVal / maxMetric));
    const by  = row.y + row.h - bh;            // grows upward from row bottom
    const col = getSessionColor(s, colorBy);

    slBarPos[s.id] = { x: bx, y: by, w: bw, h: bh };

    // Error halo
    if (s.errorLevel > 0) {
      const stroke = s.errorLevel===2 ? '#ff2244' : '#ff8833';
      slLayer.append('rect').attr('data-sid', s.id)
        .attr('x',bx-2).attr('y',by-2).attr('width',bw+4).attr('height',bh+4)
        .attr('fill','none').attr('stroke',stroke).attr('stroke-width',1.5).attr('rx',3)
        .attr('pointer-events','none');
    }

    // In-flight glow
    if (s.inFlight) {
      slLayer.append('rect').attr('data-sid', s.id)
        .attr('x',bx-3).attr('y',by-3).attr('width',bw+6).attr('height',bh+6)
        .attr('fill','none').attr('stroke','${IN_FLIGHT_COLOR}').attr('stroke-width',2).attr('rx',4)
        .attr('pointer-events','none');
    }

    // Main bar
    const bar = slLayer.append('rect').attr('class','sl-bar').attr('data-sid', s.id)
      .attr('x',bx).attr('y',by).attr('width',bw).attr('height',bh)
      .attr('fill',col).attr('fill-opacity',0.82)
      .attr('rx',2).attr('stroke','#000').attr('stroke-width',0.3)
      .style('cursor','pointer');

    // Skill dot (top edge)
    if (s.skills?.length) {
      slLayer.append('circle').attr('data-sid', s.id)
        .attr('cx',bx+bw/2).attr('cy',by+3).attr('r',2.5)
        .attr('fill','#ffcc00').attr('fill-opacity',0.9).attr('pointer-events','none');
    }

    // Thinking dot (small white)
    if (s.thinking_count > 0) {
      slLayer.append('circle').attr('data-sid', s.id)
        .attr('cx',bx+5).attr('cy',by+4).attr('r',2)
        .attr('fill','#fff').attr('fill-opacity',0.7).attr('pointer-events','none');
    }

    // Bar label
    if (labelMode !== 'off' && bw >= 22) {
      let lbl = '';
      if (labelMode === 'date')   lbl = (s.date_str||'').slice(5);     // MM-DD
      if (labelMode === 'branch') lbl = (s.git_branch||'?').split('/').pop().slice(0,11);
      if (labelMode === 'msg')    lbl = (s.first_user_message||'').slice(0,16);
      if (lbl) {
        slLayer.append('text').attr('data-sid', s.id)
          .attr('x',bx+3).attr('y',by+bh-3)
          .attr('font-size',7).attr('fill','#fff').attr('fill-opacity',0.65)
          .attr('font-family','Courier New,monospace').attr('pointer-events','none')
          .text(lbl);
      }
    }

    // Tooltip + click
    const tipHtml = () => \`<strong style="color:\${col}">\${s.label}</strong>
      <div class="meta">\${s.date_str||'?'} · \${s.duration_min!=null?s.duration_min+'min':'?'} · \${s.model||'?'}</div>
      <div class="meta">branch: \${s.git_branch||'?'}</div>
      <div class="meta">AI work: \${fmtT(s.tokens_work)} · \${s.tool_calls} calls · \${s.tool_errors} errors</div>
      \${s.inFlight?'<div class="meta" style="color:${IN_FLIGHT_COLOR}">⬤ in flight</div>':''}
      \${s.skills?.length?'<div class="meta">/'+s.skills.join(' /')+'</div>':''}
      \${s.first_user_message?'<div class="body">'+s.first_user_message.slice(0,120)+'</div>':''}\`;

    bar.on('mouseover', ev => { tip.style.display='block'; tip.innerHTML=tipHtml(); })
       .on('mousemove', ev => {
          const tx=ev.clientX+16, ow=tip.offsetWidth;
          tip.style.left=(tx+ow>W-10?ev.clientX-ow-16:tx)+'px';
          tip.style.top=Math.min(ev.clientY-8,H-tip.offsetHeight-10)+'px';
        })
       .on('mouseout',  ()  => tip.style.display='none')
       .on('click', ev => {
          ev.stopPropagation();
          if (selectedId === s.id) { selectedId=null; slHighlight(null); closePanel(); }
          else { selectedId=s.id; slHighlight(s.id); showPanel(nodeById[s.id]); }
        });
  });

  // ── Metric axis label (bottom-right) ─────────────────────────────────────
  const metricNames = {tokens:'token work',calls:'tool calls',duration:'duration',errors:'errors'};
  decorLayer.append('text').attr('x',W-MR-2).attr('y',curY-4).attr('text-anchor','end')
    .attr('font-size',8).attr('fill','#252548').attr('font-family','Courier New,monospace')
    .text(\`bar height = \${metricNames[metric]||metric}  ·  bar width = \${wm}  ·  color = \${colorBy}\`);
}

// ── Arc layout ────────────────────────────────────────────────────────────────
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
  sessions.forEach(s => { s.x=s.first_timestamp?arcXScale(new Date(s.first_timestamp)):W/2; s.y=axisY; s.fx=s.x; s.fy=s.y; });
  const projXs = {};
  sessions.forEach(s => (projXs[s.project_id]=projXs[s.project_id]||[]).push(s.x));
  projects.forEach(p => { const xs=projXs[p.id]||[W/2]; p.x=xs.reduce((a,b)=>a+b,0)/xs.length; p.y=axisY-130; p.fx=p.x; p.fy=p.y; });
  const fileY = axisY + 100;
  files.forEach(f => {
    const xs=GRAPH.edges.filter(e=>(e.target?.id??e.target)===f.id).map(e=>nodeById[e.source?.id??e.source]).filter(n=>n?.type==='session'&&n.x!=null).map(n=>n.x);
    f.x=xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:W/2; f.y=fileY; f.fx=f.x; f.fy=f.y;
  });
}

function drawArcDecor() {
  decorLayer.selectAll('*').remove();
  if (!arcXScale) return;
  const axisY = H * 0.52;
  decorLayer.append('line').attr('x1',50).attr('x2',W-50).attr('y1',axisY).attr('y2',axisY).attr('stroke','#1a1a30').attr('stroke-width',1.5);
  arcXScale.ticks(10).forEach(t => {
    const x = arcXScale(t);
    decorLayer.append('line').attr('x1',x).attr('x2',x).attr('y1',axisY-4).attr('y2',axisY+4).attr('stroke','#2a2a44').attr('stroke-width',1);
    decorLayer.append('text').attr('x',x).attr('y',axisY+16).attr('text-anchor','middle').attr('font-size',8).attr('fill','#2a2a44').attr('font-family','Courier New,monospace').text(d3.timeFormat('%m/%d')(t));
  });
}

// ── Apply static positions (arc layout) ──────────────────────────────────────
function applyStaticPositions() {
  GRAPH.nodes.forEach(n => { if (n.fx != null) n.x = n.fx; if (n.fy != null) n.y = n.fy; });
  nodeSel.attr('transform', d=>\`translate(\${d.x??0},\${d.y??0})\`);
  edgeSel.attr('d', edgePathD);
  projLabelSel.attr('x', d=>d.x??0).attr('y', d=>(d.y??0)+PROJ_R+13);
}

// ── Matrix layout ─────────────────────────────────────────────────────────────
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
  if (!files.length || !sessions.length) { mv.innerHTML='<div class="mx-empty">No data — adjust filters</div>'; return; }
  files.sort((a,b)=>(b.write+b.edit)-(a.write+a.edit));
  const opMap = {};
  GRAPH.edges.forEach(e => {
    if (!['write','edit','read'].includes(e.type)) return;
    const sId=e.source?.id??e.source, fId=e.target?.id??e.target;
    if (!opMap[sId]) opMap[sId]={};
    if (!opMap[sId][fId]) opMap[sId][fId]={read:0,write:0,edit:0};
    opMap[sId][fId][e.type]=(opMap[sId][fId][e.type]||0)+(e.weight||1);
  });
  const LABEL_W=180,HEADER_H=84,CELL_H=18;
  const CELL_W=Math.max(10,Math.min(36,(W-LABEL_W-20)/sessions.length));
  const svgW=LABEL_W+sessions.length*CELL_W+4, svgH=HEADER_H+files.length*CELL_H+20;
  const bar=document.createElement('div'); bar.className='mx-legend';
  bar.innerHTML=\`<span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#ffcc00" fill-opacity=".75"/></svg>edit</span>
    <span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#00ff88" fill-opacity=".75"/></svg>write</span>
    <span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#1e4a66" fill-opacity=".8"/></svg>read only</span>
    <span style="margin-left:auto;color:#2a2a44;font-size:10px">\${files.length} files × \${sessions.length} sessions</span>\`;
  mv.appendChild(bar);
  const msvg=d3.select(mv).append('svg').attr('width',svgW).attr('height',svgH).style('display','block');
  const hg=msvg.append('g').attr('transform',\`translate(\${LABEL_W},0)\`);
  sessions.forEach((s,si)=>{
    const x=si*CELL_W+CELL_W/2;
    hg.append('text').attr('x',x).attr('y',HEADER_H-4).attr('transform',\`rotate(-45,\${x},\${HEADER_H-4})\`)
      .attr('text-anchor','end').attr('font-size',8).attr('fill',s.color)
      .attr('font-family','Courier New,monospace').text(s.date_str||s.label);
  });
  const rg=msvg.append('g').attr('transform',\`translate(0,\${HEADER_H})\`);
  files.forEach((f,fi)=>{
    const gy=fi*CELL_H;
    if(fi%2===0) rg.append('rect').attr('x',0).attr('y',gy).attr('width',svgW).attr('height',CELL_H).attr('fill','#0a0a18');
    rg.append('text').attr('x',LABEL_W-6).attr('y',gy+CELL_H/2+3).attr('text-anchor','end').attr('font-size',9).attr('fill',f.color).attr('font-family','Courier New,monospace').text(f.label).append('title').text(f.full_path);
    sessions.forEach((s,si)=>{
      const ops=opMap[s.id]?.[f.id];
      let fill='transparent',opacity=1;
      if(ops){if(ops.edit>0){fill='#ffcc00';opacity=0.75;}else if(ops.write>0){fill='#00ff88';opacity=0.75;}else if(ops.read>0){fill='#1e4a66';opacity=0.8;}}
      const cell=rg.append('rect').attr('x',LABEL_W+si*CELL_W).attr('y',gy+1).attr('width',CELL_W-1).attr('height',CELL_H-2).attr('fill',fill).attr('fill-opacity',opacity).style('cursor',ops?'pointer':'default');
      if(ops){const os=[ops.write?\`\${ops.write}w\`:'',ops.edit?\`\${ops.edit}e\`:'',ops.read?\`\${ops.read}r\`:''].filter(Boolean).join(' ');
        cell.on('mouseover',ev=>{tip.style.display='block';tip.innerHTML=\`<strong style="color:\${s.color}">\${s.label}</strong><div class="meta">\${f.label}</div><div class="meta">\${os}</div>\`;tip.style.left=(ev.clientX+12)+'px';tip.style.top=(ev.clientY-20)+'px';})
          .on('mousemove',ev=>{tip.style.left=(ev.clientX+12)+'px';tip.style.top=(ev.clientY-20)+'px';})
          .on('mouseout',()=>tip.style.display='none')
          .on('click',ev=>{ev.stopPropagation();selectedId=s.id;showPanel(s);});
      }
    });
  });
}

// ── 3D layout ─────────────────────────────────────────────────────────────────
const layout3D = {
  _g: null,
  enter() {
    document.getElementById('canvas').style.display='none';
    document.getElementById('matrix-view').style.display='none';
    document.getElementById('three-view').style.display='block';
    simulation.stop();
    if (typeof ForceGraph3D === 'undefined') {
      document.getElementById('three-view').innerHTML='<div style="color:#445;padding:60px;text-align:center;font-family:monospace;font-size:13px">Loading 3D library…<br>Try switching back once loaded.</div>';
      return;
    }
    const showBranch=document.getElementById('cb-branch').checked, showReads=document.getElementById('cb-reads').checked;
    const showFiles=document.getElementById('cb-files').checked, minSess=+document.getElementById('sl-min').value;
    const hiddenIds=new Set(GRAPH.nodes.filter(n=>(n.type==='file'&&(!showFiles||n.session_count<minSess))||(n.type==='session'&&tlFrom&&n.date_str&&n.date_str<tlFrom)).map(n=>n.id));
    const nodes3d=GRAPH.nodes.filter(n=>!hiddenIds.has(n.id)).map(n=>({...n}));
    const links3d=GRAPH.edges.filter(e=>{const s=e.source?.id??e.source,t=e.target?.id??e.target;if(hiddenIds.has(s)||hiddenIds.has(t))return false;if(e.type==='branch'&&!showBranch)return false;if(e.type==='read'&&!showReads)return false;return true;}).map(e=>({source:e.source?.id??e.source,target:e.target?.id??e.target,type:e.type,weight:e.weight}));
    this._g=ForceGraph3D({controlType:'orbit'})(document.getElementById('three-view'))
      .width(W).height(H).backgroundColor('#080810')
      .graphData({nodes:nodes3d,links:links3d})
      .nodeId('id').nodeLabel('label').nodeColor(d=>d.color).nodeVal(d=>nodeR(d)*1.8).nodeOpacity(0.85)
      .linkColor(e=>EC[e.type]||'#444').linkOpacity(0.4).linkWidth(e=>edgeWidth(e))
      .onNodeClick((node,ev)=>{ev.stopPropagation();selectedId=node.id;const orig=nodeById[node.id];if(orig)showPanel(orig);})
      .onBackgroundClick(()=>{selectedId=null;closePanel();});
  },
  exit() {
    document.getElementById('three-view').style.display='none';
    document.getElementById('canvas').style.display='block';
    if(this._g){document.getElementById('three-view').innerHTML='';this._g=null;}
  }
};

// ── Layout manager ────────────────────────────────────────────────────────────
const LAYOUT_HANDLERS = {
  force: {
    enter() {
      slLayer.style('display','none');
      edgeLayer.style('display',null); nodeLayer.style('display',null); labelLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      document.getElementById('sl-options').style.display='none';
      decorLayer.selectAll('*').remove();
      restoreForceLayout();
      simulation.alpha(0.25).restart();
      nodeSel.call(drag);
    },
    exit() {}
  },
  swimlane: {
    enter() {
      edgeLayer.style('display','none'); nodeLayer.style('display','none'); labelLayer.style('display','none');
      slLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      document.getElementById('sl-options').style.display='block';
      simulation.stop();
      svg.call(zoom.transform, d3.zoomIdentity); // reset zoom for swimlane
      renderSwimlane();
    },
    exit() {
      edgeLayer.style('display',null); nodeLayer.style('display',null); labelLayer.style('display',null);
      slLayer.style('display','none');
      document.getElementById('sl-options').style.display='none';
      decorLayer.selectAll('*').remove();
    }
  },
  arc: {
    enter() {
      slLayer.style('display','none');
      edgeLayer.style('display',null); nodeLayer.style('display',null); labelLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      document.getElementById('sl-options').style.display='none';
      simulation.stop(); computeArcPositions(); drawArcDecor(); applyStaticPositions();
      nodeSel.on('.drag', null);
    },
    exit() { decorLayer.selectAll('*').remove(); }
  },
  matrix: {
    enter() {
      document.getElementById('canvas').style.display='none';
      document.getElementById('matrix-view').style.display='block';
      document.getElementById('three-view').style.display='none';
      document.getElementById('sl-options').style.display='none';
      simulation.stop(); renderMatrix();
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
  if (currentLayout === 'matrix')   { renderMatrix();   return; }
  if (currentLayout === '3d')       { layout3D.exit(); layout3D.enter(); return; }
  if (currentLayout === 'swimlane') { renderSwimlane(); return; }

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
    const src=e.source?.id??e.source, tgt=e.target?.id??e.target;
    if (hiddenNodes.has(src)||hiddenNodes.has(tgt)) return 'none';
    if (e.type==='read'   && !showReads)  return 'none';
    if (e.type==='branch' && !showBranch) return 'none';
    return null;
  });
  projLabelSel.attr('display', null);
}

// Wire up general controls
document.getElementById('cb-files').addEventListener('change',    applyFilters);
document.getElementById('cb-ro-files').addEventListener('change', applyFilters);
document.getElementById('cb-branch').addEventListener('change',   applyFilters);
document.getElementById('cb-reads').addEventListener('change',    applyFilters);
document.getElementById('cb-group').addEventListener('change', () => {
  if (currentLayout==='force') { restoreForceLayout(); simulation.alpha(0.3).restart(); }
});
document.getElementById('sl-min').addEventListener('input', function() {
  document.getElementById('sl-min-val').textContent = this.value; applyFilters();
});
document.getElementById('tf-from').addEventListener('change', function() {
  tlFrom = this.value || null; applyFilters();
  if (currentLayout==='arc') { computeArcPositions(); drawArcDecor(); applyStaticPositions(); }
});
document.getElementById('tf-clear').addEventListener('click', () => {
  document.getElementById('tf-from').value=''; tlFrom=null; applyFilters();
});
document.getElementById('btn-shake').addEventListener('click', ()=>{ if(currentLayout==='force') simulation.alpha(.4).restart(); });
document.getElementById('btn-reset').addEventListener('click', ()=>svg.transition().duration(600).call(zoom.transform, initialTransform));
document.getElementById('btn-fit').addEventListener('click', () => {
  if (currentLayout==='swimlane'||currentLayout==='matrix') return;
  const vis=GRAPH.nodes.filter(n=>n.x!=null&&n.y!=null);
  if (!vis.length) return;
  const x0=d3.min(vis,d=>d.x)-30,x1=d3.max(vis,d=>d.x)+30;
  const y0=d3.min(vis,d=>d.y)-30,y1=d3.max(vis,d=>d.y)+30;
  const scale=Math.min(8,0.9/Math.max((x1-x0)/W,(y1-y0)/H));
  svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(W/2-scale*(x0+x1)/2,H/2-scale*(y0+y1)/2).scale(scale));
});

// Wire up swimlane-specific controls
['sl-height-sel','sl-width-sel','sl-color-sel','sl-order-sel','sl-grid-sel','sl-label-sel'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', ()=>{ if(currentLayout==='swimlane') renderSwimlane(); });
});
['sl-subbranch','sl-blabels'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', ()=>{ if(currentLayout==='swimlane') renderSwimlane(); });
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
  const tlSvg=d3.select('#tl-svg'),tw=window.innerWidth,th=TL_H;
  tlSvg.attr('width',tw).attr('height',th);
  const dates=TIMELINE.map(d=>new Date(d.ts));
  if(!dates.length) return;
  const xScale=d3.scaleTime().domain([d3.min(dates),d3.max(dates)]).range([40,tw-40]);
  const days=d3.timeDay.range(d3.min(dates),d3.timeDay.offset(d3.max(dates),1));
  tlSvg.selectAll('line.tl-tick').data(days).join('line').attr('class','tl-tick').attr('x1',d=>xScale(d)).attr('x2',d=>xScale(d)).attr('y1',th-20).attr('y2',th-4).attr('stroke','#1a1a2e').attr('stroke-width',1);
  tlSvg.selectAll('text.tl-label').data(days.filter((_,i)=>i%3===0)).join('text').attr('class','tl-label').attr('x',d=>xScale(d)).attr('y',th-22).attr('text-anchor','middle').attr('font-size',8).attr('fill','#2a2a44').attr('font-family','Courier New,monospace').text(d=>d3.timeFormat('%m/%d')(d));
  tlSvg.selectAll('line.tl-base').data([0]).join('line').attr('class','tl-base').attr('x1',40).attr('x2',tw-40).attr('y1',th-20).attr('y2',th-20).attr('stroke','#14142a').attr('stroke-width',1);
  const maxWork=Math.max(...TIMELINE.map(t=>t.tokens_work||1));
  tlSvg.selectAll('circle.tl-dot').data(TIMELINE,d=>d.id).join('circle').attr('class','tl-dot')
    .attr('cx',d=>xScale(new Date(d.ts)))
    .attr('cy',d=>{const idx=COLOR_TO_INDEX[d.color]??0;return th-28-(idx%5)*4;})
    .attr('r',d=>3+4*Math.sqrt(d.tokens_work/maxWork))
    .attr('fill',d=>d.color).attr('fill-opacity',.85)
    .attr('stroke',d=>d.tool_errors>=8?'#ff2244':'none').attr('stroke-width',1.5).style('cursor','pointer')
    .on('mouseover',(ev,d)=>{tip.style.display='block';tip.innerHTML=\`<strong style="color:\${d.color}">\${d.slug}</strong><div class="meta">\${d.date_str} · \${d.project}</div><div class="meta">AI work: \${fmtT(d.tokens_work)}</div>\${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}\`;})
    .on('mousemove',ev=>{tip.style.left=Math.min(ev.clientX+16,W-340)+'px';tip.style.top=(ev.clientY-tip.offsetHeight-10)+'px';})
    .on('mouseout',()=>tip.style.display='none')
    .on('click',(ev,d)=>{
      ev.stopPropagation();
      const node=nodeById[d.id]; if(!node) return;
      if(selectedId===d.id){selectedId=null;if(currentLayout==='swimlane')slHighlight(null);else highlight(null);closePanel();}
      else {
        selectedId=d.id;
        if (currentLayout==='swimlane') {
          slHighlight(d.id); showPanel(node);
          const bp=slBarPos[d.id];
          if(bp){const t=d3.zoomTransform(svg.node());const cx=bp.x+bp.w/2,cy=bp.y+bp.h/2;const nx=cx*t.k+t.x,ny=cy*t.k+t.y;svg.transition().duration(500).call(zoom.translateBy,(W/2-nx)/t.k,(H/2-ny)/t.k);}
        } else {
          highlight(d.id); showPanel(node);
          if(currentLayout==='force'||currentLayout==='arc'){const t=d3.zoomTransform(svg.node()),nx=node.x*t.k+t.x,ny=node.y*t.k+t.y;svg.transition().duration(500).call(zoom.translateBy,(W/2-nx)/t.k,(H/2-ny)/t.k);}
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

// ── Live graph updates ────────────────────────────────────────────────────────
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
  edgeSel=edgeLayer.selectAll('path').data(GRAPH.edges,edgeKey).join(enter=>enter.append('path').call(styleEdge),update=>update,exit=>exit.remove());
  nodeSel=joinNodes(GRAPH); nodeSel.call(drag); attachTooltip(nodeSel); attachClick(nodeSel);
  projLabelSel=labelLayer.selectAll('text.pl').data(GRAPH.nodes.filter(n=>n.type==='project'),d=>d.id).join('text').attr('class','pl').attr('text-anchor','middle').attr('fill',d=>d.color).attr('font-size',9).attr('letter-spacing',1).attr('pointer-events','none').text(d=>d.label.toUpperCase());
  LAYOUT_HANDLERS[currentLayout]?.enter?.();
  buildTimeline(); updateStats(); applyFilters();
};

// ── Live status badge ──────────────────────────────────────────────────────────
if (window.location.protocol==='http:'||window.location.protocol==='https:') {
  const badge=document.createElement('div');
  badge.style.cssText='position:fixed;top:8px;right:12px;background:#00ff88;color:#000;font:bold 10px monospace;padding:3px 8px;border-radius:3px;z-index:9999;cursor:default;user-select:none;transition:background 0.3s';
  badge.title='Live — updates when sessions change'; document.body.appendChild(badge);
  function setBadge(t,c){badge.textContent=t;badge.style.background=c;}
  setBadge('⬤ LIVE','#00ff88');
  const es=new EventSource('/events');
  es.addEventListener('updated',async()=>{setBadge('◌ updating…','#555');try{const r=await fetch('/graph-data.json?t='+Date.now());const d=await r.json();window.updateGraph(d);setBadge('↻ '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),'#00cc66');setTimeout(()=>setBadge('⬤ LIVE','#00ff88'),3000);}catch(e){setBadge('⚠ error','#ff4444');}});
  es.addEventListener('status',e=>{if(e.data==='rebuilding')setBadge('◌ building…','#555');});
  es.onerror=()=>setBadge('◌ reconnecting','#888');
  es.onopen=()=>setBadge('⬤ LIVE','#00ff88');
}

window.addEventListener('resize',()=>{
  W=window.innerWidth; H=window.innerHeight-TL_H;
  svg.attr('width',W).attr('height',H);
  d3.select('#tl-svg').attr('width',W);
  if(currentLayout==='3d'&&layout3D._g) layout3D._g.width(W).height(H);
  if(currentLayout==='swimlane') renderSwimlane();
  if(currentLayout==='arc')      {computeArcPositions();drawArcDecor();applyStaticPositions();}
  if(currentLayout==='matrix')   renderMatrix();
});
</script>
</body>
</html>`;

  const outPath = path.join(CWD, 'graph.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Written: ${outPath}  (${(html.length/1024).toFixed(0)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
