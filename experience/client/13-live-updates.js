// â”€â”€ Live graph updates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  buildTimeline(); updateStats(); buildFilterControls(); applyFilters();
};

// â”€â”€ Live status badge + pulse ticker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (window.location.protocol==='http:'||window.location.protocol==='https:') {
  const badge=document.createElement('div');
  badge.style.cssText='position:fixed;top:8px;right:12px;background:'+KAARO_TOKENS.geo+';color:#000;font:bold 10px \'IBM Plex Mono\',monospace;padding:3px 8px;z-index:9998;cursor:default;user-select:none;transition:background 0.15s';
  badge.title='Live â€” updates when sessions change'; document.body.appendChild(badge);
  function setBadge(t,c){badge.textContent=t;badge.style.background=c;}
  setBadge('â¬¤ LIVE','#00ff88');

  // Pulse ticker â€” scrolling feed of recent tool events
  const TICKER_MAX_EPH    = 20;
  const TICKER_MAX_STICKY = 500;
  let tickerSticky = localStorage.getItem('kaaro-ticker-sticky') === '1';

  const ticker = document.createElement('ul');
  ticker.id = 'pulse-ticker';
  document.body.appendChild(ticker);

  const pinBtn = document.createElement('div');
  pinBtn.id = 'ticker-pin';
  document.body.appendChild(pinBtn);

  function _applyTickerMode() {
    ticker.classList.toggle('sticky', tickerSticky);
    pinBtn.classList.toggle('on', tickerSticky);
    pinBtn.textContent = tickerSticky ? 'âŠŸ TICKER' : 'âŠž TICKER';
    pinBtn.title = tickerSticky ? 'Unpin ticker (clear history)' : 'Pin ticker to keep history';
    if (!tickerSticky) ticker.replaceChildren();
    else ticker.scrollTop = ticker.scrollHeight;
  }
  _applyTickerMode();

  pinBtn.addEventListener('click', () => {
    tickerSticky = !tickerSticky;
    localStorage.setItem('kaaro-ticker-sticky', tickerSticky ? '1' : '0');
    _applyTickerMode();
  });

  function tickerAdd(text, color) {
    const li = document.createElement('li');
    li.className = 'pulse-entry';
    li.style.color = color || KAARO_TOKENS.dim;
    li.textContent = text;
    ticker.appendChild(li);
    const max = tickerSticky ? TICKER_MAX_STICKY : TICKER_MAX_EPH;
    while (ticker.children.length > max) ticker.removeChild(ticker.firstChild);
    if (tickerSticky) {
      ticker.scrollTop = ticker.scrollHeight;
    } else {
      setTimeout(() => { li.classList.add('fading'); setTimeout(() => li.remove(), 500); }, 4500);
    }
  }

  const es=new EventSource('/events');

  es.addEventListener('updated',async()=>{
    setBadge('â—Œ updatingâ€¦','#555');
    try{
      const r=await fetch('/graph-data.json?t='+Date.now());
      const d=await r.json();
      window.updateGraph(d);
      setBadge('â†» '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),'#00cc66');
      setTimeout(()=>setBadge('â¬¤ LIVE','#00ff88'),3000);
    }catch(e){setBadge('âš  error',KAARO_TOKENS.err);}
  });

  es.addEventListener('status',e=>{ if(e.data==='rebuilding') setBadge('â—Œ buildingâ€¦','#555'); });
  es.addEventListener('error',e=>{
    if(!e.data) return; // EventSource transport errors have no data; SSE error events do
    setBadge('âš  build failed',KAARO_TOKENS.err);
    tickerAdd('âœ– rebuild failed: '+String(e.data).slice(0,60),KAARO_TOKENS.err);
  });
  es.onerror=()=>setBadge('â—Œ reconnecting','#888');
  es.onopen=()=>setBadge('â¬¤ LIVE','#00ff88');

  es.addEventListener('tool_call',e=>{
    try{
      const d=JSON.parse(e.data);
      const projNode=GRAPH.nodes.find(n=>n.type==='project'&&n.label===d.project);
      const color=projNode?.color||KAARO_TOKENS.dim;
      const file=d.where? ' Â· '+(d.where.replace(/\\/g,'/').split('/').pop()||d.where).slice(0,28) :'';
      tickerAdd(d.tool+file+'  ['+d.slug+']', color);
      if(window.playPulse) window.playPulse('tool_call',d);
    }catch{}
  });

  es.addEventListener('tokens',e=>{
    try{
      const d=JSON.parse(e.data);
      if(window.playPulse) window.playPulse('tokens',d);
    }catch{}
  });

  es.addEventListener('words',e=>{
    try{
      const d=JSON.parse(e.data);
      tickerAdd('"'+d.preview.slice(0,52)+'"  ['+d.slug+']',KAARO_TOKENS.dim);
      if(window.playPulse) window.playPulse('words',d);
    }catch{}
  });

  // ── Cognition pulses: human presence, structure, failures (W-COG) ──────────
  const ROLE_COLORS = {
    err:     KAARO_TOKENS.err,
    human:   KAARO_TOKENS.select,
    context: KAARO_TOKENS.label,
    dim:     KAARO_TOKENS.dim,
  };
  for (const cogEvent of ['human_turn','compact','permission','mode_shift','tool_error','api_error','chirp','attachment','scaffold']) {
    es.addEventListener(cogEvent, e => {
      try {
        const d = JSON.parse(e.data);
        const entry = pulseTickerEntry(cogEvent, d);
        if (entry) tickerAdd(entry.text, ROLE_COLORS[entry.role] || KAARO_TOKENS.dim);
        if (window.playPulse) window.playPulse(cogEvent, d);
      } catch {}
    });
  }
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
