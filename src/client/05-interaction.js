// ── Drag ──────────────────────────────────────────────────────────────────────
const drag = d3.drag()
  .on('start',(ev,d)=>{ if(!ev.active && currentLayout==='force') simulation.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
  .on('drag', (ev,d)=>{ d.fx=ev.x; d.fy=ev.y; })
  .on('end',  (ev,d)=>{ if(!ev.active && currentLayout==='force') simulation.alphaTarget(0); if(d.type!=='project'&&currentLayout==='force'){d.fx=null;d.fy=null;} });

// ── Tooltip ───────────────────────────────────────────────────────────────────
const tip = document.getElementById('tip');
const fmtT = n => n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'K':n;

function attachTooltip(sel) {
  sel.on('mouseover',(ev,d)=>{
    tip.style.display='block';
    if (d.type==='project') {
      tip.innerHTML=`<strong style="color:${d.color}">${d.label}</strong>
        <div class="meta">${d.session_count} sessions · AI work: ${fmtT(d.tokens_work)}</div>
        ${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}`;
    } else if (d.type==='session') {
      tip.innerHTML=`<strong style="color:${d.color}">${d.label}</strong>
        <div class="meta">${d.date_str||'?'} · ${d.duration_min!=null?d.duration_min+'min':'?'} · ${d.model||'?'}</div>
        ${d.recencyLevel>0?'<div class="meta" style="color:'+(['','#446','#88a','#adf'][d.recencyLevel])+'">● '+(['','< 2 days','< 15 min','< 5 min'][d.recencyLevel])+'</div>':''}
        <div class="meta">branch: ${d.git_branch||'?'}</div>
        <div class="meta">AI work: ${fmtT(d.tokens_work)} · cache: ${fmtT(d.tokens_cached)} (${d.cache_hit_rate}%)</div>
        <div class="meta">${d.tool_calls} calls · ${d.tool_errors} errors · ${d.tool_diversity} tool types</div>
        ${d.thinking_count?'<div class="meta">thinking: '+d.thinking_count+'</div>':''}
        ${d.hit_max_tokens?'<div class="meta" style="color:#ff4444">⚠ hit max_tokens</div>':''}
        ${d.inFlight?`<div class="meta" style="color:${IN_FLIGHT_COLOR}">⬤ in flight</div>`:''}
        ${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}
        ${d.first_user_message?'<div class="body">'+d.first_user_message.slice(0,130)+'</div>':''}`;
    } else {
      tip.innerHTML=`<strong style="color:${d.color}">${d.label}</strong>
        <div class="meta">${d.session_count} sessions · ${d.edit} edits · ${d.write} writes · ${d.read} reads</div>
        <div class="meta" style="word-break:break-all;font-size:10px">${d.full_path}</div>`;
    }
  }).on('mousemove',ev=>{
    const tx=ev.clientX+16,ow=tip.offsetWidth;
    tip.style.left=(tx+ow>W-10?ev.clientX-ow-16:tx)+'px';
    tip.style.top=Math.min(ev.clientY-8,H-tip.offsetHeight-10)+'px';
  }).on('mouseout',()=>tip.style.display='none');
}
attachTooltip(nodeSel);

// ── Highlight & click ─────────────────────────────────────────────────────────
let selectedId = null;
function neighbours(id) {
  const s=new Set([id]);
  GRAPH.edges.forEach(e=>{ const a=e.source?.id??e.source,b=e.target?.id??e.target; if(a===id)s.add(b);if(b===id)s.add(a); });
  return s;
}
function highlight(id) {
  if (!id) { nodeSel.attr('opacity',1); edgeSel.call(styleEdge); d3.selectAll('.tl-dot').attr('opacity',1); return; }
  const nb=neighbours(id);
  nodeSel.attr('opacity',d=>nb.has(d.id)?1:.05);
  edgeSel.attr('stroke-opacity',e=>{ const a=e.source?.id??e.source,b=e.target?.id??e.target; return (a===id||b===id)?Math.min(1,edgeOpacity(e)*2):.025; });
  d3.selectAll('.tl-dot').attr('opacity',d=>d.id===id?1:.2);
}
function slHighlight(id) {
  slLayer.selectAll('[data-sid]').attr('opacity', id
    ? function() { return this.getAttribute('data-sid')===id ? 1 : 0.2; }
    : 1);
  d3.selectAll('.tl-dot').attr('opacity', id ? d=>d.id===id?1:.2 : 1);
}

function attachClick(sel) {
  sel.on('click',(ev,d)=>{ ev.stopPropagation(); if(selectedId===d.id){selectedId=null;highlight(null);closePanel();}else{selectedId=d.id;highlight(d.id);showPanel(d);} });
}
attachClick(nodeSel);
svg.on('click',()=>{
  selectedId=null;
  if (currentLayout==='swimlane') slHighlight(null); else highlight(null);
  closePanel();
});

// ── Detail panel ──────────────────────────────────────────────────────────────
function showPanel(d) {
  document.getElementById('panel').style.display='block';
  const nb=neighbours(d.id); let html='';
  if (d.type==='project') {
    const ss=[...nb].filter(id=>id!==d.id).map(id=>nodeById[id]).filter(n=>n?.type==='session');
    html=`<h3 style="color:${d.color}">${d.label}</h3>
      <div class="prow"><span class="pk">Sessions</span><span class="pv">${d.session_count}</span></div>
      <div class="prow"><span class="pk">AI work</span><span class="pv">${fmtT(d.tokens_work)}</span></div>
      <div class="prow"><span class="pk">Skills</span><span class="pv">${d.skills.map(s=>'<span class="ptag">/'+s+'</span>').join('')||'none'}</span></div>
      <div class="psep"></div>
      ${ss.map(s=>`<div class="prow" style="font-size:10px"><span class="pk">${s.date_str||'?'}</span><span class="pv" style="color:${d.color}">${s.label}</span></div>`).join('')}`;
  } else if (d.type==='session') {
    const files=[...nb].filter(id=>id!==d.id&&nodeById[id]?.type==='file').map(id=>nodeById[id]);
    const peers=[...nb].filter(id=>id!==d.id&&nodeById[id]?.type==='session').map(id=>nodeById[id]);
    html=`<h3 style="color:${d.color}">${d.label}</h3>
      <div class="prow"><span class="pk">Date</span><span class="pv">${d.date_str||'?'}</span></div>
      <div class="prow"><span class="pk">Duration</span><span class="pv">${d.duration_min!=null?d.duration_min+' min':'?'}</span></div>
      ${d.last_activity?'<div class="prow"><span class="pk">Last active</span><span class="pv">'+d.last_activity.slice(0,16).replace('T',' ')+'</span></div>':''}
      <div class="prow"><span class="pk">Model</span><span class="pv">${d.model||'?'}</span></div>
      <div class="prow"><span class="pk">Branch</span><span class="pv">${d.git_branch||'?'}</span></div>
      <div class="psep"></div>
      <div class="prow"><span class="pk">AI work</span><span class="pv">${fmtT(d.tokens_work)}</span></div>
      <div class="prow"><span class="pk">Cache read</span><span class="pv">${fmtT(d.tokens_cached)} (${d.cache_hit_rate}%)</span></div>
      <div class="prow"><span class="pk">Output</span><span class="pv">${fmtT(d.tokens_output)}</span></div>
      <div class="psep"></div>
      <div class="prow"><span class="pk">Tool calls</span><span class="pv">${d.tool_calls}</span></div>
      <div class="prow"><span class="pk">Errors</span><span class="pv" style="color:${d.errorLevel>0?'#ff6633':'inherit'}">${d.tool_errors}</span></div>
      <div class="prow"><span class="pk">Tool types</span><span class="pv">${d.tool_diversity}</span></div>
      <div class="prow"><span class="pk">Thinking</span><span class="pv">${d.thinking_count}</span></div>
      <div class="prow"><span class="pk">Git commands</span><span class="pv">${d.bash_git}</span></div>
      ${d.hit_max_tokens?'<div class="prow"><span class="pk" style="color:#ff4444">Max tokens hit</span><span class="pv">✕</span></div>':''}
      ${d.skills.length?'<div class="prow"><span class="pk">Skills</span><span class="pv">'+d.skills.map(s=>'<span class="ptag">/'+s+'</span>').join('')+'</span></div>':''}
      ${d.first_user_message?'<div class="pmsg">'+d.first_user_message.slice(0,250)+'</div>':''}
      ${peers.length?'<div class="psep"></div><div style="color:#445566;margin-bottom:4px;font-size:10px">Branch peers:</div>'+peers.map(p=>`<div class="prow" style="font-size:10px"><span class="pk">${p.date_str||'?'}</span><span class="pv">${p.label}</span></div>`).join(''):''}
      ${files.length?'<div class="psep"></div><div style="color:#445566;margin-bottom:4px;font-size:10px">Files ('+files.length+'):</div>'+files.map(f=>`<div class="prow" style="font-size:10px"><span class="pk" style="color:${f.color}">${f.label}</span><span class="pv">${f.edit}e ${f.write}w</span></div>`).join(''):''}
      `;
  } else {
    const ss=[...nb].filter(id=>id!==d.id&&nodeById[id]?.type==='session').map(id=>nodeById[id]);
    html=`<h3 style="color:${d.color}">${d.label}</h3>
      <div class="prow"><span class="pk">Extension</span><span class="pv">.${d.ext}</span></div>
      <div class="prow"><span class="pk">Sessions</span><span class="pv">${d.session_count}</span></div>
      <div class="prow"><span class="pk">Edits</span><span class="pv">${d.edit}</span></div>
      <div class="prow"><span class="pk">Writes</span><span class="pv">${d.write}</span></div>
      <div class="prow"><span class="pk">Reads</span><span class="pv">${d.read}</span></div>
      <div class="pmsg" style="word-break:break-all">${d.full_path}</div>
      ${ss.length?'<div class="psep"></div>'+ss.map(s=>`<div class="prow" style="font-size:10px"><span class="pk" style="color:${s.color}">${s.date_str||'?'}</span><span class="pv">${s.label}</span></div>`).join(''):''}
      `;
  }
  document.getElementById('panel-content').innerHTML = html;
}
function closePanel() { document.getElementById('panel').style.display='none'; }
window.closePanel = closePanel;
