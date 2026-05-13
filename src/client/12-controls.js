// ── Filters ───────────────────────────────────────────────────────────────────
function applyFilters() {
  if (currentLayout === 'matrix')   { renderMatrix();   return; }
  if (currentLayout === '3d')       { layout3D.exit(); layout3D.enter(); return; }
  if (currentLayout === 'swimlane') { renderSwimlane(); return; }
  if (currentLayout === 'arc') {
    nodeSel.attr('display', d => {
      if (d.type !== 'session') return 'none';
      if (tlFrom && d.date_str && d.date_str < tlFrom) return 'none';
      return null;
    });
    edgeSel.attr('display', 'none');
    projLabelSel.attr('display', 'none');
    if (arcXScale) drawArcArcs();
    return;
  }

  const showFiles   = document.getElementById('cb-files').checked;
  const showRoFiles = document.getElementById('cb-ro-files').checked;
  const showBranch  = document.getElementById('cb-branch').checked;
  const showReads   = document.getElementById('cb-reads').checked;
  const minSess     = +document.getElementById('sl-min').value;
  const hiddenNodes = new Set();
  nodeSel.attr('display', d => {
    if (d.type === 'session') {
      if (tlFrom && d.date_str && d.date_str < tlFrom) { hiddenNodes.add(d.id); return 'none'; }
      return null;
    }
    if (d.type === 'file') {
      if (!showFiles)                                    { hiddenNodes.add(d.id); return 'none'; }
      if (d.session_count < minSess)                     { hiddenNodes.add(d.id); return 'none'; }
      if (!showRoFiles && d.write === 0 && d.edit === 0) { hiddenNodes.add(d.id); return 'none'; }
      return null;
    }
    return null;
  });
  edgeSel.attr('display', e => {
    const src=e.source?.id??e.source, tgt=e.target?.id??e.target;
    if (hiddenNodes.has(src)||hiddenNodes.has(tgt)) return 'none';
    if (e.type==='read'   && !showReads)  return 'none';
    if (e.type==='branch' && !showBranch) return 'none';
    return null;
  });
  projLabelSel.attr('display', null);
}

// General controls
document.getElementById('cb-files').addEventListener('change',    applyFilters);
document.getElementById('cb-ro-files').addEventListener('change', applyFilters);
document.getElementById('cb-branch').addEventListener('change',   applyFilters);
document.getElementById('cb-reads').addEventListener('change',    applyFilters);
document.getElementById('cb-group').addEventListener('change', () => {
  if (currentLayout==='force') { restoreForceLayout(); simulation.alpha(0.3).restart(); }
});
document.getElementById('sl-min').addEventListener('input', function() {
  document.getElementById('sl-min-val').textContent = this.value; applyFilters();
});
document.getElementById('tf-from').addEventListener('change', function() {
  tlFrom = this.value || null; applyFilters();
  if (currentLayout==='arc') { computeArcPositions(); drawArcDecor(); applyStaticPositions(); }
});
document.getElementById('tf-clear').addEventListener('click', () => {
  document.getElementById('tf-from').value=''; tlFrom=null; applyFilters();
});
document.getElementById('btn-shake').addEventListener('click', ()=>{ if(currentLayout==='force') simulation.alpha(.4).restart(); });
document.getElementById('btn-reset').addEventListener('click', ()=>svg.transition().duration(600).call(zoom.transform, initialTransform));
document.getElementById('btn-fit').addEventListener('click', () => {
  if (currentLayout==='swimlane'||currentLayout==='matrix') return;
  const vis=GRAPH.nodes.filter(n=>n.x!=null&&n.y!=null);
  if (!vis.length) return;
  const x0=d3.min(vis,d=>d.x)-30,x1=d3.max(vis,d=>d.x)+30;
  const y0=d3.min(vis,d=>d.y)-30,y1=d3.max(vis,d=>d.y)+30;
  const scale=Math.min(8,0.9/Math.max((x1-x0)/W,(y1-y0)/H));
  svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(W/2-scale*(x0+x1)/2,H/2-scale*(y0+y1)/2).scale(scale));
});

// Swimlane-specific controls
['sl-height-sel','sl-width-sel','sl-color-sel','sl-order-sel','sl-grid-sel','sl-label-sel'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', ()=>{ if(currentLayout==='swimlane') renderSwimlane(); });
});
['sl-subbranch','sl-blabels'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', ()=>{ if(currentLayout==='swimlane') renderSwimlane(); });
});
applyFilters();

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const dr=GRAPH.meta.date_range;
  document.getElementById('stats').textContent=
    `${GRAPH.nodes.filter(n=>n.type==='project').length} projects · ${GRAPH.nodes.filter(n=>n.type==='session').length} sessions · ${GRAPH.nodes.filter(n=>n.type==='file').length} files · ${GRAPH.edges.length} edges · ${dr.first.slice(0,10)} → ${dr.last.slice(0,10)}`;
}
updateStats();

// ── Timeline ──────────────────────────────────────────────────────────────────
function buildTimeline() {
  const tlSvg=d3.select('#tl-svg'),tw=window.innerWidth,th=TL_H;
  tlSvg.attr('width',tw).attr('height',th);
  const dates=TIMELINE.map(d=>new Date(d.ts));
  if(!dates.length) return;
  const xScale=d3.scaleTime().domain([d3.min(dates),d3.max(dates)]).range([40,tw-40]);
  const days=d3.timeDay.range(d3.min(dates),d3.timeDay.offset(d3.max(dates),1));
  tlSvg.selectAll('line.tl-tick').data(days).join('line').attr('class','tl-tick').attr('x1',d=>xScale(d)).attr('x2',d=>xScale(d)).attr('y1',th-20).attr('y2',th-4).attr('stroke','#1a1a2e').attr('stroke-width',1);
  tlSvg.selectAll('text.tl-label').data(days.filter((_,i)=>i%3===0)).join('text').attr('class','tl-label').attr('x',d=>xScale(d)).attr('y',th-22).attr('text-anchor','middle').attr('font-size',8).attr('fill','#2a2a44').attr('font-family','Courier New,monospace').text(d=>d3.timeFormat('%m/%d')(d));
  tlSvg.selectAll('line.tl-base').data([0]).join('line').attr('class','tl-base').attr('x1',40).attr('x2',tw-40).attr('y1',th-20).attr('y2',th-20).attr('stroke','#14142a').attr('stroke-width',1);
  const maxWork=Math.max(...TIMELINE.map(t=>t.tokens_work||1));
  tlSvg.selectAll('circle.tl-dot').data(TIMELINE,d=>d.id).join('circle').attr('class','tl-dot')
    .attr('cx',d=>xScale(new Date(d.ts)))
    .attr('cy',d=>{const idx=COLOR_TO_INDEX[d.color]??0;return th-28-(idx%5)*4;})
    .attr('r',d=>3+4*Math.sqrt(d.tokens_work/maxWork))
    .attr('fill',d=>d.color).attr('fill-opacity',.85)
    .attr('stroke',d=>d.tool_errors>=8?'#ff2244':'none').attr('stroke-width',1.5).style('cursor','pointer')
    .on('mouseover',(ev,d)=>{tip.style.display='block';tip.innerHTML=`<strong style="color:${d.color}">${d.slug}</strong><div class="meta">${d.date_str} · ${d.project}</div><div class="meta">AI work: ${fmtT(d.tokens_work)}</div>${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}`;})
    .on('mousemove',ev=>{tip.style.left=Math.min(ev.clientX+16,W-340)+'px';tip.style.top=(ev.clientY-tip.offsetHeight-10)+'px';})
    .on('mouseout',()=>tip.style.display='none')
    .on('click',(ev,d)=>{
      ev.stopPropagation();
      const node=nodeById[d.id]; if(!node) return;
      if(selectedId===d.id){selectedId=null;if(currentLayout==='swimlane')slHighlight(null);else highlight(null);closePanel();}
      else {
        selectedId=d.id;
        if (currentLayout==='swimlane') {
          slHighlight(d.id); showPanel(node);
          const bp=slBarPos[d.id];
          if(bp){const t=d3.zoomTransform(svg.node());const cx=bp.x+bp.w/2,cy=bp.y+bp.h/2;const nx=cx*t.k+t.x,ny=cy*t.k+t.y;svg.transition().duration(500).call(zoom.translateBy,(W/2-nx)/t.k,(H/2-ny)/t.k);}
        } else {
          highlight(d.id); showPanel(node);
          if(currentLayout==='force'||currentLayout==='arc'){const t=d3.zoomTransform(svg.node()),nx=node.x*t.k+t.x,ny=node.y*t.k+t.y;svg.transition().duration(500).call(zoom.translateBy,(W/2-nx)/t.k,(H/2-ny)/t.k);}
        }
      }
    });
}

function toggleWidget(id) {
  const el=document.getElementById(id);
  const col=el.classList.toggle('collapsed');
  el.querySelector('.widget-toggle').textContent=col?'+':'−';
}

// ── Arc-specific controls ─────────────────────────────────────────────────────
function refreshArc() {
  if (currentLayout !== 'arc') return;
  computeArcPositions(); drawArcDecor(); applyStaticPositions(); applyFilters();
}

document.getElementById('arc-mode')?.addEventListener('change', () => {
  focusedArcFileId = null; refreshArc();
});
document.getElementById('arc-color-by')?.addEventListener('change', refreshArc);
document.getElementById('arc-group-proj')?.addEventListener('change', refreshArc);

document.getElementById('arc-min-shared')?.addEventListener('input', function() {
  document.getElementById('arc-min-val').textContent = this.value; refreshArc();
});
document.getElementById('arc-max-span')?.addEventListener('input', function() {
  const v = +this.value;
  document.getElementById('arc-span-val').textContent = v >= 365 ? 'All' : v + 'd';
  refreshArc();
});

buildTimeline();
nodeSel.call(drag);
