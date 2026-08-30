// Hex lattice on the same #canvas as the force graph. Left dock is the minimap.
(function () {
  const STORE = 'kaaro-glyph-board';
  const MINI_R = 7;
  const MAX_LATTICE_CELLS = 1800;
  const dockBody = document.getElementById('glyph-dock-body');
  if (typeof GRAPH === 'undefined' || typeof decorLayer === 'undefined') return;

  function projectList() {
    return GRAPH.nodes.filter(n => n.type === 'project').slice().sort((a, b) => a.id < b.id ? -1 : 1);
  }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
  }
  function saveStore(payload) {
    try { localStorage.setItem(STORE, JSON.stringify(payload)); } catch {}
  }

  function graphCfg() {
    return glyphGraphConfig(W, H);
  }

  function boardState() {
    const list = projectList();
    const raw = loadStore();
    const placements = mergeGlyphPlacements(list.map(p => p.id), raw.placements);
    return { list, placements, cfg: graphCfg() };
  }

  function refreshSeatCity() {
    const st = boardState();
    const sessions = GRAPH.nodes.filter(n =>
      n.type === 'session' && sessionMatchesFilters(n, SESSION_FILTERS));
    window._seatCity = buildSeatCity({
      projects: st.list,
      sessions,
      files: GRAPH.nodes.filter(n => n.type === 'file'),
      edges: GRAPH.edges,
      placements: st.placements,
    });
  }

  function persist(placements) {
    saveStore({ placements });
  }

  function canvasWorldRect() {
    const t = d3.zoomTransform(svg.node());
    const k = t.k || 1;
    return {
      worldX: -t.x / k,
      worldY: -t.y / k,
      worldW: W / k,
      worldH: H / k,
    };
  }

  function applySeats() {
    if (typeof restoreForceLayout === 'function') {
      restoreForceLayout();
      if (typeof simulation !== 'undefined') simulation.alpha(0.35).restart();
    }
  }

  function drawGridDecor() {
    if (currentLayout !== 'grid') {
      clearGridDecor();
      return;
    }
    const st = boardState();
    const vis = canvasWorldRect();
    const pad = st.cfg.r * 2;
    let cells = glyphLatticeWindow({
      x0: vis.worldX - pad,
      y0: vis.worldY - pad,
      x1: vis.worldX + vis.worldW + pad,
      y1: vis.worldY + vis.worldH + pad,
      ...st.cfg,
      pad: 1,
    });
    const occupied = new Set(Object.values(st.placements).map(p => p.col + ',' + p.row));
    if (cells.length > MAX_LATTICE_CELLS) {
      cells = Object.keys(st.placements).map(id => {
        const p = st.placements[id];
        return { col: p.col, row: p.row, ...glyphCellPosition(p.col, p.row, st.cfg) };
      });
    }
    decorLayer.selectAll('path.grid-hex')
      .data(cells, d => d.col + ',' + d.row)
      .join('path')
      .attr('class', d => occupied.has(d.col + ',' + d.row) ? 'grid-hex occ' : 'grid-hex')
      .attr('d', hexPath(st.cfg.r))
      .attr('transform', d => `translate(${d.x},${d.y})`);
  }

  function clearGridDecor() {
    decorLayer.selectAll('path.grid-hex').remove();
  }

  function renderMe() {
    const el = document.getElementById('me-glyph-body');
    const count = document.getElementById('me-glyph-count');
    const sessions = GRAPH.nodes.filter(n => n.type === 'session');
    const me = meGlyph(sessions);
    if (count) count.textContent = me.total ? String(me.total) : '';
    if (!el) return;
    el.innerHTML = meGlyphCardHtml(me, { r: 28, bg: KAARO_TOKENS.bg, color: KAARO_TOKENS.accent });
  }

  function renderMinimap() {
    renderMe();
    if (!dockBody) return;
    const st = boardState();
    const live = st.list.filter(isProjectGlyphActive).length;
    const count = document.getElementById('glyph-dock-count');
    if (count) count.textContent = live + '/' + st.list.length;
    dockBody.innerHTML = projectGlyphFieldSvg(st.list, {
      r: MINI_R, originX: 0, originY: 0, bg: KAARO_TOKENS.bg,
      placements: st.placements, lattice: true,
    });
    const mini = dockBody.querySelector('svg');
    if (!mini) return;
    const vis = canvasWorldRect();
    const rect = graphRectToMinimap(vis, {
      graphR: st.cfg.r, miniR: MINI_R,
      originX: st.cfg.originX, originY: st.cfg.originY,
    });
    const ns = 'http://www.w3.org/2000/svg';
    const v = document.createElementNS(ns, 'rect');
    v.setAttribute('class', 'pglyph-view');
    v.setAttribute('x', rect.x);
    v.setAttribute('y', rect.y);
    v.setAttribute('width', Math.max(2, rect.w));
    v.setAttribute('height', Math.max(2, rect.h));
    mini.appendChild(v);
  }

  function panCanvasTo(wx, wy) {
    const t = d3.zoomTransform(svg.node());
    const k = t.k || 1;
    const nx = wx * k + t.x, ny = wy * k + t.y;
    svg.transition().duration(280).call(zoom.translateBy, (W / 2 - nx) / k, (H / 2 - ny) / k);
  }

  function focusProject(id) {
    const node = typeof nodeById !== 'undefined' ? nodeById[id] : GRAPH.nodes.find(n => n.id === id);
    if (!node) return;
    selectedId = id;
    if (typeof highlight === 'function') highlight(id);
    if (typeof showPanel === 'function') showPanel(node);
  }

  function openLattice(pid) {
    if (currentLayout !== 'grid') setLayout('grid');
    const st = boardState();
    if (pid && st.placements[pid]) {
      const pos = glyphCellPosition(st.placements[pid].col, st.placements[pid].row, st.cfg);
      panCanvasTo(pos.x, pos.y);
      focusProject(pid);
    }
    renderMinimap();
  }

  function closeLattice() {
    if (currentLayout === 'grid') setLayout('force');
  }

  function toggleLattice() {
    if (currentLayout === 'grid') closeLattice();
    else openLattice();
  }

  function seatGlyphAt(id, x, y) {
    const st = boardState();
    const snap = snapToGlyphCell(x, y, st.cfg);
    const next = moveGlyphPlacement(st.placements, id, snap.col, snap.row);
    persist(next);
    refreshSeatCity();
    if (typeof joinNodes === 'function') nodeSel = joinNodes(GRAPH);
    applySeats();
    drawGridDecor();
    renderMinimap();
    focusProject(id);
  }

  function svgUserPoint(el, clientX, clientY) {
    const pt = el.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = el.getScreenCTM();
    if (!m) return [0, 0];
    const p = pt.matrixTransform(m.inverse());
    return [p.x, p.y];
  }

  dockBody?.addEventListener('click', ev => {
    const g = ev.target.closest('[data-pid]');
    const mini = dockBody.querySelector('svg');
    ev.stopPropagation();
    if (g) {
      openLattice(g.getAttribute('data-pid'));
      return;
    }
    if (!mini) { openLattice(); return; }
    const [mx, my] = svgUserPoint(mini, ev.clientX, ev.clientY);
    const snap = snapToGlyphCell(mx, my, { r: MINI_R, originX: 0, originY: 0 });
    const pos = glyphCellPosition(snap.col, snap.row, boardState().cfg);
    openLattice();
    panCanvasTo(pos.x, pos.y);
  });

  document.getElementById('glyph-dock-expand')?.addEventListener('click', ev => {
    ev.stopPropagation();
    toggleLattice();
  });

  zoom.on('zoom.minimap', () => renderMinimap());

  window.openGlyphBoard = openLattice;
  window.closeGlyphBoard = closeLattice;
  window.toggleGlyphBoard = toggleLattice;
  window.refreshGlyphDock = renderMinimap;
  window.drawGridDecor = drawGridDecor;
  window.clearGridDecor = clearGridDecor;
  window.seatGlyphAt = seatGlyphAt;
  window.glyphBoardPins = function (width, height) {
    return glyphGraphPins(boardState().placements, { width, height });
  };

  window.refreshSeatCity = refreshSeatCity;
  refreshSeatCity();
  if (typeof joinNodes === 'function') nodeSel = joinNodes(GRAPH);
  renderMinimap();
  const HASH_LAYOUTS = new Set(['force', 'swimlane', 'arc', 'matrix', '3d']);
  const hash = (location.hash || '').replace(/^#/, '');
  if (HASH_LAYOUTS.has(hash)) setTimeout(() => setLayout(hash), 0);
  else setTimeout(() => setLayout('grid', { forceEnter: true }), 0);
})();
