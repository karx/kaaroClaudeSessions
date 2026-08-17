// ── Arc layout ────────────────────────────────────────────────────────────────
let arcXScale = null;
let focusedArcFileId = null;

const ARC_AXIS_Y = () => H * 0.5;
const ARC_ROW_SPACING = 34;

// ── Position sessions on the time spine ──────────────────────────────────────
function computeArcPositions() {
  const sessions  = GRAPH.nodes.filter(n => n.type === 'session');
  const projects  = GRAPH.nodes.filter(n => n.type === 'project');
  const groupProj = document.getElementById('arc-group-proj')?.checked;
  const numProj   = projects.length;

  // Sort projects by earliest session timestamp for stable row assignment
  const projMinTs = {};
  sessions.forEach(s => {
    if (!s.first_timestamp) return;
    const ts = +new Date(s.first_timestamp);
    if (projMinTs[s.project_id] == null || ts < projMinTs[s.project_id]) projMinTs[s.project_id] = ts;
  });
  const projRank = {};
  projects.slice().sort((a, b) => (projMinTs[a.id] || 0) - (projMinTs[b.id] || 0))
    .forEach((p, i) => projRank[p.id] = i);

  // Time scale across all sessions
  const tsSess = sessions.filter(s => s.first_timestamp);
  const tMin = tsSess.length ? new Date(d3.min(tsSess, s => s.first_timestamp)) : new Date(Date.now() - 7 * 864e5);
  const tMax = tsSess.length ? new Date(d3.max(tsSess, s => s.first_timestamp)) : new Date();
  arcXScale = d3.scaleTime().domain([tMin, tMax]).range([90, W - 60]).nice();

  const baseY = ARC_AXIS_Y();
  sessions.forEach(s => {
    s.x = s.first_timestamp ? arcXScale(new Date(s.first_timestamp)) : W / 2;
    s.y = (groupProj && numProj > 1)
      ? baseY + ((projRank[s.project_id] ?? 0) - (numProj - 1) / 2) * ARC_ROW_SPACING
      : baseY;
    s.fx = s.x; s.fy = s.y;
  });
}

// ── Time axis decoration ──────────────────────────────────────────────────────
function drawArcDecor() {
  decorLayer.selectAll('*').remove();
  if (!arcXScale) return;

  const groupProj = document.getElementById('arc-group-proj')?.checked;
  const projects  = GRAPH.nodes.filter(n => n.type === 'project');
  const numProj   = projects.length;
  const baseY     = ARC_AXIS_Y();

  // Rebuild projRank for decor
  const sessions = GRAPH.nodes.filter(n => n.type === 'session');
  const projMinTs = {};
  sessions.forEach(s => {
    if (!s.first_timestamp) return;
    const ts = +new Date(s.first_timestamp);
    if (projMinTs[s.project_id] == null || ts < projMinTs[s.project_id]) projMinTs[s.project_id] = ts;
  });
  const projRank = {};
  const sortedProj = projects.slice().sort((a, b) => (projMinTs[a.id] || 0) - (projMinTs[b.id] || 0));
  sortedProj.forEach((p, i) => projRank[p.id] = i);

  if (groupProj && numProj > 1) {
    sortedProj.forEach(p => {
      const rowY = baseY + ((projRank[p.id] ?? 0) - (numProj - 1) / 2) * ARC_ROW_SPACING;
      decorLayer.append('line')
        .attr('x1', 80).attr('x2', W - 50).attr('y1', rowY).attr('y2', rowY)
        .attr('stroke', p.color).attr('stroke-width', 0.6).attr('stroke-opacity', 0.2);
      decorLayer.append('text')
        .attr('x', 76).attr('y', rowY + 3.5).attr('text-anchor', 'end')
        .attr('font-size', 8).attr('fill', p.color).attr('fill-opacity', 0.55)
        .attr('font-family', 'Courier New,monospace').text(p.label.toUpperCase());
    });
  } else {
    decorLayer.append('line')
      .attr('x1', 80).attr('x2', W - 50).attr('y1', baseY).attr('y2', baseY)
      .attr('stroke', '#1e1e3a').attr('stroke-width', 1.5);
  }

  // Time ticks at bottom of band
  const bottomY = groupProj && numProj > 1
    ? baseY + ((numProj - 1) / 2) * ARC_ROW_SPACING : baseY;
  arcXScale.ticks(10).forEach(t => {
    const x = arcXScale(t);
    decorLayer.append('line')
      .attr('x1', x).attr('x2', x).attr('y1', bottomY + 6).attr('y2', bottomY + 13)
      .attr('stroke', '#252545').attr('stroke-width', 1);
    decorLayer.append('text')
      .attr('x', x).attr('y', bottomY + 24).attr('text-anchor', 'middle')
      .attr('font-size', 8).attr('fill', KAARO_TOKENS.dim).attr('font-family', 'Courier New,monospace')
      .text(d3.timeFormat('%b %d')(t));
  });

  // Mode label
  const modeEl = document.getElementById('arc-mode');
  const modeLabels = { 'file-shared': 'FILE CO-ACCESS', 'branch': 'BRANCH LINEAGE', 'sequence': 'SESSION SEQUENCE' };
  decorLayer.append('text')
    .attr('x', 90).attr('y', 22).attr('font-size', 9).attr('fill', '#2d3d60').attr('fill-opacity', 0.9)
    .attr('font-family', 'Courier New,monospace').attr('letter-spacing', 1.5)
    .text(modeLabels[modeEl?.value] || '');
}

// ── Arc data computation ──────────────────────────────────────────────────────
function getArcOpts() {
  const maxSpanRaw = +(document.getElementById('arc-max-span')?.value || 365);
  return {
    mode:      document.getElementById('arc-mode')?.value    || 'file-shared',
    minShared: +(document.getElementById('arc-min-shared')?.value || 1),
    maxSpan:   maxSpanRaw >= 365 ? Infinity : maxSpanRaw,
    colorBy:   document.getElementById('arc-color-by')?.value || 'file'
  };
}

function computeFileSharedArcs(opts) {
  const { minShared, maxSpan, colorBy } = opts;

  // file → sessions that wrote/edited it
  const fileSess = {};
  GRAPH.edges.forEach(e => {
    if (e.type !== 'write' && e.type !== 'edit') return;
    const sid = e.source?.id ?? e.source, fid = e.target?.id ?? e.target;
    (fileSess[fid] = fileSess[fid] || []).push(sid);
  });

  // pair → { files, colors }
  const pairs = {};
  Object.entries(fileSess).forEach(([fid, sids]) => {
    const fNode = nodeById[fid];
    const uniq = [...new Set(sids)];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const [a, b] = [uniq[i], uniq[j]].sort();
        const key = `${a}::${b}`;
        if (!pairs[key]) pairs[key] = { sidA: a, sidB: b, files: new Set(), colors: [] };
        pairs[key].files.add(fid);
        if (fNode?.color) pairs[key].colors.push(fNode.color);
      }
    }
  });

  const arcs = [];
  Object.values(pairs).forEach(p => {
    if (p.files.size < minShared) return;
    const nA = nodeById[p.sidA], nB = nodeById[p.sidB];
    if (!nA || !nB || nA.x == null || nB.x == null) return;
    const spanDays = (nA.first_timestamp && nB.first_timestamp)
      ? Math.abs(+new Date(nA.first_timestamp) - +new Date(nB.first_timestamp)) / 864e5 : 0;
    if (spanDays > maxSpan) return;
    const color = colorBy === 'file' ? (p.colors[0] || KAARO_TOKENS.accent)
                : colorBy === 'project' ? nA.color : KAARO_TOKENS.dim;
    arcs.push({ x1: nA.x, y1: nA.y, x2: nB.x, y2: nB.y,
      count: p.files.size, color, spanDays, files: [...p.files], sidA: p.sidA, sidB: p.sidB });
  });
  return arcs;
}

function computeBranchArcs(opts) {
  const { maxSpan, colorBy } = opts;
  const branchMap = {};
  GRAPH.nodes.filter(n => n.type === 'session' && n.git_branch).forEach(s => {
    (branchMap[s.git_branch] = branchMap[s.git_branch] || []).push(s);
  });
  const arcs = [];
  Object.entries(branchMap).forEach(([branch, sessions]) => {
    if (sessions.length < 2) return;
    sessions.sort((a, b) => +new Date(a.first_timestamp) - +new Date(b.first_timestamp));
    for (let i = 0; i < sessions.length - 1; i++) {
      const nA = sessions[i], nB = sessions[i + 1];
      if (nA.x == null || nB.x == null) continue;
      const spanDays = (nA.first_timestamp && nB.first_timestamp)
        ? Math.abs(+new Date(nA.first_timestamp) - +new Date(nB.first_timestamp)) / 864e5 : 0;
      if (spanDays > maxSpan) continue;
      const color = colorBy === 'project' ? nA.color : '#3a5a99';
      arcs.push({ x1: nA.x, y1: nA.y, x2: nB.x, y2: nB.y,
        count: 1, color, spanDays, files: [], sidA: nA.id, sidB: nB.id, branch });
    }
  });
  return arcs;
}

function computeSequenceArcs(opts) {
  const { colorBy } = opts;
  const projMap = {};
  GRAPH.nodes.filter(n => n.type === 'session').forEach(s => {
    (projMap[s.project_id] = projMap[s.project_id] || []).push(s);
  });
  const arcs = [];
  Object.values(projMap).forEach(sessions => {
    if (sessions.length < 2) return;
    sessions.sort((a, b) => +new Date(a.first_timestamp) - +new Date(b.first_timestamp));
    for (let i = 0; i < sessions.length - 1; i++) {
      const nA = sessions[i], nB = sessions[i + 1];
      if (nA.x == null || nB.x == null) continue;
      const spanDays = (nA.first_timestamp && nB.first_timestamp)
        ? Math.abs(+new Date(nA.first_timestamp) - +new Date(nB.first_timestamp)) / 864e5 : 0;
      const color = colorBy === 'project' ? nA.color : '#3a4a6a';
      arcs.push({ x1: nA.x, y1: nA.y, x2: nB.x, y2: nB.y,
        count: 1, color, spanDays, files: [], sidA: nA.id, sidB: nB.id });
    }
  });
  return arcs;
}

// ── Arc rendering ─────────────────────────────────────────────────────────────
function drawArcArcs() {
  arcArcLayer.selectAll('*').remove();
  if (!arcXScale) return;

  const opts = getArcOpts();

  // Respect date filter
  const hiddenSids = new Set();
  {
    GRAPH.nodes.filter(n => n.type === 'session').forEach(n => {
      if (!sessionMatchesFilters(n, SESSION_FILTERS)) hiddenSids.add(n.id);
    });
  }

  let arcs = opts.mode === 'file-shared' ? computeFileSharedArcs(opts)
           : opts.mode === 'branch'      ? computeBranchArcs(opts)
           : computeSequenceArcs(opts);

  arcs = arcs.filter(a => !hiddenSids.has(a.sidA) && !hiddenSids.has(a.sidB));

  const hubEl = document.getElementById('arc-file-hub');
  if (!arcs.length) {
    if (hubEl) hubEl.style.display = 'none';
    return;
  }

  const maxCount = Math.max(1, d3.max(arcs, d => d.count));
  // Render lower-count arcs first so high-count arcs sit on top
  arcs.sort((a, b) => a.count - b.count);

  arcs.forEach(arc => {
    const mx   = (arc.x1 + arc.x2) / 2;
    const span = Math.abs(arc.x2 - arc.x1);
    const t    = arc.count / maxCount;
    // Height: taller for more shared files, with a span component so nearby sessions still arc visibly
    const h    = Math.max(28, 18 + 100 * t + span * 0.1);
    const topY = Math.min(arc.y1, arc.y2) - Math.min(h, H * 0.33);

    const dimmed  = focusedArcFileId && !arc.files.includes(focusedArcFileId);
    const opacity = dimmed ? 0.03 : 0.25 + 0.55 * t;
    const width   = dimmed ? 0.4  : 0.6  + 2.5 * t;

    arcArcLayer.append('path')
      .attr('d', `M${arc.x1},${arc.y1} Q${mx},${topY} ${arc.x2},${arc.y2}`)
      .attr('fill', 'none')
      .attr('stroke', arc.color)
      .attr('stroke-width', width)
      .attr('stroke-opacity', opacity)
      .style('cursor', 'default')
      .on('mouseover', ev => {
        const nA = nodeById[arc.sidA], nB = nodeById[arc.sidB];
        const fileLabel = arc.files.length
          ? arc.files.slice(0, 5).map(fid => nodeById[fid]?.label || fid).join(', ')
            + (arc.files.length > 5 ? ` +${arc.files.length - 5} more` : '')
          : null;
        tip.style.display = 'block';
        tip.innerHTML =
          `<strong style="color:${arc.color}">${nA?.label || '?'}</strong>
           <div class="meta">↔ <span style="color:${nB?.color || '#aaa'}">${nB?.label || '?'}</span></div>
           ${fileLabel ? `<div class="meta">shared: ${fileLabel}</div>` : ''}
           ${arc.branch ? `<div class="meta">branch: ${arc.branch}</div>` : ''}
           <div class="meta">${Math.round(arc.spanDays)}d apart${arc.count > 1 ? ` · ${arc.count} files` : ''}</div>`;
      })
      .on('mousemove', ev => {
        tip.style.left = Math.min(ev.clientX + 16, W - 340) + 'px';
        tip.style.top  = Math.min(ev.clientY - 8, H - tip.offsetHeight - 10) + 'px';
      })
      .on('mouseout', () => tip.style.display = 'none');
  });

  updateArcFileHub(arcs, opts.mode);
}

function updateArcFileHub(arcs, mode) {
  const hubEl  = document.getElementById('arc-file-hub');
  const listEl = document.getElementById('arc-file-hub-list');
  if (!hubEl || !listEl) return;

  if (mode !== 'file-shared' || !arcs.length) { hubEl.style.display = 'none'; return; }
  hubEl.style.display = '';

  const counts = {};
  arcs.forEach(arc => arc.files.forEach(fid => { counts[fid] = (counts[fid] || 0) + 1; }));
  const top = Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, 9);

  listEl.innerHTML = top.map(([fid, cnt]) => {
    const f      = nodeById[fid];
    const active = focusedArcFileId === fid;
    return `<div class="arc-hub-row${active ? ' arc-hub-active' : ''}" data-fid="${fid}" style="color:${f?.color || '#aaa'}">
      <span class="arc-hub-cnt">${cnt}×</span>${f?.label || fid}
    </div>`;
  }).join('');

  listEl.querySelectorAll('.arc-hub-row').forEach(el => {
    el.addEventListener('click', () => {
      focusedArcFileId = focusedArcFileId === el.dataset.fid ? null : el.dataset.fid;
      drawArcArcs();
    });
  });
}

// ── Apply static positions (arc layout) ──────────────────────────────────────
function applyStaticPositions() {
  GRAPH.nodes.forEach(n => { if (n.fx != null) n.x = n.fx; if (n.fy != null) n.y = n.fy; });
  nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
  edgeSel.attr('d', edgePathD);
  projLabelSel.attr('x', d => d.x ?? 0).attr('y', d => (d.y ?? 0) + PROJ_R + 13);
}

// ── Lifecycle hooks (referenced from LAYOUT_HANDLERS.arc) ────────────────────
function arcApplyFilters() {
  nodeSel.attr('display', d => {
    if (d.type !== 'session') return 'none';
    if (!sessionMatchesFilters(d, SESSION_FILTERS)) return 'none';
    return null;
  });
  edgeSel.attr('display', 'none');
  projLabelSel.attr('display', 'none');
  if (arcXScale) drawArcArcs();
}

function arcResize() {
  computeArcPositions(); drawArcDecor(); applyStaticPositions();
}
