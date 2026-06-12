// â”€â”€ Force layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function restoreForceLayout() {
  const p = getForceParams();
  const prof = forceProfile(document.getElementById('fp-free')?.checked || false);
  GRAPH.nodes.forEach(n => { if (n.type !== 'project') { n.fx = null; n.fy = null; } });
  GRAPH.nodes.filter(n => n.type === 'project').forEach(proj => {
    if (prof.projectPinned) {
      const pos = projPos[proj.id]; if (pos) { proj.fx = pos.x; proj.fy = pos.y; }
    } else {
      proj.fx = null; proj.fy = null;
    }
  });
  simulation
    .force('link',      makeForceLink(undefined, prof.membershipStrength))
    .force('charge',    d3.forceManyBody().strength(d=>d.type==='project'? prof.projectCharge :d.type==='session'? p.sessionCharge : p.fileCharge))
    .force('collision', d3.forceCollide(d=>nodeRadius(d)+4).strength(0.85))
    .force('center',    prof.center ? d3.forceCenter(W/2, H/2) : null)
    .velocityDecay(p.velocityDecay);
  const grouping = prof.grouping ?? document.getElementById('cb-group').checked;
  if (grouping) {
    simulation
      .force('gx', d3.forceX(d=>{ const proj=projPos[d.project_id]; return proj?.x??W/2; }).strength(d=>d.type==='project'?0:0.06))
      .force('gy', d3.forceY(d=>{ const proj=projPos[d.project_id]; return proj?.y??H/2; }).strength(d=>d.type==='project'?0:0.06));
  } else {
    simulation.force('gx', null).force('gy', null);
  }
}
