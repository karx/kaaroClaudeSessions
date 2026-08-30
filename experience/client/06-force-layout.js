// ── Force layout ──────────────────────────────────────────────────────────────
function restoreForceLayout() {
  const p = getForceParams();
  const pinGrid = (currentLayout === 'grid' || document.getElementById('cb-pin-grid')?.checked)
    && typeof window.glyphBoardPins === 'function';
  const gridPins = pinGrid ? window.glyphBoardPins(W, H) : null;

  if (currentLayout === 'grid') {
    const cfg = seatForceConfig();
    GRAPH.nodes.forEach(n => {
      if (n.type === 'project' && cfg.pinProjects && gridPins && gridPins[n.id]) {
        const pos = gridPins[n.id];
        n.fx = pos.x; n.fy = pos.y;
        projPos[n.id] = { x: pos.x, y: pos.y };
      } else {
        n.fx = null; n.fy = null;
      }
    });
    if (cfg.includeFiles) seatPinScaffold(gridPins);
    simulation
      .force('link', null)
      .force('charge', null)
      .force('center', null)
      .force('gx', null)
      .force('gy', null)
      .force('collision', d3.forceCollide(d =>
        d.type === 'project'
          ? seatFootprintR(GLYPH_GRAPH_R, d.sizeNorm) + 6
          : nodeRadius(d) + 4
      ).strength(0.9))
      .velocityDecay(p.velocityDecay);
    return;
  }

  const prof = forceProfile(pinGrid ? false : (document.getElementById('fp-free')?.checked || false));
  GRAPH.nodes.forEach(n => { if (n.type !== 'project') { n.fx = null; n.fy = null; } });
  GRAPH.nodes.filter(n => n.type === 'project').forEach(proj => {
    if (gridPins && gridPins[proj.id]) {
      const pos = gridPins[proj.id];
      proj.fx = pos.x; proj.fy = pos.y;
      projPos[proj.id] = { x: pos.x, y: pos.y };
    } else if (prof.projectPinned) {
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

function seatPinScaffold(gridPins) {
  const city = window._seatCity;
  if (!city || !gridPins) return;
  const claimed = new Set();
  for (const b of city.buildings) {
    const pin = gridPins[b.id];
    if (!pin) continue;
    const files = b.scaffold || [];
    const n = files.length;
    if (!n) continue;
    const hexR = seatFootprintR(GLYPH_GRAPH_R, b.sizeNorm);
    files.forEach((f, i) => {
      const node = nodeById[f.path];
      if (!node || claimed.has(node.id)) return;
      claimed.add(node.id);
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const rad = hexR + 18 + nodeRadius(node);
      node.fx = pin.x + rad * Math.cos(a);
      node.fy = pin.y + rad * Math.sin(a);
      node.x = node.fx;
      node.y = node.fy;
    });
  }
}
