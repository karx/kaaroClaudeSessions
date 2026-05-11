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
