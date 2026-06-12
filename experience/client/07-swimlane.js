// â”€â”€ Swimlane: settings accessors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SL = {
  get heightMetric() { return document.getElementById('sl-height-sel')?.value ?? 'tokens'; },
  get widthMode()    { return document.getElementById('sl-width-sel')?.value  ?? 'duration'; },
  get colorBy()      { return document.getElementById('sl-color-sel')?.value  ?? 'project'; },
  get subBranch()    { return document.getElementById('sl-subbranch')?.checked ?? true; },
  get branchLabels() { return document.getElementById('sl-blabels')?.checked  ?? true; },
  get laneOrder()    { return document.getElementById('sl-order-sel')?.value   ?? 'recent'; },
  get gridUnit()     { return document.getElementById('sl-grid-sel')?.value    ?? 'auto'; },
  get labelMode()    { return document.getElementById('sl-label-sel')?.value   ?? 'date'; },
};

// â”€â”€ Swimlane: color helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const BRANCH_PALETTE = ['#00aaff','#ff4488','#cc44ff','#ff8800','#00ff88','#ffcc00','#00cccc','#44ffaa','#ff88cc','#8844ff'];
function branchColor(branch) {
  if (!branch || branch === '__no-branch__') return '#334455';
  let h = 0;
  for (let i = 0; i < branch.length; i++) h = (Math.imul(h, 31) + branch.charCodeAt(i)) | 0;
  return BRANCH_PALETTE[Math.abs(h) % BRANCH_PALETTE.length];
}
function modelColor(model) {
  if (!model) return '#445566';
  if (model.includes('opus'))   return '#cc44ff';
  if (model.includes('sonnet')) return '#00aaff';
  if (model.includes('haiku'))  return '#00cccc';
  return '#888888';
}
function getSessionMetric(s, metric) {
  if (metric === 'tokens')   return s.tokens_work   || 0;
  if (metric === 'calls')    return s.tool_calls     || 0;
  if (metric === 'duration') return s.duration_min   || 0;
  if (metric === 'errors')   return s.tool_errors    || 0;
  return s.tokens_work || 0;
}
function getSessionColor(s, colorBy) {
  if (colorBy === 'branch')  return branchColor(s.git_branch);
  if (colorBy === 'model')   return modelColor(s.model);
  if (colorBy === 'recency') {
    const r = s.recency || 0;
    return r > 0.66 ? '#00ffcc' : r > 0.33 ? '#00aaff' : r > 0 ? '#334488' : '#223344';
  }
  if (colorBy === 'errors')  return s.errorLevel===2?'#ff2244':s.errorLevel===1?'#ff8833':s.color;
  return s.color; // project
}

// â”€â”€ Swimlane: bar positions (for timeline pan-to) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const slBarPos = {};

// â”€â”€ Swimlane: main render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderSwimlane() {
  slLayer.selectAll('*').remove();
  decorLayer.selectAll('*').remove();
  Object.keys(slBarPos).forEach(k => delete slBarPos[k]);

  const ML = 170, MT = 46, MR = 20, MB = 20;

  let sessions = GRAPH.nodes.filter(n => n.type === 'session')
    .filter(s => !tlFrom || !s.date_str || s.date_str >= tlFrom);

  const projects = GRAPH.nodes.filter(n => n.type === 'project');

  // Lane ordering
  const orderedProjects = [...projects].sort((a, b) => {
    if (SL.laneOrder === 'work') {
      const aw = d3.sum(sessions.filter(s=>s.project_id===a.id), s=>s.tokens_work||0);
      const bw = d3.sum(sessions.filter(s=>s.project_id===b.id), s=>s.tokens_work||0);
      return bw - aw;
    }
    if (SL.laneOrder === 'count') return b.session_count - a.session_count;
    if (SL.laneOrder === 'recent') {
      const aTs = d3.max(sessions.filter(s=>s.project_id===a.id).map(s=>s.first_timestamp||'')) || '';
      const bTs = d3.max(sessions.filter(s=>s.project_id===b.id).map(s=>s.first_timestamp||'')) || '';
      return bTs < aTs ? -1 : 1;
    }
    return a.label < b.label ? -1 : 1; // alpha
  });

  // Time scale
  const tsSess = sessions.filter(s => s.first_timestamp);
  if (!tsSess.length) {
    decorLayer.append('text').attr('x', W/2).attr('y', H/2)
      .attr('text-anchor','middle').attr('font-size',13).attr('fill','#2a2a44')
      .attr('font-family','Courier New,monospace').text('No sessions in range');
    return;
  }
  const tMin = new Date(d3.min(tsSess, s=>s.first_timestamp));
  const tMax = new Date(d3.max(tsSess, s=>s.first_timestamp));
  const span = Math.max(tMax - tMin, 1);
  const tMinPad = new Date(tMin.getTime() - span * 0.015);
  const tMaxPad = new Date(tMax.getTime() + span * 0.04);
  const xScale  = d3.scaleTime().domain([tMinPad, tMaxPad]).range([ML, W - MR]);

  // Metric normalization
  const metric    = SL.heightMetric;
  const maxMetric = Math.max(1, d3.max(sessions, s => getSessionMetric(s, metric)));
  const maxDur    = Math.max(1, d3.max(sessions, s => s.duration_min || 0));

  // Branch groups per project
  const projBranches = {};
  sessions.forEach(s => {
    const b = s.git_branch || '__no-branch__';
    if (!projBranches[s.project_id]) projBranches[s.project_id] = new Set();
    projBranches[s.project_id].add(b);
  });
  const sortBranches = set => [...set].sort((a, b) => {
    const main = s => s==='main'||s==='master';
    if (main(a)&&!main(b)) return -1; if (!main(a)&&main(b)) return 1;
    return a < b ? -1 : 1;
  });

  // Lane geometry
  const BRANCH_ROW_H = 46;
  const FLAT_LANE_H  = 66;
  const LANE_PAD     = 8;
  const MAX_BAR_FRAC = 0.80;
  const MIN_BAR_W    = 5;

  const laneInfo = {};
  let curY = MT;
  for (const proj of orderedProjects) {
    const branches = sortBranches(projBranches[proj.id] || new Set(['__no-branch__']));
    const laneH = SL.subBranch
      ? Math.max(FLAT_LANE_H, branches.length * BRANCH_ROW_H + LANE_PAD * 2)
      : FLAT_LANE_H;
    const branchRows = {};
    branches.forEach((b, i) => {
      branchRows[b] = SL.subBranch
        ? { y: curY + LANE_PAD + i * BRANCH_ROW_H, h: BRANCH_ROW_H }
        : { y: curY + LANE_PAD, h: laneH - LANE_PAD * 2 };
    });
    laneInfo[proj.id] = { y: curY, h: laneH, branches, branchRows };
    curY += laneH;
  }
  const totalH = curY + MB;

  // â”€â”€ Time grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const autoGrid  = span < 14*864e5 ? 'day' : span < 90*864e5 ? 'week' : 'month';
  const gridUnit  = SL.gridUnit === 'auto' ? autoGrid : SL.gridUnit;
  const timeIntvl = gridUnit==='day' ? d3.timeDay : gridUnit==='week' ? d3.timeMonday : d3.timeMonth;
  const gridTicks = timeIntvl.range(tMinPad, tMaxPad);
  const timeFmt   = d3.timeFormat(gridUnit==='month' ? '%b %Y' : '%m/%d');

  gridTicks.forEach((t, i) => {
    const x  = xScale(t);
    const x2 = i+1 < gridTicks.length ? xScale(gridTicks[i+1]) : W - MR;
    if (i % 2 === 0)
      decorLayer.append('rect').attr('x',x).attr('y',MT).attr('width',Math.max(0,x2-x)).attr('height',totalH-MT)
        .attr('fill','#0a0a1a').attr('fill-opacity',0.45);
    decorLayer.append('line').attr('x1',x).attr('x2',x).attr('y1',MT).attr('y2',totalH)
      .attr('stroke','#141428').attr('stroke-width',0.5);
    decorLayer.append('text').attr('x',x+3).attr('y',MT-6).attr('font-size',8)
      .attr('fill','#252548').attr('font-family','Courier New,monospace').text(timeFmt(t));
  });

  // â”€â”€ Lane backgrounds + labels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  orderedProjects.forEach(proj => {
    const { y, h, branches, branchRows } = laneInfo[proj.id];

    decorLayer.append('rect').attr('x',0).attr('y',y).attr('width',W).attr('height',h)
      .attr('fill', proj.color).attr('fill-opacity', 0.025);
    decorLayer.append('line').attr('x1',0).attr('x2',W).attr('y1',y).attr('y2',y)
      .attr('stroke','#1a1a2e').attr('stroke-width',1);
    decorLayer.append('text').attr('x',6).attr('y',y+13).attr('font-size',9)
      .attr('fill',proj.color).attr('fill-opacity',0.85)
      .attr('font-family','Courier New,monospace').attr('letter-spacing',1)
      .text(proj.label.toUpperCase());

    if (SL.subBranch && branches.length > 1) {
      branches.forEach((b, i) => {
        const row = branchRows[b];
        if (i > 0) {
          decorLayer.append('line')
            .attr('x1',ML).attr('x2',W-MR).attr('y1',row.y).attr('y2',row.y)
            .attr('stroke','#111128').attr('stroke-width',0.5).attr('stroke-dasharray','4 4');
        }
        if (SL.branchLabels) {
          const lbl = b==='__no-branch__' ? '?' : b.length>24 ? 'â€¦'+b.slice(-22) : b;
          decorLayer.append('text').attr('x',ML-6).attr('y',row.y + row.h/2 + 3)
            .attr('text-anchor','end').attr('font-size',8)
            .attr('fill', branchColor(b)).attr('fill-opacity',0.7)
            .attr('font-family','Courier New,monospace').text(lbl);
        }
      });
    }
  });
  decorLayer.append('line').attr('x1',0).attr('x2',W).attr('y1',curY).attr('y2',curY)
    .attr('stroke','#1a1a2e').attr('stroke-width',1);
  decorLayer.append('line').attr('x1',ML).attr('x2',ML).attr('y1',MT).attr('y2',curY)
    .attr('stroke','#141428').attr('stroke-width',1);

  // â”€â”€ Bar width helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const wm = SL.widthMode;
  function barW(s) {
    if (wm === 'duration' && s.duration_min && s.first_timestamp) {
      const endX = xScale(new Date(new Date(s.first_timestamp).getTime() + s.duration_min * 60000));
      return Math.max(MIN_BAR_W, endX - xScale(new Date(s.first_timestamp)));
    }
    if (wm === 'tokens') return Math.max(MIN_BAR_W, 7 + 52 * Math.sqrt(s.tokens_work / maxMetric));
    return 12; // fixed
  }

  // â”€â”€ Group sessions by project â†’ branch for lineage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const pbSessions = {};
  sessions.forEach(s => {
    const b = s.git_branch || '__no-branch__';
    if (!pbSessions[s.project_id]) pbSessions[s.project_id] = {};
    if (!pbSessions[s.project_id][b]) pbSessions[s.project_id][b] = [];
    pbSessions[s.project_id][b].push(s);
  });
  for (const pid in pbSessions)
    for (const b in pbSessions[pid])
      pbSessions[pid][b].sort((a,c)=>(a.first_timestamp||'')<(c.first_timestamp||'')?-1:1);

  // â”€â”€ Draw branch lineage connectors (behind bars) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const colorBy = SL.colorBy;
  for (const [pid, branchMap] of Object.entries(pbSessions)) {
    const info = laneInfo[pid]; if (!info) continue;
    for (const [branch, ss] of Object.entries(branchMap)) {
      const row = info.branchRows[branch] ?? Object.values(info.branchRows)[0];
      if (!row) continue;
      const rowMid = row.y + row.h * 0.72;
      for (let i = 0; i < ss.length - 1; i++) {
        const a = ss[i], c = ss[i+1];
        if (!a.first_timestamp || !c.first_timestamp) continue;
        const ax = xScale(new Date(a.first_timestamp)) + barW(a);
        const cx = xScale(new Date(c.first_timestamp));
        if (cx > ax && (cx - ax) < W * 0.6) {
          slLayer.append('line')
            .attr('x1',ax).attr('y1',rowMid).attr('x2',cx).attr('y2',rowMid)
            .attr('stroke', branchColor(branch)).attr('stroke-opacity',0.3)
            .attr('stroke-width',1.5).attr('stroke-dasharray','3 3')
            .attr('pointer-events','none');
        }
      }
    }
  }

  // â”€â”€ Draw session bars â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const labelMode = SL.labelMode;

  sessions.forEach(s => {
    const info = laneInfo[s.project_id]; if (!info) return;
    const branch = s.git_branch || '__no-branch__';
    const row    = info.branchRows[branch] ?? Object.values(info.branchRows)[0];
    if (!row || !s.first_timestamp) return;

    const bx  = xScale(new Date(s.first_timestamp));
    const bw  = barW(s);
    const mVal = getSessionMetric(s, metric);
    const maxBH = row.h * MAX_BAR_FRAC;
    const bh  = Math.max(4, maxBH * (mVal / maxMetric));
    const by  = row.y + row.h - bh;
    const col = getSessionColor(s, colorBy);

    slBarPos[s.id] = { x: bx, y: by, w: bw, h: bh };

    if (s.errorLevel > 0) {
      const stroke = s.errorLevel===2 ? '#ff2244' : '#ff8833';
      slLayer.append('rect').attr('data-sid', s.id)
        .attr('x',bx-2).attr('y',by-2).attr('width',bw+4).attr('height',bh+4)
        .attr('fill','none').attr('stroke',stroke).attr('stroke-width',1.5).attr('rx',3)
        .attr('pointer-events','none');
    }

    if (s.inFlight) {
      slLayer.append('rect').attr('data-sid', s.id)
        .attr('x',bx-3).attr('y',by-3).attr('width',bw+6).attr('height',bh+6)
        .attr('fill','none').attr('stroke',IN_FLIGHT_COLOR).attr('stroke-width',2).attr('rx',4)
        .attr('pointer-events','none');
    }

    const bar = slLayer.append('rect').attr('class','sl-bar').attr('data-sid', s.id)
      .attr('x',bx).attr('y',by).attr('width',bw).attr('height',bh)
      .attr('fill',col).attr('fill-opacity',0.82)
      .attr('rx',2).attr('stroke','#000').attr('stroke-width',0.3)
      .style('cursor','pointer');

    if (s.skills?.length) {
      slLayer.append('circle').attr('data-sid', s.id)
        .attr('cx',bx+bw/2).attr('cy',by+3).attr('r',2.5)
        .attr('fill','#ffcc00').attr('fill-opacity',0.9).attr('pointer-events','none');
    }

    if (s.thinking_count > 0) {
      slLayer.append('circle').attr('data-sid', s.id)
        .attr('cx',bx+5).attr('cy',by+4).attr('r',2)
        .attr('fill','#fff').attr('fill-opacity',0.7).attr('pointer-events','none');
    }

    if (labelMode !== 'off' && bw >= 22) {
      let lbl = '';
      if (labelMode === 'date')   lbl = (s.date_str||'').slice(5);
      if (labelMode === 'branch') lbl = (s.git_branch||'?').split('/').pop().slice(0,11);
      if (labelMode === 'msg')    lbl = (s.first_user_message||'').slice(0,16);
      if (lbl) {
        slLayer.append('text').attr('data-sid', s.id)
          .attr('x',bx+3).attr('y',by+bh-3)
          .attr('font-size',7).attr('fill','#fff').attr('fill-opacity',0.65)
          .attr('font-family','Courier New,monospace').attr('pointer-events','none')
          .text(lbl);
      }
    }

    const tipHtml = () => `<strong style="color:${col}">${s.label}</strong>
      <div class="meta">${s.date_str||'?'} Â· ${s.duration_min!=null?s.duration_min+'min':'?'} Â· ${s.model||'?'}</div>
      <div class="meta">branch: ${s.git_branch||'?'}</div>
      <div class="meta">AI work: ${fmtTok(s.tokens_work)} Â· ${s.tool_calls} calls Â· ${s.tool_errors} errors</div>
      ${s.inFlight?`<div class="meta" style="color:${IN_FLIGHT_COLOR}">â¬¤ in flight</div>`:''}
      ${s.skills?.length?'<div class="meta">/'+s.skills.join(' /')+'</div>':''}
      ${s.first_user_message?'<div class="body">'+s.first_user_message.slice(0,120)+'</div>':''}`;

    bar.on('mouseover', ev => { tip.style.display='block'; tip.innerHTML=tipHtml(); })
       .on('mousemove', ev => {
          const tx=ev.clientX+16, ow=tip.offsetWidth;
          tip.style.left=(tx+ow>W-10?ev.clientX-ow-16:tx)+'px';
          tip.style.top=Math.min(ev.clientY-8,H-tip.offsetHeight-10)+'px';
        })
       .on('mouseout',  ()  => tip.style.display='none')
       .on('click', ev => {
          ev.stopPropagation();
          if (selectedId === s.id) { selectedId=null; slHighlight(null); closePanel(); }
          else { selectedId=s.id; slHighlight(s.id); showPanel(nodeById[s.id]); }
        });
  });

  // â”€â”€ Metric axis label â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const metricNames = {tokens:'token work',calls:'tool calls',duration:'duration',errors:'errors'};
  decorLayer.append('text').attr('x',W-MR-2).attr('y',curY-4).attr('text-anchor','end')
    .attr('font-size',8).attr('fill','#252548').attr('font-family','Courier New,monospace')
    .text(`bar height = ${metricNames[metric]||metric}  Â·  bar width = ${wm}  Â·  color = ${colorBy}`);
}
