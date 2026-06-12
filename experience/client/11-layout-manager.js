// ── Layout manager ────────────────────────────────────────────────────────────
// Each handler declares its control panels via `controls`; setLayout applies
// visibility generically (resolveControlVisibility from the shared core) —
// enter/exit only manage layers and simulation state.
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
    exit() {}
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
    }
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
    }
  },
  matrix: {
    controls: [],
    enter() {
      document.getElementById('canvas').style.display='none';
      document.getElementById('matrix-view').style.display='block';
      document.getElementById('three-view').style.display='none';
      simulation.stop(); renderMatrix();
    },
    exit() {}
  },
  '3d': layout3D
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
