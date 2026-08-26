// Project glyph board — zoomable hex canvas. The left dock is its minimap.
(function () {
  const STORE = 'kaaro-glyph-board';
  const MINI_R = 7;
  const boardEl = document.getElementById('glyph-board');
  const svgEl = document.getElementById('glyph-board-svg');
  const dockBody = document.getElementById('glyph-dock-body');
  if (!boardEl || !svgEl || typeof GRAPH === 'undefined') return;

  let open = false;
  let transform = d3.zoomIdentity;
  let zoomBeh = null;
  const svg = d3.select(svgEl);
  const world = svg.select('#glyph-board-world');

  function projectList() {
    return GRAPH.nodes.filter(n => n.type === 'project').slice().sort((a, b) => a.id < b.id ? -1 : 1);
  }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
  }
  function saveStore(payload) {
    try { localStorage.setItem(STORE, JSON.stringify(payload)); } catch {}
  }

  function boardState() {
    const list = projectList();
    const raw = loadStore();
    const auto = glyphBoardConfig(list.length);
    const cfg = {
      cols: raw.config?.cols || auto.cols,
      rows: raw.config?.rows || auto.rows,
      r: auto.r,
    };
    const placements = mergeGlyphPlacements(list.map(p => p.id), raw.placements, cfg);
    return { list, cfg, placements, world: glyphWorldExtent(cfg) };
  }

  function persist(placements, cfg) {
    saveStore({ placements, config: { cols: cfg.cols, rows: cfg.rows } });
  }

  function visibleWorld() {
    const w = svgEl.clientWidth || 1;
    const h = svgEl.clientHeight || 1;
    const k = transform.k || 1;
    return {
      worldX: -transform.x / k,
      worldY: -transform.y / k,
      worldW: w / k,
      worldH: h / k,
    };
  }

  function renderMinimap() {
    if (!dockBody) return;
    const st = boardState();
    const live = st.list.filter(isProjectGlyphActive).length;
    const count = document.getElementById('glyph-dock-count');
    if (count) count.textContent = live + '/' + st.list.length;
    const miniCfg = { r: MINI_R, cols: st.cfg.cols, rows: st.cfg.rows };
    dockBody.innerHTML = projectGlyphFieldSvg(st.list, {
      ...miniCfg, bg: KAARO_TOKENS.bg, placements: st.placements, lattice: true,
    });
    const mini = dockBody.querySelector('svg');
    if (!mini) return;
    const vis = open ? visibleWorld() : { worldX: 0, worldY: 0, worldW: st.world.width, worldH: st.world.height };
    const rect = minimapViewportRect({
      ...vis,
      boardW: st.world.width, boardH: st.world.height,
      miniW: +mini.getAttribute('width') || 1,
      miniH: +mini.getAttribute('height') || 1,
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

  function renderBoard() {
    const st = boardState();
    const g = world;
    const lattice = glyphLatticeCells(st.cfg);
    g.selectAll('path.pglyph-lattice').data(lattice, d => d.col + ',' + d.row)
      .join('path')
      .attr('class', 'pglyph-lattice')
      .attr('d', hexPath(st.cfg.r))
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .attr('fill', 'none');

    const items = st.list.map(p => {
      const slot = st.placements[p.id] || { col: 0, row: 0 };
      return { ...p, ...slot, ...glyphCellPosition(slot.col, slot.row, st.cfg) };
    });
    const cell = g.selectAll('g.pglyph-cell').data(items, d => d.id)
      .join('g')
      .attr('class', 'pglyph-cell')
      .attr('data-pid', d => d.id)
      .attr('transform', d => `translate(${d.x},${d.y})`);
    cell.each(function (d) {
      const el = d3.select(this);
      el.selectAll('*').remove();
      el.html(projectGlyphMarkup(d, { r: st.cfg.r, bg: KAARO_TOKENS.bg })
        + `<text class="pglyph-label" text-anchor="middle" y="${st.cfg.r + 10}">${esc((d.label || '').slice(0, 14))}</text>`);
    });
    cell.call(d3.drag()
      .on('start', function (ev) { ev.sourceEvent.stopPropagation(); d3.select(this).raise(); })
      .on('drag', function (ev, d) {
        d._dragged = true;
        const [x, y] = d3.pointer(ev, world.node());
        d3.select(this).attr('transform', `translate(${x},${y})`);
      })
      .on('end', function (ev, d) {
        const [x, y] = d3.pointer(ev, world.node());
        if (!d._dragged) {
          focusProject(d.id);
          return;
        }
        d._dragged = false;
        const snap = snapToGlyphCell(x, y, st.cfg);
        const next = moveGlyphPlacement(st.placements, d.id, snap.col, snap.row);
        persist(next, st.cfg);
        renderBoard();
        renderMinimap();
        focusProject(d.id);
      }));
  }

  function focusProject(id) {
    const node = typeof nodeById !== 'undefined' ? nodeById[id] : GRAPH.nodes.find(n => n.id === id);
    if (!node) return;
    selectedId = id;
    if (typeof highlight === 'function') highlight(id);
    if (typeof showPanel === 'function') showPanel(node);
  }

  function panTo(wx, wy) {
    const w = svgEl.clientWidth || 1;
    const h = svgEl.clientHeight || 1;
    const k = transform.k || 1;
    const t = d3.zoomIdentity.translate(w / 2 - wx * k, h / 2 - wy * k).scale(k);
    svg.transition().duration(280).call(zoomBeh.transform, t);
  }

  function openBoard(pid) {
    open = true;
    boardEl.classList.add('open');
    renderBoard();
    const st = boardState();
    if (pid && st.placements[pid]) {
      const pos = glyphCellPosition(st.placements[pid].col, st.placements[pid].row, st.cfg);
      panTo(pos.x, pos.y);
      focusProject(pid);
    }
    renderMinimap();
  }

  function closeBoard() {
    open = false;
    boardEl.classList.remove('open');
    renderMinimap();
  }

  function toggleBoard() { if (open) closeBoard(); else openBoard(); }

  zoomBeh = d3.zoom()
    .scaleExtent([0.25, 4])
    .filter(ev => !ev.target.closest?.('.pglyph-cell'))
    .on('zoom', ev => {
      transform = ev.transform;
      world.attr('transform', transform);
      if (open) renderMinimap();
    });
  svg.call(zoomBeh);

  dockBody?.addEventListener('click', ev => {
    const g = ev.target.closest('[data-pid]');
    const mini = dockBody.querySelector('svg');
    ev.stopPropagation();
    const st = boardState();
    if (g) {
      openBoard(g.getAttribute('data-pid'));
      return;
    }
    if (!mini) { openBoard(); return; }
    const box = mini.getBoundingClientRect();
    const mx = ev.clientX - box.left;
    const my = ev.clientY - box.top;
    const snap = snapToGlyphCell(mx, my, { r: MINI_R, cols: st.cfg.cols, rows: st.cfg.rows });
    const pos = glyphCellPosition(snap.col, snap.row, st.cfg);
    openBoard();
    panTo(pos.x, pos.y);
  });

  document.getElementById('glyph-dock-expand')?.addEventListener('click', ev => {
    ev.stopPropagation();
    toggleBoard();
  });
  document.getElementById('glyph-board-close')?.addEventListener('click', closeBoard);

  document.addEventListener('keydown', ev => {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA') return;
    if (ev.key === 'Escape' && open) {
      closeBoard();
      ev.stopImmediatePropagation();
    }
  }, true);

  window.openGlyphBoard = openBoard;
  window.closeGlyphBoard = closeBoard;
  window.toggleGlyphBoard = toggleBoard;
  window.refreshGlyphDock = renderMinimap;

  renderMinimap();
  if (location.hash === '#grid') setTimeout(() => openBoard(), 0);
})();
