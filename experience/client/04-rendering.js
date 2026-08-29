// ── Edge rendering ────────────────────────────────────────────────────────────
let currentLayout = 'force';
function isSimLayout() { return currentLayout === 'force' || currentLayout === 'grid'; }

function edgePathD(d) {
  const sx = d.source.x ?? 0, sy = d.source.y ?? 0;
  const tx = d.target.x ?? 0, ty = d.target.y ?? 0;
  if (currentLayout === 'arc') {
    if (d.type === 'branch') {
      const mx = (sx + tx) / 2, span = Math.abs(tx - sx);
      return `M${sx},${sy} Q${mx},${sy - Math.min(span * 0.45, 140)} ${tx},${ty}`;
    }
    if (d.type === 'write' || d.type === 'edit' || d.type === 'read') {
      const mx = (sx + tx) / 2, span = Math.abs(tx - sx) + Math.abs(ty - sy);
      return `M${sx},${sy} Q${mx},${sy + Math.min(span * 0.3, 90)} ${tx},${ty}`;
    }
  }
  return `M${sx},${sy} L${tx},${ty}`;
}

const edgeKey = e => `${e.source?.id??e.source}::${e.type}::${e.target?.id??e.target}`;

function styleEdge(sel) {
  return sel
    .attr('stroke',         d => EDGE_COLORS[d.type] || '#222')
    .attr('stroke-opacity', d => edgeOpacity(d, MAX_WEIGHT))
    .attr('stroke-width',   d => edgeWidth(d, MAX_WEIGHT))
    .attr('stroke-dasharray', d => d.type==='branch'?'5 3':d.type==='read'?'2 4':d.type==='spawn'?'3 3':null)
    .attr('fill', 'none')
    .attr('class', d => 'e-' + d.type);
}

let edgeSel = edgeLayer.selectAll('path').data(GRAPH.edges, edgeKey)
  .join(enter => enter.append('path').call(styleEdge));

const nodeById = {};
GRAPH.nodes.forEach(n => nodeById[n.id] = n);

// ── Node rendering ────────────────────────────────────────────────────────────
function renderNodeContent(el, d) {
  const r = nodeRadius(d);
  // recencyLevel 1 ("< 2 days") is a static hairline — infinite CSS pulses
  // on a week of sessions is the compositor tax. One ring from level 2 up.
  if (d.recencyLevel === 1) {
    el.append('circle').attr('r', r + (d.type==='project'?6:5))
      .attr('fill','none').attr('stroke',d.color).attr('stroke-width',1).attr('stroke-opacity',.2)
      .attr('pointer-events','none');
  } else if (d.recencyLevel > 1) {
    const spd=['','','2.4s','1.4s'][d.recencyLevel];
    const opa=['','','0.45','0.75'][d.recencyLevel];
    const pr=r+(d.type==='project'?6:5);
    el.append('circle').attr('class','pring').attr('r',pr).attr('stroke',d.color)
      .style('animation-duration',spd).style('--po',opa);
  }
  if (d.type === 'project') {
    const wedges = isProjectGlyphActive(d) ? harnessWedges(d.harnesses, r) : [];
    if (!wedges.length) {
      el.append('path').attr('d',hexPath(r)).attr('fill',KAARO_TOKENS.bg).attr('stroke',d.color).attr('stroke-width',2.5);
    } else {
      for (const w of wedges)
        el.append('path').attr('d',w.d)
          .attr('fill',HARNESS_MARK[w.harness]||d.color).attr('fill-opacity',HARNESS_FILL_OPACITY);
      el.append('path').attr('d',hexPath(r)).attr('fill','none').attr('stroke',d.color).attr('stroke-width',2.5);
    }
  } else if (d.type === 'session') {
    if (d.inFlight) el.append('circle').attr('class','pring').attr('r',r+8).attr('stroke',IN_FLIGHT_COLOR).attr('stroke-width',2).attr('stroke-opacity',.9).style('animation-duration','0.8s');
    if (d.errorLevel===2) el.append('circle').attr('r',r+6).attr('fill','none').attr('stroke','#ff2244').attr('stroke-width',1.5).attr('stroke-opacity',.7);
    else if (d.errorLevel===1) el.append('circle').attr('r',r+4).attr('fill','none').attr('stroke','#ff6633').attr('stroke-width',1).attr('stroke-opacity',.5);
    if (d.skills?.length) el.append('circle').attr('r',r+4).attr('fill','none').attr('stroke','#ffcc00').attr('stroke-width',1).attr('stroke-opacity',.6).attr('stroke-dasharray','3 2');
    el.append('circle').attr('r',r).attr('fill',d.color).attr('fill-opacity',.83).attr('stroke', d.inFlight ? IN_FLIGHT_COLOR : '#000').attr('stroke-width', d.inFlight ? 1.5 : .4);
    if (d.thinking_count>0) el.append('circle').attr('r',2.5).attr('fill','#fff').attr('fill-opacity',.9);
    if (d.hit_max_tokens) el.append('text').attr('text-anchor','middle').attr('dy','.35em').attr('font-size',r*.8).attr('fill','#ff4444').attr('pointer-events','none').text('✕');
  } else if (d.type === 'cluster') {
    if (d.inFlight) el.append('circle').attr('class','pring').attr('r',r+8).attr('stroke',IN_FLIGHT_COLOR).attr('stroke-width',2).attr('stroke-opacity',.9).style('animation-duration','0.8s');
    if (d.errorLevel===2) el.append('circle').attr('r',r+6).attr('fill','none').attr('stroke','#ff2244').attr('stroke-width',1.5).attr('stroke-opacity',.7);
    else if (d.errorLevel===1) el.append('circle').attr('r',r+4).attr('fill','none').attr('stroke','#ff6633').attr('stroke-width',1).attr('stroke-opacity',.5);
    el.append('circle').attr('r',r).attr('fill',KAARO_TOKENS.bg).attr('stroke',d.color).attr('stroke-width',1.5).attr('stroke-dasharray','4 3');
    el.append('circle').attr('r',Math.max(2,r-4)).attr('fill',d.color).attr('fill-opacity',.15);
    el.append('text').attr('text-anchor','middle').attr('dy','.35em').attr('font-size',10).attr('fill',d.color).attr('pointer-events','none').text(d.member_count);
  } else if (d.type === 'subagent') {
    // Small hollow ring (not a session diamond) — same accent as spawn edges
    const sc = EDGE_COLORS.spawn;
    el.append('circle').attr('r',r).attr('fill',KAARO_TOKENS.bg).attr('stroke',sc).attr('stroke-width',1.4);
    el.append('circle').attr('r',Math.max(1.2,r-2)).attr('fill',sc).attr('fill-opacity',.35);
  } else {
    el.append('path').attr('d',`M0,${-r} L${r},0 L0,${r} L${-r},0 Z`)
      .attr('fill',d.color).attr('fill-opacity',.82).attr('stroke',d.color).attr('stroke-width',.5).attr('stroke-opacity',.4);
  }
}

function joinNodes(graphData) {
  return nodeLayer.selectAll('g.node').data(graphData.nodes, d=>d.id).join(
    enter => { const g = enter.append('g').attr('class',d=>'node node-'+d.type).style('cursor','pointer'); g.each(function(d){renderNodeContent(d3.select(this),d);}); return g; },
    update => update.each(function(d){
      const el = d3.select(this);
      el.selectAll('*').remove();
      renderNodeContent(el, d);
    }),
    exit   => exit.remove()
  );
}
let nodeSel = joinNodes(GRAPH);

document.documentElement.classList.toggle('k-hidden', document.hidden);
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('k-hidden', document.hidden);
});

let projLabelSel = labelLayer.selectAll('text.pl').data(GRAPH.nodes.filter(n=>n.type==='project'), d=>d.id)
  .join('text').attr('class','pl').attr('text-anchor','middle').attr('fill',d=>d.color)
  .attr('font-size',9).attr('letter-spacing',1).attr('pointer-events','none').text(d=>d.label.toUpperCase());

simulation.on('tick', () => {
  edgeSel.attr('d', edgePathD);
  nodeSel.attr('transform', d=>`translate(${d.x},${d.y})`);
  projLabelSel.attr('x',d=>d.x).attr('y',d=>d.y+nodeRadius(d)+13);
});
