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

// ── Live status badge ─────────────────────────────────────────────────────────
if (window.location.protocol==='http:'||window.location.protocol==='https:') {
  const badge=document.createElement('div');
  badge.style.cssText='position:fixed;top:8px;right:12px;background:#00ff88;color:#000;font:bold 10px monospace;padding:3px 8px;z-index:9998;cursor:default;user-select:none;transition:background 0.15s';
  badge.title='Live — updates when sessions change'; document.body.appendChild(badge);
  function setBadge(t,c){badge.textContent=t;badge.style.background=c;}
  setBadge('⬤ LIVE','#00ff88');
  const es=new EventSource('/events');
  es.addEventListener('updated',async()=>{setBadge('◌ updating…','#555');try{const r=await fetch('/graph-data.json?t='+Date.now());const d=await r.json();window.updateGraph(d);setBadge('↻ '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),'#00cc66');setTimeout(()=>setBadge('⬤ LIVE','#00ff88'),3000);}catch(e){setBadge('⚠ error','#ff4444');}});
  es.addEventListener('status',e=>{if(e.data==='rebuilding')setBadge('◌ building…','#555');});
  es.onerror=()=>setBadge('◌ reconnecting','#888');
  es.onopen=()=>setBadge('⬤ LIVE','#00ff88');
}

bootComplete();

window.addEventListener('resize',()=>{
  W=window.innerWidth; H=window.innerHeight-TL_H;
  svg.attr('width',W).attr('height',H);
  d3.select('#tl-svg').attr('width',W);
  if(currentLayout==='3d'&&layout3D._g) layout3D._g.width(W).height(H);
  if(currentLayout==='swimlane') renderSwimlane();
  if(currentLayout==='arc')      {computeArcPositions();drawArcDecor();applyStaticPositions();}
  if(currentLayout==='matrix')   renderMatrix();
});
