// ── Force layout ──────────────────────────────────────────────────────────────
function restoreForceLayout() {
  const p = getForceParams();
  GRAPH.nodes.forEach(n => { if (n.type !== 'project') { n.fx = null; n.fy = null; } });
  GRAPH.nodes.filter(n => n.type === 'project').forEach(proj => {
    const pos = projPos[proj.id]; if (pos) { proj.fx = pos.x; proj.fy = pos.y; }
  });
  simulation
    .force('link',      makeForceLink())
    .force('charge',    d3.forceManyBody().strength(d=>d.type==='project'?-700:d.type==='session'? p.sessionCharge : p.fileCharge))
    .force('collision', d3.forceCollide(d=>nodeR(d)+4).strength(0.85))
    .velocityDecay(p.velocityDecay);
  if (document.getElementById('cb-group').checked) {
    simulation
      .force('gx', d3.forceX(d=>{ const proj=projPos[d.project_id]; return proj?.x??W/2; }).strength(d=>d.type==='project'?0:0.06))
      .force('gy', d3.forceY(d=>{ const proj=projPos[d.project_id]; return proj?.y??H/2; }).strength(d=>d.type==='project'?0:0.06));
  } else {
    simulation.force('gx', null).force('gy', null);
  }
}
