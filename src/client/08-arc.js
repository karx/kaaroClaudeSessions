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
  nodeSel.attr('transform', d=>`translate(${d.x??0},${d.y??0})`);
  edgeSel.attr('d', edgePathD);
  projLabelSel.attr('x', d=>d.x??0).attr('y', d=>(d.y??0)+PROJ_R+13);
}
