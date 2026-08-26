// ── D3 simulation ─────────────────────────────────────────────────────────────
const projPos = {};
function seedPositions(graphData) {
  const pnodes = graphData.nodes.filter(n => n.type === 'project');
  pnodes.forEach((p, i) => {
    // Already positioned (live sim state carried over by updateGraph, or a prior
    // seed) — refresh the anchor cache from it but don't clobber x/y/fx/fy.
    // Free-layout mode relies on this: otherwise every live update snaps
    // projects back to their original ring position. restoreForceLayout()
    // owns fx/fy for the current profile after this runs.
    if (p.x != null) { projPos[p.id] = { x: p.x, y: p.y }; return; }
    if (projPos[p.id]) { p.x = projPos[p.id].x; p.y = projPos[p.id].y; }
    else { const a = (i / pnodes.length) * 2 * Math.PI - Math.PI / 2; p.x = W*.5 + 240*Math.cos(a); p.y = H*.5 + 210*Math.sin(a); }
    p.fx = p.x; p.fy = p.y; projPos[p.id] = { x: p.x, y: p.y };
  });
  const cm = {}; graphData.nodes.filter(n=>n.type==='cluster').forEach(c=>cm[c.id]=c);
  graphData.nodes.filter(n=>n.type==='cluster').forEach(c => {
    if (c.x != null) return;
    const pp = projPos[c.project_id]||{x:W/2,y:H/2};
    c.x = pp.x+(Math.random()-.5)*160; c.y = pp.y+(Math.random()-.5)*160;
  });
  const sm = {}; graphData.nodes.filter(n=>n.type==='session').forEach(s=>sm[s.id]=s);
  graphData.nodes.filter(n=>n.type==='session').forEach(s => {
    if (s.x != null) return;
    const anchor = (s.cluster_id && cm[s.cluster_id]) || projPos[s.project_id] || {x:W/2,y:H/2};
    s.x = anchor.x+(Math.random()-.5)*120; s.y = anchor.y+(Math.random()-.5)*120;
  });
  graphData.nodes.filter(n=>n.type==='file').forEach(f => {
    if (f.x != null) return;
    const linked = graphData.edges.filter(e=>e.target===f.id||e.source===f.id).map(e=>sm[e.source===f.id?e.target:e.source]).filter(Boolean);
    f.x = linked.length ? linked.reduce((s,n)=>s+n.x,0)/linked.length+(Math.random()-.5)*50 : W/2+(Math.random()-.5)*300;
    f.y = linked.length ? linked.reduce((s,n)=>s+n.y,0)/linked.length+(Math.random()-.5)*50 : H/2+(Math.random()-.5)*300;
  });
}
seedPositions(GRAPH);

function getForceParams() {
  const v = id => { const el = document.getElementById(id); return el ? +el.value : null; };
  return {
    sessionCharge:  v('fp-charge-s')  ?? -130,
    fileCharge:     v('fp-charge-f')  ?? -55,
    membershipDist: v('fp-link-m')    ?? 125,
    fileDist:       v('fp-link-f')    ?? 60,
    velocityDecay:  (v('fp-vdecay')   ?? 38) / 100,
  };
}

function makeForceLink(edges, membershipStrength = 0.65) {
  const p = getForceParams();
  return d3.forceLink(edges != null ? edges : GRAPH.edges).id(d=>d.id)
    .distance(d=>d.type==='membership'? p.membershipDist :d.type==='bundle'?45:d.type==='branch'?95:d.type==='read'?80: p.fileDist)
    .strength(d=>d.type==='membership'? membershipStrength :d.type==='bundle'?.5:d.type==='branch'?.15:d.type==='read'?.08:.3);
}

const simulation = d3.forceSimulation(GRAPH.nodes)
  .force('link',      makeForceLink())
  .force('charge',    d3.forceManyBody().strength(d=>d.type==='project'?-700:d.type==='cluster'?-300:d.type==='session'?-130:-55))
  .force('collision', d3.forceCollide(d=>nodeRadius(d)+4).strength(0.85))
  .alphaDecay(SIM_ALPHA_DECAY).velocityDecay(0.38);
