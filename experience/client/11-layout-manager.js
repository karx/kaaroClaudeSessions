// ── Layout manager ────────────────────────────────────────────────────────────
// Each handler declares its control panels via `controls`; setLayout applies
// visibility generically (resolveControlVisibility from the shared core) —
// enter/exit manage layers and simulation state. `onFilterChange`/`onResize`
// are the other two moments every layout with its own rendering surface must
// react to (checkbox/date/harness filters; window resize) — applyFilters()
// (12-controls.js) and the resize listener (13-live-updates.js) both just
// look up `LAYOUT_HANDLERS[currentLayout]` instead of keeping a parallel
// per-layout if-chain of their own, so a new layout can't wire up enter/exit
// here and silently leave filtering or resize unhandled elsewhere (that's how
// the Ontology/Signatures tabs shipped without either, initially).
const LAYOUT_HANDLERS = {
  force: {
    controls: ['force-options'],
    enter() {
      slLayer.style('display','none');
      edgeLayer.style('display',null); nodeLayer.style('display',null); labelLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      decorLayer.selectAll('*').remove();
      simulation.nodes(GRAPH.nodes);
      restoreForceLayout();
      simulation.alpha(0.25).restart();
      nodeSel.call(drag);
    },
    exit() {},
    onFilterChange: applyForceFilters,
  },
  swimlane: {
    controls: ['sl-options'],
    enter() {
      edgeLayer.style('display','none'); nodeLayer.style('display','none'); labelLayer.style('display','none');
      slLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      simulation.stop();
      svg.call(zoom.transform, d3.zoomIdentity);
      renderSwimlane();
    },
    exit() {
      edgeLayer.style('display',null); nodeLayer.style('display',null); labelLayer.style('display',null);
      slLayer.style('display','none');
      decorLayer.selectAll('*').remove();
    },
    onFilterChange: renderSwimlane,
    onResize: renderSwimlane,
  },
  arc: {
    controls: ['arc-options'],
    enter() {
      slLayer.style('display','none');
      edgeLayer.style('display','none'); nodeLayer.style('display',null); labelLayer.style('display','none');
      arcArcLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      simulation.stop();
      computeArcPositions(); drawArcDecor(); applyStaticPositions(); drawArcArcs();
      nodeSel.on('.drag', null);
    },
    exit() {
      arcArcLayer.style('display','none');
      edgeLayer.style('display',null); labelLayer.style('display',null);
      nodeSel.attr('display', null);
      projLabelSel.attr('display', null);
      edgeSel.attr('display', null);
      focusedArcFileId = null;
      decorLayer.selectAll('*').remove();
    },
    onFilterChange: arcApplyFilters,
    onResize: arcResize,
  },
  matrix: {
    controls: [],
    enter() {
      document.getElementById('canvas').style.display='none';
      document.getElementById('matrix-view').style.display='block';
      document.getElementById('three-view').style.display='none';
      simulation.stop(); renderMatrix();
    },
    exit() {},
    onFilterChange: renderMatrix,
    onResize: renderMatrix,
  },
  '3d': layout3D,
  ontology: {
    controls: ['ontology-options'],
    enter: ontologyEnter,
    exit: ontologyExit,
    onFilterChange: ontologyApplyFilters,
    onResize: refreshOntology,
  },
  signatures: {
    controls: [],
    enter: signaturesEnter,
    exit: signaturesExit,
    onFilterChange: signaturesApplyFilters,
    onResize: signaturesResize,
  },
};

function applyControlVisibility(active) {
  const vis = resolveControlVisibility(LAYOUT_HANDLERS, active);
  for (const [id, show] of Object.entries(vis)) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
  }
}

function setLayout(name) {
  if (name === currentLayout) return;
  LAYOUT_HANDLERS[currentLayout]?.exit?.();
  currentLayout = name;
  document.querySelectorAll('[data-layout]').forEach(b=>b.classList.toggle('active', b.dataset.layout===name));
  applyControlVisibility(name);
  LAYOUT_HANDLERS[currentLayout]?.enter?.();
  applyFilters();
}

document.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>setLayout(b.dataset.layout)));
