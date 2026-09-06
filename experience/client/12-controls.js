// ── Filters ───────────────────────────────────────────────────────────────────
function applyFilters() {
  if (currentLayout === 'matrix')   { renderMatrix();   return; }
  if (currentLayout === '3d')       { layout3D.exit(); layout3D.enter(); return; }
  if (currentLayout === 'swimlane') { renderSwimlane(); return; }
  if (currentLayout === 'arc') {
    nodeSel.attr('display', d => {
      if (d.type !== 'session') return 'none';
      if (!sessionMatchesFilters(d, SESSION_FILTERS)) return 'none';
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
  const showSubs    = document.getElementById('cb-subagents')?.checked ?? false;
  const minSess     = +document.getElementById('sl-min').value;
  BUNDLE_ON = document.getElementById('cb-bundle')?.checked ?? true;

  // Sessions and clusters resolve first — file visibility depends on them.
  const clusterHidden = computeClusterHidden(GRAPH.nodes,
    { bundleOn: BUNDLE_ON, expanded: expandedClusters, filters: SESSION_FILTERS });
  const hiddenNodes = new Set();
  for (const n of GRAPH.nodes) {
    if (n.type === 'session' && (!sessionMatchesFilters(n, SESSION_FILTERS) || clusterHidden.has(n.id))) hiddenNodes.add(n.id);
    if (n.type === 'cluster' && clusterHidden.has(n.id)) hiddenNodes.add(n.id);
    // Subagent satellites: default OFF; also hide if parent session is hidden
    if (n.type === 'subagent') {
      if (!showSubs || hiddenNodes.has(n.parent_session_id)) hiddenNodes.add(n.id);
    }
  }
  // Orphan-file mitigation: with bundles collapsed, most file edges vanish —
  // hide files whose every session neighbour is hidden so no orphan cloud floats.
  let fileSess = null;
  if (BUNDLE_ON) {
    fileSess = {};
    for (const e of GRAPH.edges) {
      if (e.type !== 'write' && e.type !== 'edit' && e.type !== 'read') continue;
      const s = e.source?.id ?? e.source, t = e.target?.id ?? e.target;
      (fileSess[t] = fileSess[t] || []).push(s);
    }
  }
  nodeSel.attr('display', d => {
    if (d.type === 'session' || d.type === 'cluster' || d.type === 'subagent')
      return hiddenNodes.has(d.id) ? 'none' : null;
    if (d.type === 'file') {
      if (!showFiles)                                    { hiddenNodes.add(d.id); return 'none'; }
      if (d.session_count < minSess)                     { hiddenNodes.add(d.id); return 'none'; }
      if (!showRoFiles && d.write === 0 && d.edit === 0) { hiddenNodes.add(d.id); return 'none'; }
      const ss = fileSess && fileSess[d.id];
      if (ss && ss.length && ss.every(sid => hiddenNodes.has(sid))) { hiddenNodes.add(d.id); return 'none'; }
      return null;
    }
    return null;
  });
  edgeSel.attr('display', e => {
    const src=e.source?.id??e.source, tgt=e.target?.id??e.target;
    if (hiddenNodes.has(src)||hiddenNodes.has(tgt)) return 'none';
    if (e.type==='read'   && !showReads)  return 'none';
    if (e.type==='branch' && !showBranch) return 'none';
    if (e.type==='spawn'  && !showSubs)   return 'none';
    return null;
  });
  projLabelSel.attr('display', null);

  // Sync force simulation to visible nodes/edges so the layout responds to date filter
  const visNodes = GRAPH.nodes.filter(n => !hiddenNodes.has(n.id));
  const visEdges = GRAPH.edges.filter(e => {
    const s = e.source?.id ?? e.source, t = e.target?.id ?? e.target;
    return !hiddenNodes.has(s) && !hiddenNodes.has(t);
  });
  simulation.nodes(visNodes);
  simulation.force('link', makeForceLink(visEdges));
  if (hiddenNodes.size > 0) simulation.alpha(0.15).restart();
}

// General controls
document.getElementById('cb-files').addEventListener('change',    applyFilters);
document.getElementById('cb-ro-files').addEventListener('change', applyFilters);
document.getElementById('cb-branch').addEventListener('change',   applyFilters);
document.getElementById('cb-reads').addEventListener('change',    applyFilters);
document.getElementById('cb-bundle')?.addEventListener('change',  applyFilters);
document.getElementById('cb-subagents')?.addEventListener('change', applyFilters);
document.getElementById('cb-group').addEventListener('change', () => {
  if (isSimLayout()) { restoreForceLayout(); simulation.alpha(0.3).restart(); }
});
document.getElementById('sl-min').addEventListener('input', function() {
  document.getElementById('sl-min-val').textContent = this.value; applyFilters();
});
function _afterFilterChange() {
  applyFilters();
  if (currentLayout==='arc') { computeArcPositions(); drawArcDecor(); applyStaticPositions(); }
}
document.getElementById('tf-from').addEventListener('change', function() {
  SESSION_FILTERS.from = this.value || null; _afterFilterChange();
});
document.getElementById('tf-to').addEventListener('change', function() {
  SESSION_FILTERS.to = this.value || null; _afterFilterChange();
});
document.getElementById('tf-clear').addEventListener('click', () => {
  document.getElementById('tf-from').value=''; document.getElementById('tf-to').value='';
  SESSION_FILTERS.from = SESSION_FILTERS.to = null;
  SESSION_FILTERS.harnesses = SESSION_FILTERS.projects = null;
  document.querySelectorAll('#harness-chips .hchip').forEach(b => { b.classList.remove('on'); b.style.color=''; b.style.borderColor=''; });
  document.querySelectorAll('#proj-filter option').forEach(o => { o.selected = false; });
  _afterFilterChange();
});

// ── Harness chips + project multi-select (populated from graph data) ─────────
function buildFilterControls() {
  const chipBox = document.getElementById('harness-chips');
  const projSel = document.getElementById('proj-filter');
  if (!chipBox || !projSel) return;

  const harnesses = [...new Set(GRAPH.nodes.filter(n => n.type==='session').map(n => n.harness).filter(Boolean))].sort();
  chipBox.innerHTML = '';
  for (const h of harnesses) {
    const b = document.createElement('button');
    b.className = 'btn hchip';
    b.textContent = h;
    b.title = 'Toggle ' + h + ' sessions';
    b.addEventListener('click', () => {
      b.classList.toggle('on');
      const on = [...chipBox.querySelectorAll('.hchip.on')].map(x => x.textContent);
      SESSION_FILTERS.harnesses = on.length ? new Set(on) : null;
      b.style.color = b.classList.contains('on') ? KAARO_TOKENS.accent : '';
      b.style.borderColor = b.classList.contains('on') ? KAARO_TOKENS.accent : '';
      _afterFilterChange();
    });
    chipBox.appendChild(b);
  }

  const prevSelected = new Set([...projSel.selectedOptions].map(o => o.value));
  projSel.innerHTML = '';
  const projects = GRAPH.nodes.filter(n => n.type==='project')
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const p of projects) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    o.style.color = p.color;
    o.selected = prevSelected.has(p.id);
    projSel.appendChild(o);
  }
}
document.getElementById('proj-filter').addEventListener('change', function() {
  const sel = [...this.selectedOptions].map(o => o.value);
  SESSION_FILTERS.projects = sel.length ? new Set(sel) : null;
  _afterFilterChange();
});
buildFilterControls();

// Free layout toggle — projects unpin, co-access clustering (force layout)
document.getElementById('fp-free')?.addEventListener('change', () => {
  if (document.getElementById('fp-free').checked) {
    const pin = document.getElementById('cb-pin-grid');
    if (pin) pin.checked = false;
  }
  if (isSimLayout()) { restoreForceLayout(); simulation.alpha(0.5).restart(); }
});
document.getElementById('cb-pin-grid')?.addEventListener('change', () => {
  if (document.getElementById('cb-pin-grid').checked) {
    const free = document.getElementById('fp-free');
    if (free) free.checked = false;
  }
  if (isSimLayout()) { restoreForceLayout(); simulation.alpha(0.45).restart(); }
});
document.getElementById('btn-shake').addEventListener('click', ()=>{ if(isSimLayout()) simulation.alpha(.4).restart(); });
document.getElementById('btn-reset').addEventListener('click', ()=>svg.transition().duration(600).call(zoom.transform, initialTransform));

// ── Force physics controls ────────────────────────────────────────────────────
const FP_DEFAULTS = { 'fp-charge-s': -130, 'fp-charge-f': -55, 'fp-link-m': 125, 'fp-link-f': 60, 'fp-vdecay': 38 };

['fp-charge-s','fp-charge-f','fp-link-m','fp-link-f','fp-vdecay'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', function() {
    const display = id === 'fp-vdecay' ? (this.value / 100).toFixed(2) : this.value;
    document.getElementById(id + '-val').textContent = display;
    if (isSimLayout()) { restoreForceLayout(); simulation.alpha(0.3).restart(); }
  });
});

function syncRangeLabel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 'fp-vdecay') {
    const lab = document.getElementById(id + '-val');
    if (lab) lab.textContent = (+el.value / 100).toFixed(2);
  } else if (id === 'arc-min-shared') {
    const lab = document.getElementById('arc-min-val');
    if (lab) lab.textContent = el.value;
  } else if (id === 'arc-max-span') {
    const v = +el.value;
    const lab = document.getElementById('arc-span-val');
    if (lab) lab.textContent = v >= 365 ? 'All' : v + 'd';
  } else {
    const lab = document.getElementById(id + '-val');
    if (lab) lab.textContent = el.value;
  }
}

function resetLayoutOptions() {
  if (!confirmLayoutReset()) return;
  document.querySelectorAll('#controls input[type="checkbox"]').forEach(el => { el.checked = el.defaultChecked; });
  document.querySelectorAll('#controls input[type="range"]').forEach(el => {
    el.value = el.defaultValue;
    syncRangeLabel(el.id);
  });
  document.querySelectorAll('#controls select').forEach(el => {
    const def = [...el.options].find(o => o.defaultSelected);
    el.value = def ? def.value : el.options[0]?.value;
  });
  document.getElementById('tf-clear')?.click();
  focusedArcFileId = null;
  if (currentLayout !== 'force') setLayout('force');
  else {
    restoreForceLayout();
    applyFilters();
    if (typeof simulation !== 'undefined') simulation.alpha(0.5).restart();
  }
  svg.transition().duration(600).call(zoom.transform, initialTransform);
}

document.getElementById('btn-reset-layout')?.addEventListener('click', resetLayoutOptions);

document.getElementById('btn-reset-physics')?.addEventListener('click', () => {
  for (const [id, val] of Object.entries(FP_DEFAULTS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = val;
    document.getElementById(id + '-val').textContent =
      id === 'fp-vdecay' ? (val / 100).toFixed(2) : val;
  }
  if (isSimLayout()) { restoreForceLayout(); simulation.alpha(0.5).restart(); }
});
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
  const bundles=GRAPH.nodes.filter(n=>n.type==='cluster').length;
  document.getElementById('stats').textContent=
    `${GRAPH.nodes.filter(n=>n.type==='project').length} projects · ${GRAPH.nodes.filter(n=>n.type==='session').length} sessions${bundles?` · ${bundles} bundles`:''} · ${GRAPH.nodes.filter(n=>n.type==='file').length} files · ${GRAPH.edges.length} edges · ${dr.first.slice(0,10)} → ${dr.last.slice(0,10)}`;
}
updateStats();

// ── Timeline ──────────────────────────────────────────────────────────────────
function buildTimeline() {
  const tlSvg=d3.select('#tl-svg'),tw=window.innerWidth,th=TIMELINE_H;
  const dates=TIMELINE.map(d=>new Date(d.ts));
  if(!dates.length) return;
  const spanDays = Math.max(1, (d3.max(dates) - d3.min(dates)) / 864e5);
  // Make timeline scrollable: at least 20px per day, minimum 3000px
  const minTimelineWidth = Math.max(3000, 40 + spanDays * 20);
  tlSvg.attr('width', minTimelineWidth).attr('height', th);
  const xScale=d3.scaleTime().domain([d3.min(dates),d3.max(dates)]).range([40, minTimelineWidth - 40]);
  const days=d3.timeDay.range(d3.min(dates),d3.timeDay.offset(d3.max(dates),1));
  tlSvg.selectAll('line.tl-tick').data(days).join('line').attr('class','tl-tick').attr('x1',d=>xScale(d)).attr('x2',d=>xScale(d)).attr('y1',th-20).attr('y2',th-4).attr('stroke','#1a1a2e').attr('stroke-width',1);
  tlSvg.selectAll('text.tl-label').data(days.filter((_,i)=>i%3===0)).join('text').attr('class','tl-label').attr('x',d=>xScale(d)).attr('y',th-22).attr('text-anchor','middle').attr('font-size',8).attr('fill',KAARO_TOKENS.dim).attr('font-family','Courier New,monospace').text(d=>d3.timeFormat('%m/%d')(d));
  tlSvg.selectAll('line.tl-base').data([0]).join('line').attr('class','tl-base').attr('x1',40).attr('x2',minTimelineWidth-40).attr('y1',th-20).attr('y2',th-20).attr('stroke','#14142a').attr('stroke-width',1);
  const maxWork=Math.max(...TIMELINE.map(t=>t.tokens_work||1));
  tlSvg.selectAll('circle.tl-dot').data(TIMELINE,d=>d.id).join('circle').attr('class','tl-dot')
    .attr('cx',d=>xScale(new Date(d.ts)))
    .attr('cy',d=>{const idx=COLOR_TO_INDEX[d.color]??0;return th-28-(idx%5)*4;})
    .attr('r',d=>3+4*Math.sqrt(d.tokens_work/maxWork))
    .attr('fill',d=>d.color).attr('fill-opacity',.85)
    .attr('stroke',d=>d.tool_errors>=8?'#ff2244':'none').attr('stroke-width',1.5).style('cursor','pointer')
    .on('mouseover',(ev,d)=>{tip.style.display='block';tip.innerHTML=`<strong style="color:${d.color}">${d.slug}</strong><div class="meta">${d.date_str} · ${d.project}</div><div class="meta">AI work: ${fmtTok(d.tokens_work)}</div>${d.skills.length?'<div class="meta">/'+d.skills.join(' /')+'</div>':''}`;})
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
          ensureSessionVisible(d.id);
          highlight(d.id); showPanel(node);
          if(isSimLayout()||currentLayout==='arc'){const t=d3.zoomTransform(svg.node()),nx=node.x*t.k+t.x,ny=node.y*t.k+t.y;svg.transition().duration(500).call(zoom.translateBy,(W/2-nx)/t.k,(H/2-ny)/t.k);}
        }
      }
    });
}

function toggleWidget(id) {
  const el=document.getElementById(id);
  if (!el) return;
  const col=el.classList.toggle('collapsed');
  const t=el.querySelector('.widget-toggle');
  if (t) t.textContent=col?'+':'−';
  persistChromeCollapsed();
}

function chromeWidgetStates() {
  return [...document.querySelectorAll('.widget')].map(el => el.classList.contains('collapsed'));
}

function persistChromeCollapsed() {
  const down = chromeWidgetStates();
  const allDown = down.length > 0 && down.every(Boolean);
  try { localStorage.setItem('kaaro-chrome-collapsed', allDown ? '1' : '0'); } catch {}
}

function applyChromeCollapsed(collapsed) {
  document.querySelectorAll('.widget').forEach(el => {
    el.classList.toggle('collapsed', collapsed);
    const t = el.querySelector('.widget-toggle');
    if (t) t.textContent = collapsed ? '+' : '−';
  });
  try { localStorage.setItem('kaaro-chrome-collapsed', collapsed ? '1' : '0'); } catch {}
}

function collapseAllChrome() {
  const collapse = nextChromeCollapsed(chromeWidgetStates());
  applyChromeCollapsed(collapse);
  if (collapse) {
    if (typeof closePanel === 'function') closePanel();
    document.getElementById('help-panel')?.classList.remove('open');
    if (typeof window._apClose === 'function') window._apClose();
    if (typeof window.closeThread === 'function') window.closeThread();
    selectedId = null;
    if (currentLayout === 'swimlane') slHighlight(null); else highlight(null);
  }
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

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
const SHORTCUTS_DEF = [
  { key:'f', label:'F',      desc:'Force graph layout',   action:()=>setLayout('force') },
  { key:'s', label:'S',      desc:'Swimlane timeline',    action:()=>setLayout('swimlane') },
  { key:'a', label:'A',      desc:'Arc coupling map',     action:()=>setLayout('arc') },
  { key:'m', label:'M',      desc:'Matrix view',          action:()=>setLayout('matrix') },
  { key:'g', label:'G',      desc:'3D force graph',       action:()=>setLayout('3d') },
  { key:'p', label:'P',      desc:'Hex lattice layout',   action:()=>setLayout(currentLayout==='grid'?'force':'grid') },
  { key:'h', label:'H',      desc:'Collapse / expand all panels', action:()=>collapseAllChrome() },
];

function _loadSCPrefs() {
  try { return JSON.parse(localStorage.getItem('kaaro-shortcuts') || '{}'); } catch { return {}; }
}
let _scPrefs = _loadSCPrefs();
function _scEnabled(key) { return _scPrefs[key] !== false; }

function renderHelpPanel() {
  const el = document.getElementById('help-content');
  if (!el) return;
  el.innerHTML = [
    '<div class="help-h">◆ SHORTCUTS <span class="help-hint">press key to live-test</span></div>',
    ...SHORTCUTS_DEF.map(s => {
      const on = _scEnabled(s.key);
      return `<div class="help-row" id="hrow-${s.key}">` +
        `<span class="help-key">${s.label}</span>` +
        `<span class="help-desc">${s.desc}</span>` +
        `<button class="help-toggle ${on?'on':'off'}" data-key="${s.key}">${on?'ON':'OFF'}</button>` +
        `</div>`;
    }),
    '<div class="help-sep"></div>',
    '<div class="help-row"><span class="help-key">?</span><span class="help-desc">Toggle this panel</span><span class="help-fixed">—</span></div>',
    '<div class="help-row"><span class="help-key">ESC</span><span class="help-desc">Close panel · deselect</span><span class="help-fixed">—</span></div>',
    '<div class="help-row"><span class="help-key">↺</span><span class="help-desc">Reset layout options (asks first)</span><span class="help-fixed">—</span></div>',
    '<div class="help-sep"></div>',
    '<div class="help-h">◆ MOUSE</div>',
    '<div class="help-row"><span class="help-key">Drag</span><span class="help-desc">Pan · reposition node (force/lattice snap)</span></div>',
    '<div class="help-row"><span class="help-key">Scroll</span><span class="help-desc">Zoom in / out</span></div>',
    '<div class="help-row"><span class="help-key">Click</span><span class="help-desc">Select and inspect</span></div>',
    '<div class="help-sep"></div>',
    '<div class="help-row"><span class="help-key">$</span><span class="help-desc">Optional support · github is free</span><span class="help-fixed">—</span></div>',
    '<div class="help-footer" id="help-close">[ CLOSE ]</div>',
  ].join('');
  el.querySelectorAll('.help-toggle').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const k = btn.dataset.key;
      _scPrefs[k] = !_scEnabled(k);
      try { localStorage.setItem('kaaro-shortcuts', JSON.stringify(_scPrefs)); } catch {}
      renderHelpPanel();
    });
  });
  document.getElementById('help-close').addEventListener('click', () => {
    document.getElementById('help-panel').classList.remove('open');
  });
}

function _flashRow(key) {
  const row = document.getElementById('hrow-' + key);
  if (!row) return;
  row.classList.remove('flashing');
  void row.offsetWidth;
  row.classList.add('flashing');
  setTimeout(() => row.classList.remove('flashing'), 420);
}

document.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA') return;
  if (ev.key === '?') {
    ev.preventDefault();
    const hp = document.getElementById('help-panel');
    const opening = !hp.classList.contains('open');
    hp.classList.toggle('open');
    if (opening) renderHelpPanel();
    return;
  }
  if (ev.key === 'Escape') {
    const hp = document.getElementById('help-panel');
    if (hp.classList.contains('open')) { hp.classList.remove('open'); return; }
    if (selectedId) { selectedId=null; if(currentLayout==='swimlane') slHighlight(null); else highlight(null); closePanel(); }
    return;
  }
  const key = ev.key.toLowerCase();
  const sc = SHORTCUTS_DEF.find(s => s.key === key);
  if (sc && _scEnabled(sc.key)) { ev.preventDefault(); sc.action(); _flashRow(sc.key); }
});

buildTimeline();
nodeSel.call(drag);
try {
  if (localStorage.getItem('kaaro-chrome-collapsed') === '1') applyChromeCollapsed(true);
} catch {}
