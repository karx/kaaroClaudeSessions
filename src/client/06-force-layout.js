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
