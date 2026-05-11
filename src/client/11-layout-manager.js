// ── Layout manager ────────────────────────────────────────────────────────────
const LAYOUT_HANDLERS = {
  force: {
    enter() {
      slLayer.style('display','none');
      edgeLayer.style('display',null); nodeLayer.style('display',null); labelLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      document.getElementById('sl-options').style.display='none';
      decorLayer.selectAll('*').remove();
      restoreForceLayout();
      simulation.alpha(0.25).restart();
      nodeSel.call(drag);
    },
    exit() {}
  },
  swimlane: {
    enter() {
      edgeLayer.style('display','none'); nodeLayer.style('display','none'); labelLayer.style('display','none');
      slLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      document.getElementById('sl-options').style.display='block';
      simulation.stop();
      svg.call(zoom.transform, d3.zoomIdentity);
      renderSwimlane();
    },
    exit() {
      edgeLayer.style('display',null); nodeLayer.style('display',null); labelLayer.style('display',null);
      slLayer.style('display','none');
      document.getElementById('sl-options').style.display='none';
      decorLayer.selectAll('*').remove();
    }
  },
  arc: {
    enter() {
      slLayer.style('display','none');
      edgeLayer.style('display',null); nodeLayer.style('display',null); labelLayer.style('display',null);
      document.getElementById('canvas').style.display='block';
      document.getElementById('matrix-view').style.display='none';
      document.getElementById('three-view').style.display='none';
      document.getElementById('sl-options').style.display='none';
      simulation.stop(); computeArcPositions(); drawArcDecor(); applyStaticPositions();
      nodeSel.on('.drag', null);
    },
    exit() { decorLayer.selectAll('*').remove(); }
  },
  matrix: {
    enter() {
      document.getElementById('canvas').style.display='none';
      document.getElementById('matrix-view').style.display='block';
      document.getElementById('three-view').style.display='none';
      document.getElementById('sl-options').style.display='none';
      simulation.stop(); renderMatrix();
    },
    exit() {}
  },
  '3d': layout3D
};

function setLayout(name) {
  if (name === currentLayout) return;
  LAYOUT_HANDLERS[currentLayout]?.exit?.();
  currentLayout = name;
  document.querySelectorAll('[data-layout]').forEach(b=>b.classList.toggle('active', b.dataset.layout===name));
  LAYOUT_HANDLERS[currentLayout]?.enter?.();
  applyFilters();
}

document.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>setLayout(b.dataset.layout)));
