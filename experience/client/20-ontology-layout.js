// ── Ontology layout ───────────────────────────────────────────────────────────
// Per-session scatter: positions sessions on 2 chosen axes (diversity/scale/
// structure/density). A legend click sets a single `focusedHarnessId` that
// dims (never hides) other harnesses' dots, mirroring 08-arc.js's
// `focusedArcFileId`. The harness radars + tool-mix donuts live in the
// separate Signatures tab (21-signatures-layout.js), not here.

let ontologyMaxima = null;
let focusedHarnessId = null;

const ONTOLOGY_AXES = ['diversity', 'scale', 'structure', 'density'];
const ONTOLOGY_MARGIN = 70;

function ontologyVisibleSessions() {
  return GRAPH.nodes.filter(n => n.type === 'session' && sessionMatchesFilters(n, SESSION_FILTERS));
}

function ontologyHarnessIds(sessions) {
  return [...new Set(sessions.map(s => s.harness).filter(Boolean))].sort();
}

function getOntologyOpts() {
  return {
    xKey: document.getElementById('ont-x-axis')?.value || 'diversity',
    yKey: document.getElementById('ont-y-axis')?.value || 'scale',
  };
}

function computeOntologyMaxima(sessions) {
  const tokenful  = sessions.filter(s => (s.tokens_work || 0) > 0);
  const tokenless = sessions.filter(s => (s.tokens_work || 0) === 0);
  return {
    diversity:   Math.max(1, ...sessions.map(s => s.tool_diversity || 0)),
    density:     Math.max(1, ...sessions.map(s =>
      (s.message_count || 0) / Math.max(1, s.duration_min || 0))),
    scaleTokens: Math.max(1, ...tokenful.map(s => s.tokens_work || 0)),
    scaleCalls:  Math.max(1, ...tokenless.map(s => s.tool_calls || 0)),
  };
}

function computeOntologyPositions() {
  const sessions = ontologyVisibleSessions();
  ontologyMaxima = computeOntologyMaxima(sessions);
  const opts = getOntologyOpts();

  const xScale = d3.scaleLinear().domain([0, 1]).range([ONTOLOGY_MARGIN, W - ONTOLOGY_MARGIN]);
  const yScale = d3.scaleLinear().domain([0, 1]).range([H - ONTOLOGY_MARGIN, ONTOLOGY_MARGIN]);

  sessions.forEach(s => {
    const m = computeOntologyMetrics(s, ontologyMaxima);
    s.x = xScale(m[opts.xKey] || 0);
    s.y = yScale(m[opts.yKey] || 0);
    s.fx = s.x; s.fy = s.y;
  });
}

// ── Axis chrome + legend ───────────────────────────────────────────────────────

function drawOntologyDecor() {
  decorLayer.selectAll('*').remove();
  const opts = getOntologyOpts();

  decorLayer.append('line')
    .attr('x1', ONTOLOGY_MARGIN).attr('x2', W - ONTOLOGY_MARGIN)
    .attr('y1', H - ONTOLOGY_MARGIN).attr('y2', H - ONTOLOGY_MARGIN)
    .attr('stroke', '#1e1e3a').attr('stroke-width', 1);
  decorLayer.append('line')
    .attr('x1', ONTOLOGY_MARGIN).attr('x2', ONTOLOGY_MARGIN)
    .attr('y1', ONTOLOGY_MARGIN).attr('y2', H - ONTOLOGY_MARGIN)
    .attr('stroke', '#1e1e3a').attr('stroke-width', 1);

  decorLayer.append('text')
    .attr('x', W / 2).attr('y', H - ONTOLOGY_MARGIN + 28).attr('text-anchor', 'middle')
    .attr('font-size', 9).attr('fill', KAARO_TOKENS.dim).attr('font-family', 'Courier New,monospace')
    .attr('letter-spacing', 1.5)
    .text(opts.xKey.toUpperCase() + ' →');

  decorLayer.append('text')
    .attr('x', ONTOLOGY_MARGIN - 30).attr('y', H / 2).attr('text-anchor', 'middle')
    .attr('font-size', 9).attr('fill', KAARO_TOKENS.dim).attr('font-family', 'Courier New,monospace')
    .attr('letter-spacing', 1.5)
    .attr('transform', `rotate(-90, ${ONTOLOGY_MARGIN - 30}, ${H / 2})`)
    .text(opts.yKey.toUpperCase() + ' →');

  drawOntologyLegend();
}

function drawOntologyLegend() {
  const box = document.getElementById('ontology-legend');
  if (!box) return;
  const sessions = ontologyVisibleSessions();
  const ids = ontologyHarnessIds(sessions);
  const { HARNESS_COLORS } = assignHarnessColors(ids);

  box.innerHTML = '';
  ids.forEach(id => {
    const row = document.createElement('div');
    row.className = 'ont-legend-row' + (focusedHarnessId === id ? ' ont-legend-active' : '');
    row.style.color = HARNESS_COLORS[id];
    row.innerHTML = `<span class="ont-swatch" style="background:${HARNESS_COLORS[id]}"></span>${esc(id)}`;
    row.addEventListener('click', () => {
      focusedHarnessId = focusedHarnessId === id ? null : id;
      drawOntologyLegend();
      renderOntologyFocus();
    });
    box.appendChild(row);
  });
}

function renderOntologyFocus() {
  nodeSel.filter(d => d.type === 'session')
    .attr('opacity', d => !focusedHarnessId || d.harness === focusedHarnessId ? 1 : 0.12);
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────
// Radars + tool-mix donuts moved to the dedicated Signatures tab
// (21-signatures-layout.js) — this tab is scatter-only.

function renderOntologyContent() {
  computeOntologyPositions();
  applyStaticPositions();
  drawOntologyDecor();
  renderOntologyFocus();
}

function ontologyEnter() {
  slLayer.style('display', 'none');
  arcArcLayer.style('display', 'none');
  edgeLayer.style('display', 'none');
  nodeLayer.style('display', null);
  labelLayer.style('display', 'none');
  document.getElementById('canvas').style.display = 'block';
  document.getElementById('matrix-view').style.display = 'none';
  document.getElementById('three-view').style.display = 'none';

  simulation.stop();
  svg.call(zoom.transform, d3.zoomIdentity);
  nodeSel.style('display', d => d.type === 'session' ? null : 'none');
  nodeSel.on('.drag', null);
  focusedHarnessId = null;
  renderOntologyContent();
}

function ontologyExit() {
  edgeLayer.style('display', null);
  labelLayer.style('display', null);
  nodeSel.style('display', null);
  nodeSel.attr('opacity', null);
  focusedHarnessId = null;
  decorLayer.selectAll('*').remove();
}

function refreshOntology() {
  if (currentLayout !== 'ontology') return;
  drawOntologyDecor();
  computeOntologyPositions();
  applyStaticPositions();
}
