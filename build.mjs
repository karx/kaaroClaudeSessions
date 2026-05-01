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

const CWD  = process.cwd();
const DATA = JSON.parse(fs.readFileSync(path.join(CWD, 'sessions-data.json'), 'utf8'));
const MIN_FILE_SESSIONS = parseInt(process.argv.find(a => a.startsWith('--min-sessions='))?.split('=')[1] ?? '2');

// ── Dynamic color assignment ──────────────────────────────────────────────────
// Projects sorted alphabetically for stable colour assignment across runs.

const PALETTE = [
  '#00aaff', '#ff4488', '#cc44ff', '#ff8800',
  '#00ff88', '#ffcc00', '#00cccc', '#ff6666',
  '#44ffaa', '#ff88cc', '#8844ff', '#88ccff',
];
const PROJECT_COLORS = {};
const COLOR_TO_INDEX = {};
[...DATA.projects].sort((a, b) => a.id < b.id ? -1 : 1).forEach((p, i) => {
  PROJECT_COLORS[p.id]      = PALETTE[i % PALETTE.length];
  COLOR_TO_INDEX[PALETTE[i % PALETTE.length]] = i;
});

const EXT_COLORS = {
  mjs: '#00cccc', js: '#00aaff', ts: '#6688ff', svelte: '#ff8844',
  json: '#ffcc00', md: '#cc44ff', html: '#ff4488', css: '#33ee88',
  py: '#88cc44', txt: '#888888', sh: '#44ffaa',
};

// ── Recency scoring ───────────────────────────────────────────────────────────
// recencyLevel: 0 = no pulse, 1 = dim (< 2 days), 2 = low (< 15 min), 3 = fast bright (< 5 min)
const generatedAt  = new Date(DATA.meta.generated_at).getTime();
const MAX_AGE_MS   = 2 * 24 * 3600 * 1000;
const recencyScore = ts => ts ? Math.max(0, 1 - (generatedAt - new Date(ts).getTime()) / MAX_AGE_MS) : 0;
const recencyLevel = ts => {
  if (!ts) return 0;
  const age = generatedAt - new Date(ts).getTime();
  if (age <  5 * 60 * 1000)        return 3;
  if (age < 15 * 60 * 1000)        return 2;
  if (age <  2 * 24 * 3600 * 1000) return 1;
  return 0;
};

// Project → most-recent session timestamp
const projLastTs = {};
for (const s of DATA.sessions) {
  const ts = s.last_timestamp || s.first_timestamp;
  if (ts && (!projLastTs[s.project_id] || ts > projLastTs[s.project_id]))
    projLastTs[s.project_id] = ts;
}

// ── Build nodes & edges ───────────────────────────────────────────────────────

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
  });
  edges.push({ source: sess.session_id, target: sess.project_id, type: 'membership' });
}

// Branch lineage edges
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

// File nodes
const globalFiles = DATA.rollup?.files || [];
const MAX_FILE_W  = Math.max(1, ...globalFiles.map(f => f.write + f.edit));
const sessById    = {};
DATA.sessions.forEach(s => sessById[s.session_id] = s);

// File → last-touched session timestamp
const fileLastTs = {};
for (const f of globalFiles) {
  fileLastTs[f.path] = f.sessions.map(sid => {
    const s = sessById[sid];
    return s ? (s.last_timestamp || s.first_timestamp) : null;
  }).filter(Boolean).sort().pop() || null;
}

for (const f of globalFiles) {
  if (f.sessions.length < MIN_FILE_SESSIONS) continue;
  if (f.write + f.edit === 0) continue;
  const ext      = (f.path.split('.').pop() || '').toLowerCase().split('?')[0];
  const sizeNorm = Math.sqrt((f.write + f.edit) / MAX_FILE_W);
  const fLastTs  = fileLastTs[f.path] || null;
  const fRecency = recencyScore(fLastTs);
  nodes.push({
    id: f.path, type: 'file', label: f.path.split('/').pop(),
    full_path: f.path, color: EXT_COLORS[ext] || '#666666', ext,
    read: f.read, write: f.write, edit: f.edit,
    session_count: f.sessions.length, sizeNorm,
    last_activity: fLastTs,
    recency:       fRecency,
    recencyLevel:  recencyLevel(fLastTs),
  });
  for (const sessId of f.sessions) {
    const sess = sessById[sessId];
    if (!sess?.file_ops?.[f.path]) continue;
    const ops    = sess.file_ops[f.path];
    const opType = ops.write > 0 ? 'write' : ops.edit > 0 ? 'edit' : 'read';
    edges.push({ source: sessId, target: f.path, type: opType, weight: ops.write + ops.edit + ops.read });
  }
}

const pN = nodes.filter(n => n.type === 'project').length;
const sN = nodes.filter(n => n.type === 'session').length;
const fN = nodes.filter(n => n.type === 'file').length;
console.log(`Graph: ${nodes.length} nodes (${pN} project · ${sN} session · ${fN} file)`);
console.log(`Edges: ${edges.length} (${edges.filter(e=>e.type==='membership').length} membership · ${edges.filter(e=>e.type==='branch').length} branch · ${edges.filter(e=>e.type==='write').length} write · ${edges.filter(e=>e.type==='edit').length} edit)`);

// Timeline data
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

// ── Generate HTML ─────────────────────────────────────────────────────────────

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
#canvas { display: block; }
#tip { position: fixed; pointer-events: none; background: #0c0c1e; border: 1px solid #252540;
  padding: 10px 14px; max-width: 320px; display: none; line-height: 1.6; z-index: 300;
  box-shadow: 0 4px 24px rgba(0,0,0,.7); }
#tip strong { color: #fff; display: block; margin-bottom: 2px; font-size: 12px; }
#tip .meta  { color: #5566aa; }
#tip .body  { color: #8899bb; margin-top: 6px; font-size: 10px; line-height: 1.4; }
#legend { position: fixed; top: 16px; left: 16px; background: rgba(8,8,16,.9);
  border: 1px solid #1c1c34; padding: 12px 16px; min-width: 200px; }
#legend h3 { color: #4455cc; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; }
.leg { display: flex; align-items: center; gap: 8px; margin: 5px 0; color: #667; }
.dot  { width:12px; height:12px; border-radius:50%; flex-shrink:0; }
.dia  { width:10px; height:10px; transform:rotate(45deg); flex-shrink:0; }
.ring { width:12px; height:12px; border-radius:50%; border:2px solid; background:transparent; flex-shrink:0; }
.line { width:22px; height:2px; flex-shrink:0; }
.dash { width:22px; height:1px; border-top:2px dashed; flex-shrink:0; }
.sep  { border-top: 1px solid #1c1c34; margin: 8px 0; }
@keyframes pulse-ring {
  0%   { transform:scale(1);   opacity:var(--po,.7); }
  100% { transform:scale(2.6); opacity:0; }
}
.pring { fill:none; stroke-width:1.5; pointer-events:none;
  animation:pulse-ring linear infinite;
  transform-box:fill-box; transform-origin:center; }
#controls { position: fixed; top: 16px; right: 16px; background: rgba(8,8,16,.9);
  border: 1px solid #1c1c34; padding: 12px 16px; min-width: 220px; }
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
  padding: 20px 18px; display: none; overflow-y: auto; }
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
  background: #06060e; border-top: 1px solid #14142a; overflow: hidden; }
#tl-svg { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<svg id="canvas"></svg>
<div id="tip"></div>
<div id="legend">
  <h3>◆ LEGEND</h3>
  <div class="leg"><div class="dot" style="background:#08081a;border:2px solid #aaa;box-sizing:border-box"></div>Project cluster</div>
  <div class="leg"><div class="dot" style="background:#00aaff;opacity:.85"></div>Session (size = AI work)</div>
  <div class="leg"><div class="dia" style="background:#00cccc"></div>File (size = edits)</div>
  <div class="sep"></div>
  <div class="leg"><div class="line" style="background:#00ff88;opacity:.7"></div>write op</div>
  <div class="leg"><div class="line" style="background:#ffcc00;opacity:.7"></div>edit op</div>
  <div class="leg"><div class="line" style="background:#19304a;opacity:1"></div>membership</div>
  <div class="leg"><div class="dash" style="border-color:#557;opacity:.8"></div>branch lineage</div>
  <div class="sep"></div>
  <div class="leg"><div class="ring" style="border-color:#ff2244"></div>high error (≥8)</div>
  <div class="leg"><div class="ring" style="border-color:#ffcc00"></div>custom skill used</div>
  <div class="leg"><div class="dot" style="background:#fff;width:7px;height:7px;margin:2px 2px"></div>thinking blocks</div>
  <div class="leg"><span style="color:#ff4444;font-size:12px;line-height:1">✕</span>&nbsp;hit max_tokens</div>
</div>
<div id="controls">
  <h3>◆ DISPLAY</h3>
  <div class="ctrl"><input type="checkbox" id="cb-files" checked><label for="cb-files">File nodes</label></div>
  <div class="ctrl"><input type="checkbox" id="cb-branch" checked><label for="cb-branch">Branch lineage edges</label></div>
  <div class="ctrl"><input type="checkbox" id="cb-reads"><label for="cb-reads">Read-only edges</label></div>
  <div class="ctrl">
    <label for="sl-min">File min sessions:</label>
    <input type="range" id="sl-min" min="1" max="12" value="${MIN_FILE_SESSIONS}">
    <span class="val" id="sl-min-val">${MIN_FILE_SESSIONS}</span>
  </div>
  <div class="ctrl"><button class="btn" id="btn-shake">⟳ Shake</button>&nbsp;<button class="btn" id="btn-reset">⌂ Reset</button></div>
</div>
<div id="stats"></div>
<div id="panel"><span id="panel-x" onclick="closePanel()">✕</span><div id="panel-content"></div></div>
<div id="timeline"><svg id="tl-svg"></svg></div>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
let GRAPH    = ${graphJson};
let TIMELINE = ${timelineJson};
const COLOR_TO_INDEX = ${colorIndexJson};

const TL_H = 60;
let W = window.innerWidth, H = window.innerHeight - TL_H;
const PROJ_R = 26, SR_MIN = 5, SR_MAX = 20, FR_MIN = 3, FR_MAX = 13;

function nodeR(d) {
  if (d.type === 'project') return PROJ_R;
  if (d.type === 'session') return SR_MIN + (SR_MAX - SR_MIN) * (d.sizeNorm || 0);
  return FR_MIN + (FR_MAX - FR_MIN) * (d.sizeNorm || 0);
}

const svg  = d3.select('#canvas').attr('width', W).attr('height', H);
const root = svg.append('g');
const zoom = d3.zoom().scaleExtent([0.05, 16]).on('zoom', e => root.attr('transform', e.transform));
svg.call(zoom);
const initialTransform = d3.zoomIdentity.translate(W * 0.12, H * 0.05).scale(0.88);
svg.call(zoom.transform, initialTransform);

const edgeLayer  = root.append('g').attr('id', 'edges');
const nodeLayer  = root.append('g').attr('id', 'nodes');
const labelLayer = root.append('g').attr('id', 'labels');

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

const simulation = d3.forceSimulation(GRAPH.nodes)
  .force('link', d3.forceLink(GRAPH.edges).id(d=>d.id)
    .distance(d=>d.type==='membership'?125:d.type==='branch'?95:d.type==='read'?80:60)
    .strength(d=>d.type==='membership'?.65:d.type==='branch'?.15:d.type==='read'?.08:.3))
  .force('charge', d3.forceManyBody().strength(d=>d.type==='project'?-700:d.type==='session'?-130:-55))
  .force('collision', d3.forceCollide(d=>nodeR(d)+4).strength(0.85))
  .alphaDecay(0.006).velocityDecay(0.38);

const EC = {membership:'#162035',write:'#00ff88',edit:'#ffcc00',read:'#102030',branch:'#334455'};
const EO = {membership:.55,write:.65,edit:.65,read:.28,branch:.4};
const EW = {membership:1.4,write:1,edit:1,read:.7,branch:.8};
const edgeKey = e => \`\${e.source?.id??e.source}::\${e.type}::\${e.target?.id??e.target}\`;

function styleEdge(sel) {
  return sel.attr('stroke',d=>EC[d.type]||'#222').attr('stroke-opacity',d=>EO[d.type]||.3)
    .attr('stroke-width',d=>EW[d.type]||1).attr('stroke-dasharray',d=>d.type==='branch'?'5 3':null)
    .attr('class',d=>'e-'+d.type);
}

let edgeSel = edgeLayer.selectAll('line').data(GRAPH.edges, edgeKey)
  .join(enter => enter.append('line').call(styleEdge));

const nodeById = {};
GRAPH.nodes.forEach(n => nodeById[n.id] = n);

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
    if (d.errorLevel===2) el.append('circle').attr('r',r+6).attr('fill','none').attr('stroke','#ff2244').attr('stroke-width',1.5).attr('stroke-opacity',.7);
    else if (d.errorLevel===1) el.append('circle').attr('r',r+4).attr('fill','none').attr('stroke','#ff6633').attr('stroke-width',1).attr('stroke-opacity',.5);
    if (d.skills?.length) el.append('circle').attr('r',r+4).attr('fill','none').attr('stroke','#ffcc00').attr('stroke-width',1).attr('stroke-opacity',.6).attr('stroke-dasharray','3 2');
    el.append('circle').attr('r',r).attr('fill',d.color).attr('fill-opacity',.83).attr('stroke','#000').attr('stroke-width',.4);
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

const drag = d3.drag()
  .on('start',(ev,d)=>{ if(!ev.active) simulation.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
  .on('drag', (ev,d)=>{ d.fx=ev.x; d.fy=ev.y; })
  .on('end',  (ev,d)=>{ if(!ev.active) simulation.alphaTarget(0); if(d.type!=='project'){d.fx=null;d.fy=null;} });

simulation.on('tick', () => {
  edgeSel.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
  nodeSel.attr('transform', d=>\`translate(\${d.x},\${d.y})\`);
  projLabelSel.attr('x',d=>d.x).attr('y',d=>d.y+PROJ_R+13);
});

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

let selectedId = null;
function neighbours(id) {
  const s=new Set([id]);
  GRAPH.edges.forEach(e=>{ const a=e.source?.id??e.source,b=e.target?.id??e.target; if(a===id)s.add(b);if(b===id)s.add(a); });
  return s;
}
function highlight(id) {
  if (!id) { nodeSel.attr('opacity',1); edgeSel.attr('stroke-opacity',d=>EO[d.type]||.3); d3.selectAll('.tl-dot').attr('opacity',1); return; }
  const nb=neighbours(id);
  nodeSel.attr('opacity',d=>nb.has(d.id)?1:.05);
  edgeSel.attr('stroke-opacity',e=>{ const a=e.source?.id??e.source,b=e.target?.id??e.target; return (a===id||b===id)?Math.min(1,(EO[e.type]||.3)*2):.025; });
  d3.selectAll('.tl-dot').attr('opacity',d=>d.id===id?1:.2);
}

function attachClick(sel) {
  sel.on('click',(ev,d)=>{ ev.stopPropagation(); if(selectedId===d.id){selectedId=null;highlight(null);closePanel();}else{selectedId=d.id;highlight(d.id);showPanel(d);} });
}
attachClick(nodeSel);
svg.on('click',()=>{ selectedId=null;highlight(null);closePanel(); });

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

document.getElementById('cb-files').addEventListener('change', function() {
  nodeSel.filter(n=>n.type==='file').attr('display',this.checked?null:'none');
  edgeSel.filter(e=>nodeById[e.target?.id??e.target]?.type==='file').attr('display',this.checked?null:'none');
});
document.getElementById('cb-branch').addEventListener('change', function() { edgeSel.filter(e=>e.type==='branch').attr('display',this.checked?null:'none'); });
document.getElementById('cb-reads').addEventListener('change', function() { edgeSel.filter(e=>e.type==='read').attr('display',this.checked?null:'none'); });
document.getElementById('sl-min').addEventListener('input', function() {
  const val=+this.value; document.getElementById('sl-min-val').textContent=val;
  const hide=new Set(GRAPH.nodes.filter(n=>n.type==='file'&&n.session_count<val).map(n=>n.id));
  nodeSel.filter(n=>n.type==='file').attr('display',n=>hide.has(n.id)?'none':null);
  edgeSel.attr('display',e=>{ const t=e.target?.id??e.target; return hide.has(t)?'none':null; });
});
document.getElementById('btn-shake').addEventListener('click', ()=> simulation.alpha(.4).restart());
document.getElementById('btn-reset').addEventListener('click', ()=> svg.transition().duration(600).call(zoom.transform, initialTransform));
edgeSel.filter(e=>e.type==='read').attr('display','none');

function updateStats() {
  const dr=GRAPH.meta.date_range;
  document.getElementById('stats').textContent=
    \`\${GRAPH.nodes.filter(n=>n.type==='project').length} projects · \${GRAPH.nodes.filter(n=>n.type==='session').length} sessions · \${GRAPH.nodes.filter(n=>n.type==='file').length} files · \${GRAPH.edges.length} edges · \${dr.first.slice(0,10)} → \${dr.last.slice(0,10)}\`;
}
updateStats();

function buildTimeline() {
  const tlSvg=d3.select('#tl-svg'), tw=window.innerWidth, th=TL_H;
  tlSvg.attr('width',tw).attr('height',th);
  const dates=TIMELINE.map(d=>new Date(d.ts));
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
        const t=d3.zoomTransform(svg.node()),nx=node.x*t.k+t.x,ny=node.y*t.k+t.y;
        svg.transition().duration(500).call(zoom.translateBy,(W/2-nx)/t.k,(H/2-ny)/t.k); } });
}
buildTimeline();
nodeSel.call(drag);

window.updateGraph = function(newData) {
  const posById={};
  simulation.nodes().forEach(n=>{ posById[n.id]={x:n.x,y:n.y,vx:n.vx||0,vy:n.vy||0,fx:n.fx,fy:n.fy}; });
  newData.nodes.forEach(n=>{ if(posById[n.id]) Object.assign(n,posById[n.id]); });
  seedPositions(newData);
  GRAPH=newData; TIMELINE=newData.timeline||TIMELINE;
  GRAPH.nodes.forEach(n=>nodeById[n.id]=n);
  simulation.nodes(GRAPH.nodes);
  simulation.force('link').links(GRAPH.edges);
  edgeSel=edgeLayer.selectAll('line').data(GRAPH.edges,edgeKey).join(enter=>enter.append('line').call(styleEdge),update=>update,exit=>exit.remove());
  nodeSel=joinNodes(GRAPH); nodeSel.call(drag); attachTooltip(nodeSel); attachClick(nodeSel);
  projLabelSel=labelLayer.selectAll('text.pl').data(GRAPH.nodes.filter(n=>n.type==='project'),d=>d.id)
    .join('text').attr('class','pl').attr('text-anchor','middle').attr('fill',d=>d.color)
    .attr('font-size',9).attr('letter-spacing',1).attr('pointer-events','none').text(d=>d.label.toUpperCase());
  simulation.alpha(.18).restart();
  buildTimeline(); updateStats();
  if(!document.getElementById('cb-files').checked){nodeSel.filter(n=>n.type==='file').attr('display','none');edgeSel.filter(e=>nodeById[e.target?.id??e.target]?.type==='file').attr('display','none');}
  if(!document.getElementById('cb-branch').checked){edgeSel.filter(e=>e.type==='branch').attr('display','none');}
  edgeSel.filter(e=>e.type==='read').attr('display','none');
};

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

window.addEventListener('resize',()=>{ W=window.innerWidth;H=window.innerHeight-TL_H; svg.attr('width',W).attr('height',H); d3.select('#tl-svg').attr('width',W); });
</script>
</body>
</html>`;

const outPath = path.join(CWD, 'graph.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Written: ${outPath}  (${(html.length/1024).toFixed(0)} KB)`);
