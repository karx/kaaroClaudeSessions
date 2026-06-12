// â”€â”€ Matrix layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SESSION_FILTERS declared in 01-data; predicate from shared core.

function renderMatrix() {
  const mv = document.getElementById('matrix-view');
  mv.innerHTML = '';
  const minSess = +document.getElementById('sl-min').value;
  const showRo  = document.getElementById('cb-ro-files').checked;
  let files = GRAPH.nodes.filter(n => n.type === 'file' && n.session_count >= minSess);
  if (!showRo) files = files.filter(f => f.write > 0 || f.edit > 0);
  let sessions = GRAPH.nodes.filter(n => n.type === 'session')
    .filter(n => sessionMatchesFilters(n, SESSION_FILTERS))
    .sort((a,b) => (a.first_timestamp||'') < (b.first_timestamp||'') ? -1 : 1);
  if (!files.length || !sessions.length) { mv.innerHTML='<div class="mx-empty">No data â€” adjust filters</div>'; return; }
  files.sort((a,b)=>(b.write+b.edit)-(a.write+a.edit));
  const opMap = {};
  GRAPH.edges.forEach(e => {
    if (!['write','edit','read'].includes(e.type)) return;
    const sId=e.source?.id??e.source, fId=e.target?.id??e.target;
    if (!opMap[sId]) opMap[sId]={};
    if (!opMap[sId][fId]) opMap[sId][fId]={read:0,write:0,edit:0};
    opMap[sId][fId][e.type]=(opMap[sId][fId][e.type]||0)+(e.weight||1);
  });
  const LABEL_W=180,HEADER_H=84,CELL_H=18;
  const CELL_W=Math.max(10,Math.min(36,(W-LABEL_W-20)/sessions.length));
  const svgW=LABEL_W+sessions.length*CELL_W+4, svgH=HEADER_H+files.length*CELL_H+20;
  const bar=document.createElement('div'); bar.className='mx-legend';
  bar.innerHTML=`<span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#ffcc00" fill-opacity=".75"/></svg>edit</span>
    <span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#00ff88" fill-opacity=".75"/></svg>write</span>
    <span class="mx-leg-item"><svg class="mx-leg-swatch"><rect width="14" height="14" fill="#1e4a66" fill-opacity=".8"/></svg>read only</span>
    <span style="margin-left:auto;color:${KAARO_TOKENS.dim};font-size:10px">${files.length} files Ã— ${sessions.length} sessions</span>`;
  mv.appendChild(bar);
  const msvg=d3.select(mv).append('svg').attr('width',svgW).attr('height',svgH).style('display','block');
  const hg=msvg.append('g').attr('transform',`translate(${LABEL_W},0)`);
  sessions.forEach((s,si)=>{
    const x=si*CELL_W+CELL_W/2;
    hg.append('text').attr('x',x).attr('y',HEADER_H-4).attr('transform',`rotate(-45,${x},${HEADER_H-4})`)
      .attr('text-anchor','end').attr('font-size',8).attr('fill',s.color)
      .attr('font-family','Courier New,monospace').text(s.date_str||s.label);
  });
  const rg=msvg.append('g').attr('transform',`translate(0,${HEADER_H})`);
  files.forEach((f,fi)=>{
    const gy=fi*CELL_H;
    if(fi%2===0) rg.append('rect').attr('x',0).attr('y',gy).attr('width',svgW).attr('height',CELL_H).attr('fill','#0a0a18');
    rg.append('text').attr('x',LABEL_W-6).attr('y',gy+CELL_H/2+3).attr('text-anchor','end').attr('font-size',9).attr('fill',f.color).attr('font-family','Courier New,monospace').text(f.label).append('title').text(f.full_path);
    sessions.forEach((s,si)=>{
      const ops=opMap[s.id]?.[f.id];
      let fill='transparent',opacity=1;
      if(ops){if(ops.edit>0){fill='#ffcc00';opacity=0.75;}else if(ops.write>0){fill='#00ff88';opacity=0.75;}else if(ops.read>0){fill='#1e4a66';opacity=0.8;}}
      const cell=rg.append('rect').attr('x',LABEL_W+si*CELL_W).attr('y',gy+1).attr('width',CELL_W-1).attr('height',CELL_H-2).attr('fill',fill).attr('fill-opacity',opacity).style('cursor',ops?'pointer':'default');
      if(ops){const os=[ops.write?`${ops.write}w`:'',ops.edit?`${ops.edit}e`:'',ops.read?`${ops.read}r`:''].filter(Boolean).join(' ');
        cell.on('mouseover',ev=>{tip.style.display='block';tip.innerHTML=`<strong style="color:${s.color}">${s.label}</strong><div class="meta">${f.label}</div><div class="meta">${os}</div>`;tip.style.left=(ev.clientX+12)+'px';tip.style.top=(ev.clientY-20)+'px';})
          .on('mousemove',ev=>{tip.style.left=(ev.clientX+12)+'px';tip.style.top=(ev.clientY-20)+'px';})
          .on('mouseout',()=>tip.style.display='none')
          .on('click',ev=>{ev.stopPropagation();selectedId=s.id;showPanel(s);});
      }
    });
  });
}
