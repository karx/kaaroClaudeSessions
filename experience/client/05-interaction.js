// ── Drag ──────────────────────────────────────────────────────────────────────
const drag = d3.drag()
  .on('start',(ev,d)=>{ if(!ev.active && currentLayout==='force') simulation.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
  .on('drag', (ev,d)=>{ d.fx=ev.x; d.fy=ev.y; })
  .on('end',  (ev,d)=>{ if(!ev.active && currentLayout==='force') simulation.alphaTarget(0); if(d.type!=='project'&&currentLayout==='force'){d.fx=null;d.fy=null;} });

// ── Tooltip ───────────────────────────────────────────────────────────────────
const tip = document.getElementById('tip');

function attachTooltip(sel) {
  sel.on('mouseover',(ev,d)=>{
    tip.style.display='block';
    if (d.type==='project') {
      const hs = d.harnesses || [];
      tip.innerHTML=`<strong style="color:${d.color}">${d.label}</strong>
        <div class="meta">${d.session_count} sessions · AI work: ${fmtTok(d.tokens_work)}</div>
        ${hs.length?`<div class="meta">${hs.length} harness${hs.length===1?'':'es'} · ${hs.join(' · ')}</div>`:''}
        ${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}`;
    } else if (d.type==='session') {
      tip.innerHTML=`<strong style="color:${d.color}">${d.label}</strong>
        <div class="meta">${d.date_str||'?'} · ${d.duration_min!=null?d.duration_min+'min':'?'} · ${d.model||'?'}</div>
        ${d.recencyLevel>0?'<div class="meta" style="color:'+(['','#446','#88a','#adf'][d.recencyLevel])+'">● '+(['','< 2 days','< 15 min','< 5 min'][d.recencyLevel])+'</div>':''}
        <div class="meta">branch: ${d.git_branch||'?'}</div>
        <div class="meta">AI work: ${fmtTok(d.tokens_work)} · cache: ${fmtTok(d.tokens_cached)} (${d.cache_hit_rate}%)</div>
        <div class="meta">${d.tool_calls} calls · ${d.tool_errors} errors · ${d.tool_diversity} tool types</div>
        ${d.thinking_count?'<div class="meta">thinking: '+d.thinking_count+'</div>':''}
        ${d.hit_max_tokens?'<div class="meta" style="color:#ff4444">⚠ hit max_tokens</div>':''}
        ${d.inFlight?`<div class="meta" style="color:${IN_FLIGHT_COLOR}">⬤ in flight</div>`:''}
        ${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}
        ${d.first_user_message?'<div class="body">'+d.first_user_message.slice(0,130)+'</div>':''}`;
    } else if (d.type==='cluster') {
      tip.innerHTML=`<strong style="color:${d.color}">${esc(d.label)}</strong>
        <div class="meta">bundle · ${d.member_count} sessions${d.label_overridden?' · ✎ renamed':''}${d.manual?' · manual':''}</div>
        <div class="meta">${d.date_first||'?'} → ${d.date_last||'?'} · AI work: ${fmtTok(d.tokens_work)}</div>
        ${(d.harnesses||[]).length?'<div class="meta">'+d.harnesses.join(' · ')+'</div>':''}
        ${d.skills?.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}
        ${d.inFlight?`<div class="meta" style="color:${IN_FLIGHT_COLOR}">⬤ in flight</div>`:''}
        <div class="meta" style="opacity:.6">click to ${expandedClusters.has(d.id)?'collapse':'expand'}</div>`;
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
  edgeSel.attr('stroke-opacity',e=>{ const a=e.source?.id??e.source,b=e.target?.id??e.target; return (a===id||b===id)?Math.min(1,edgeOpacity(e, MAX_WEIGHT)*2):.025; });
  d3.selectAll('.tl-dot').attr('opacity',d=>d.id===id?1:.2);
}
// ── DAW file accent ──────────────────────────────────────────────────────────
// Adds a bright ring to a specific node without changing the highlight state.
// Called by 16-beat-overlay.js when hovering a file-op event.
function accentNode(id) {
  d3.selectAll('.daw-accent').remove();
  nodeSel.filter(d => d.id === id)
    .append('circle')
    .attr('class', 'daw-accent')
    .attr('r', d => nodeRadius(d) + 6)
    .attr('fill', 'none')
    .attr('stroke', '#c8d8ff')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.85)
    .attr('pointer-events', 'none');
}
function clearAccent() { d3.selectAll('.daw-accent').remove(); }
window.accentNode  = accentNode;
window.clearAccent = clearAccent;

function slHighlight(id) {
  slLayer.selectAll('[data-sid]').attr('opacity', id
    ? function() { return this.getAttribute('data-sid')===id ? 1 : 0.2; }
    : 1);
  d3.selectAll('.tl-dot').attr('opacity', id ? d=>d.id===id?1:.2 : 1);
}

function attachClick(sel) {
  sel.on('click',(ev,d)=>{
    ev.stopPropagation();
    if (d.type==='cluster' && currentLayout==='force') {
      selectedId=d.id; highlight(d.id); showPanel(d); toggleCluster(d.id); return;
    }
    if(selectedId===d.id){selectedId=null;highlight(null);closePanel();}else{selectedId=d.id;highlight(d.id);showPanel(d);}
  });
}

// ── Bundle expand/collapse ────────────────────────────────────────────────────
function toggleCluster(id) {
  if (expandedClusters.has(id)) expandedClusters.delete(id); else expandedClusters.add(id);
  _saveExpanded();
  applyFilters();
  if (selectedId === id && nodeById[id]) showPanel(nodeById[id]);
}

// A bundled session can't be focused while its cluster is collapsed — expand first.
function ensureSessionVisible(id) {
  const n = nodeById[id];
  if (!n || n.type !== 'session' || !n.cluster_id) return;
  if (BUNDLE_ON && !expandedClusters.has(n.cluster_id)) {
    expandedClusters.add(n.cluster_id);
    _saveExpanded();
    applyFilters();
  }
}
attachClick(nodeSel);
svg.on('click',()=>{
  selectedId=null;
  if (currentLayout==='swimlane') slHighlight(null); else highlight(null);
  closePanel();
});

// ── Detail panel ──────────────────────────────────────────────────────────────

// Wrap a row in a clickable link IFF the node exists in the current graph
function _nodeRow(id, inner, extraStyle) {
  const exists = !!nodeById[id];
  const style  = `font-size:10px${extraStyle ? ';'+extraStyle : ''}`;
  if (exists) return `<div class="prow plink-row" data-nid="${esc(id)}" style="${style}">${inner}</div>`;
  return `<div class="prow" style="${style}">${inner}</div>`;
}

// focusNode — highlight the node, pan to it, show its panel
function focusNode(id) {
  const node = nodeById[id];
  if (!node) return;
  ensureSessionVisible(id);
  selectedId = id;
  highlight(id);
  showPanel(node);
  if (currentLayout === 'force' && node.x != null && node.y != null) {
    const k = d3.zoomTransform(svg.node()).k;
    svg.transition().duration(420).call(
      zoom.transform,
      d3.zoomIdentity.translate(W/2 - node.x*k, H/2 - node.y*k).scale(k)
    );
  }
}
window.focusNode = focusNode;

// Delegation on static #panel — handles clicks on .plink-row even after innerHTML swaps
document.getElementById('panel').addEventListener('click', e => {
  const row = e.target.closest('[data-nid]');
  if (!row) return;
  e.preventDefault(); e.stopPropagation();
  focusNode(row.dataset.nid);
});

// Bundle expand/collapse button in the cluster panel
document.getElementById('panel').addEventListener('click', e => {
  const btn = e.target.closest('[data-cluster-toggle]');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  toggleCluster(btn.dataset.clusterToggle);
});

// ── Resume prompt builder ─────────────────────────────────────────────────────

function _buildResume(d, fileNodes) {
  const proj    = GRAPH.nodes.find(n=>n.id===d.project_id);
  const projLbl = proj ? proj.label : d.project_id;
  const lastTs  = d.last_activity ? d.last_activity.slice(0,16).replace('T',' ') : '?';
  const branch  = (d.branches && d.branches.length > 1)
    ? d.branches.join(', ')
    : (d.git_branch || '?');
  const topFiles = [...fileNodes]
    .sort((a,b) => (b.edit+b.write) - (a.edit+a.write))
    .slice(0, 8)
    .map(f => `  ${f.label} (${f.edit}e ${f.write}w ${f.read}r)`)
    .join('\n');

  let lines = [
    `Continue working on ${projLbl}.`,
    ``,
    `Session: ${d.label} (${d.id.slice(0,8)})`,
    `Project: ${projLbl} (${d.project_id})`,
    `Branch: ${branch}`,
    `Last active: ${lastTs}`,
  ];
  if (d.context_resets) lines.push(`Context resets: ${d.context_resets}`);
  if (d.subagent_count) lines.push(`Subagents spawned: ${d.subagent_count}`);
  if (d.ai_title) lines.push(`Task: ${d.ai_title}`);
  lines.push(`AI work: ${fmtTok(d.tokens_work)} tokens (${d.cache_hit_rate}% cached)`);
  if (d.first_user_message) {
    lines.push(``, `First message:`, `"${d.first_user_message.slice(0, 300)}"`);
  }
  if (topFiles) {
    lines.push(``, `Key files:`, topFiles);
  }
  return lines.join('\n');
}

// ── Resume click delegation ───────────────────────────────────────────────────

document.getElementById('panel').addEventListener('click', e => {
  const btn = e.target.closest('[data-resume]');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  const node = nodeById[btn.dataset.resume];
  if (!node) return;
  const nb = neighbours(node.id);
  const fileNodes = [...nb].filter(id=>id!==node.id&&nodeById[id]?.type==='file').map(id=>nodeById[id]);
  const text = _buildResume(node, fileNodes);
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ COPIED';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '◆ COPY RESUME PROMPT'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    btn.textContent = '⚠ CLIPBOARD UNAVAILABLE';
    setTimeout(() => { btn.textContent = '◆ COPY RESUME PROMPT'; }, 2000);
  });
});

function _toolBars(d) {
  const top = d.tools_top;
  if (!top || !top.length) return '';
  const max = top[0].calls;
  const rows = top.map(t => {
    const pct  = (t.calls / max * 100).toFixed(1);
    const color = TOOL_COLORS[t.name] || '#2a3a55';
    return `<div class="ptb-row">` +
      `<span class="ptb-name">${t.name}</span>` +
      `<div class="ptb-wrap"><div class="ptb-bar" style="width:${pct}%;background:${color}"></div></div>` +
      `<span class="ptb-cnt">${t.calls}</span>` +
      `</div>`;
  }).join('');
  return `<div class="psep"></div><div class="p-section-hd">◆ TOOL CALLS</div>${rows}`;
}

function showPanel(d) {
  document.getElementById('panel').classList.add('open');
  const nb=neighbours(d.id); let html='';
  if (d.type==='project') {
    const ss=[...nb].filter(id=>id!==d.id).map(id=>nodeById[id]).filter(n=>n?.type==='session');
    const hRows = harnessBreakdown(d.harnesses, ss).map(h =>
      `<div class="prow"><span class="pk" style="color:${h.color}">● ${esc(h.harness)}</span><span class="pv">${h.count}</span></div>`
    ).join('');
    html=`<h3 style="color:${d.color}">${d.label}</h3>
      <div class="prow"><span class="pk">Sessions</span><span class="pv">${d.session_count}</span></div>
      <div class="prow"><span class="pk">AI work</span><span class="pv">${fmtTok(d.tokens_work)}</span></div>
      <div class="prow"><span class="pk">Skills</span><span class="pv">${d.skills.map(s=>'<span class="ptag">/'+s+'</span>').join('')||'none'}</span></div>
      ${hRows?`<div class="psep"></div><div class="p-section-hd">◆ HARNESSES</div>${hRows}`:''}
      <div class="psep"></div>
      ${ss.map(s=>_nodeRow(s.id,`<span class="pk">${s.date_str||'?'}</span><span class="pv" style="color:${d.color}">${s.label}</span>`)).join('')}`;
  } else if (d.type==='session') {
    const files=[...nb].filter(id=>id!==d.id&&nodeById[id]?.type==='file').map(id=>nodeById[id]);
    const peers=[...nb].filter(id=>id!==d.id&&nodeById[id]?.type==='session').map(id=>nodeById[id]);
    const projNode = GRAPH.nodes.find(n=>n.id===d.project_id);
    const branchList = (d.branches&&d.branches.length>1) ? d.branches : null;
    html=`<h3 style="color:${d.color}">${d.label}</h3>
      ${d.ai_title?`<div class="pai-title">${d.ai_title.slice(0,120)}</div>`:''}
      <div class="prow"><span class="pk">Date</span><span class="pv">${d.date_str||'?'}</span></div>
      <div class="prow"><span class="pk">Duration</span><span class="pv">${d.duration_min!=null?d.duration_min+' min':'?'}</span></div>
      ${d.last_activity?'<div class="prow"><span class="pk">Last active</span><span class="pv">'+d.last_activity.slice(0,16).replace('T',' ')+'</span></div>':''}
      <div class="prow"><span class="pk">Model</span><span class="pv">${d.model||'?'}</span></div>
      ${branchList
        ?`<div class="prow"><span class="pk">Branches</span><span class="pv" style="text-align:right">${branchList.map(b=>'<span class="ptag">'+b+'</span>').join('')}</span></div>`
        :`<div class="prow"><span class="pk">Branch</span><span class="pv">${d.git_branch||'?'}</span></div>`}
      ${d.context_resets?`<div class="prow"><span class="pk">Context resets</span><span class="pv">${d.context_resets}</span></div>`:''}
      ${d.subagent_count?`<div class="prow"><span class="pk">Subagents</span><span class="pv">${d.subagent_count}</span></div>`:''}
      <div class="psep"></div>
      <div class="prow"><span class="pk">AI work</span><span class="pv">${fmtTok(d.tokens_work)}</span></div>
      <div class="prow"><span class="pk">Cache read</span><span class="pv">${fmtTok(d.tokens_cached)} (${d.cache_hit_rate}%)</span></div>
      <div class="prow"><span class="pk">Output</span><span class="pv">${fmtTok(d.tokens_output)}</span></div>
      <div class="psep"></div>
      <div class="prow"><span class="pk">Tool calls</span><span class="pv">${d.tool_calls}</span></div>
      <div class="prow"><span class="pk">Errors</span><span class="pv" style="color:${d.errorLevel>0?'#ff6633':'inherit'}">${d.tool_errors}</span></div>
      <div class="prow"><span class="pk">Tool types</span><span class="pv">${d.tool_diversity}</span></div>
      <div class="prow"><span class="pk">Thinking</span><span class="pv">${d.thinking_count}</span></div>
      <div class="prow"><span class="pk">Git commands</span><span class="pv">${d.bash_git}</span></div>
      ${d.hit_max_tokens?'<div class="prow"><span class="pk" style="color:#ff4444">Max tokens hit</span><span class="pv">✕</span></div>':''}
      ${d.skills.length?'<div class="prow"><span class="pk">Skills</span><span class="pv">'+d.skills.map(s=>'<span class="ptag">/'+s+'</span>').join('')+'</span></div>':''}
      ${d.first_user_message?'<div class="pmsg">'+d.first_user_message.slice(0,250)+'</div>':''}
      ${peers.length?'<div class="psep"></div><div class="p-section-hd">Branch peers</div>'+peers.map(p=>_nodeRow(p.id,`<span class="pk">${p.date_str||'?'}</span><span class="pv">${p.label}</span>`)).join(''):''}
      ${files.length?'<div class="psep"></div><div class="p-section-hd">Files ('+files.length+')</div>'+files.map(f=>_nodeRow(f.id,`<span class="pk" style="color:${f.color}">${f.label}</span><span class="pv">${f.edit}e ${f.write}w</span>`)).join(''):''}
      ${_toolBars(d)}
      ${window._traceSection ? window._traceSection(d) : ''}
      <div class="psep"></div>
      ${d.context_resets ? `<button class="paction paction-thread" data-thread-open="${esc(d.id)}">◆ VIEW THREAD ▸</button>` : ''}
      <button class="paction" data-resume="${esc(d.id)}">◆ COPY RESUME PROMPT</button>
      `;
  } else if (d.type==='cluster') {
    const members=(d.member_ids||[]).map(id=>nodeById[id]).filter(Boolean);
    const isExp=expandedClusters.has(d.id);
    html=`<h3 style="color:${d.color}">${esc(d.label)}</h3>
      <div class="prow"><span class="pk">Bundle</span><span class="pv">${d.member_count} sessions${d.manual?' · manual':''}${d.label_overridden?' · ✎':''}</span></div>
      <div class="prow"><span class="pk">Dates</span><span class="pv">${d.date_first||'?'} → ${d.date_last||'?'}</span></div>
      <div class="prow"><span class="pk">AI work</span><span class="pv">${fmtTok(d.tokens_work)}</span></div>
      <div class="prow"><span class="pk">Tool calls</span><span class="pv">${d.tool_calls} · ${d.tool_errors} errors</span></div>
      ${(d.harnesses||[]).length?'<div class="prow"><span class="pk">Harnesses</span><span class="pv">'+d.harnesses.map(h=>'<span class="ptag">'+h+'</span>').join('')+'</span></div>':''}
      ${d.skills?.length?'<div class="prow"><span class="pk">Skills</span><span class="pv">'+d.skills.map(s=>'<span class="ptag">/'+s+'</span>').join('')+'</span></div>':''}
      <div class="psep"></div>
      <div class="p-section-hd">Sessions (${members.length})</div>
      ${members.map(m=>_nodeRow(m.id,`<span class="pk">${m.date_str||'?'}</span><span class="pv" style="color:${d.color}">${m.label}</span>`)).join('')}
      <div class="psep"></div>
      <div class="pmsg" style="word-break:break-all;font-size:9px;opacity:.7" title="cluster id — copy into cluster-overrides.json">${esc(d.id)}</div>
      <button class="paction" data-cluster-toggle="${esc(d.id)}">${isExp?'◆ COLLAPSE BUNDLE':'◆ EXPAND BUNDLE'}</button>
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
      ${ss.length?'<div class="psep"></div>'+ss.map(s=>_nodeRow(s.id,`<span class="pk" style="color:${s.color}">${s.date_str||'?'}</span><span class="pv">${s.label}</span>`)).join(''):''}
      `;
  }
  document.getElementById('panel-content').innerHTML = html;
}
function closePanel() { document.getElementById('panel').classList.remove('open'); }
window.closePanel = closePanel;
