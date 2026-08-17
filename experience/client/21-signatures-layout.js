// ── Signatures layout (three.js, real 3D depth) ───────────────────────────────
// Full-canvas tab: two overlaid-but-Z-layered harness radar stacks (shape,
// capability) + a tool-mix donut grid, all rendered in three.js so that
// overlapping harnesses separate in actual depth (orbit camera) instead of
// alpha-blending flat on top of each other. Reuses the same data functions
// as the Ontology scatter tab (harnessSignature, harnessToolMix,
// assignHarnessColors, ontologyVisibleSessions/ontologyHarnessIds/
// computeOntologyMaxima) — this file is rendering only, no new data logic.

let THREE_MOD = null;
let OrbitControlsCtor = null;
let _threeLoadPromise = null;
let _renderer = null, _scene = null, _camera = null, _controls = null, _rafId = null;
let _sceneGeneration = 0;

const SIG_RADIUS  = 60;
const SIG_ZGAP    = 26;
const SIG_DONUT_R = 14;

function radarPoint(i, n, v, R) {
  const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
  return [Math.cos(angle) * R * v, Math.sin(angle) * R * v];
}

function makeTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 16);
  const texture = new THREE_MOD.CanvasTexture(canvas);
  const material = new THREE_MOD.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE_MOD.Sprite(material);
  sprite.scale.set(24, 6, 1);
  return sprite;
}

// ── One radar stack: shared axis chrome at z=0 + one translucent polygon
// surface per harness, receding into depth (z = -index * SIG_ZGAP) ───────────
function buildRadarStack(scene, xOffset, axesKeys, harnessValues, harnessColors, ids) {
  const group = new THREE_MOD.Group();
  group.position.x = xOffset;
  const n = axesKeys.length;

  [0.33, 0.66, 1.0].forEach(t => {
    const pts = axesKeys.map((_, i) => {
      const [x, y] = radarPoint(i, n, t, SIG_RADIUS);
      return new THREE_MOD.Vector3(x, y, 0);
    });
    pts.push(pts[0].clone());
    const geo = new THREE_MOD.BufferGeometry().setFromPoints(pts);
    group.add(new THREE_MOD.Line(geo, new THREE_MOD.LineBasicMaterial({ color: 0x1e1e3a })));
  });

  axesKeys.forEach((key, i) => {
    const [x, y] = radarPoint(i, n, 1, SIG_RADIUS);
    const geo = new THREE_MOD.BufferGeometry().setFromPoints([
      new THREE_MOD.Vector3(0, 0, 0), new THREE_MOD.Vector3(x, y, 0),
    ]);
    group.add(new THREE_MOD.Line(geo, new THREE_MOD.LineBasicMaterial({ color: 0x1e1e3a })));

    const [lx, ly] = radarPoint(i, n, 1.22, SIG_RADIUS);
    const label = makeTextSprite(key.slice(0, 4).toUpperCase(), '#556677');
    label.position.set(lx, ly, 0);
    group.add(label);
  });

  ids.forEach((id, idx) => {
    const vals = harnessValues[id] || {};
    const pts2d = axesKeys.map((k, i) => radarPoint(i, n, Math.max(0, Math.min(1, vals[k] || 0)), SIG_RADIUS));
    const z = -idx * SIG_ZGAP;

    const shape = new THREE_MOD.Shape();
    pts2d.forEach(([x, y], i) => i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y));
    shape.closePath();
    const fillMat = new THREE_MOD.MeshBasicMaterial({
      color: harnessColors[id], transparent: true, opacity: 0.22,
      side: THREE_MOD.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE_MOD.Mesh(new THREE_MOD.ShapeGeometry(shape), fillMat);
    mesh.position.z = z;
    group.add(mesh);

    const outlinePts = pts2d.map(([x, y]) => new THREE_MOD.Vector3(x, y, z));
    outlinePts.push(outlinePts[0].clone());
    const outlineGeo = new THREE_MOD.BufferGeometry().setFromPoints(outlinePts);
    group.add(new THREE_MOD.Line(outlineGeo, new THREE_MOD.LineBasicMaterial({ color: harnessColors[id] })));

    const idLabel = makeTextSprite(id, harnessColors[id]);
    idLabel.position.set(-SIG_RADIUS - 26, 0, z);
    group.add(idLabel);
  });

  scene.add(group);
}

// ── Tool-mix donut grid: one 3D ring per harness, category-sliced by ratio ───
function buildToolMixGrid(scene, ids, sessions, harnessColors) {
  const group = new THREE_MOD.Group();
  const cols = 4, spacing = 40;

  ids.forEach((id, idx) => {
    const col = idx % cols, row = Math.floor(idx / cols);
    const cx = (col - (cols - 1) / 2) * spacing;
    const cy = -row * spacing;

    const ratios = harnessToolMix(sessions, id);
    const entries = Object.entries(ratios).filter(([, v]) => v > 0);
    if (!entries.length) {
      const ring = new THREE_MOD.Mesh(
        new THREE_MOD.RingGeometry(SIG_DONUT_R * 0.55, SIG_DONUT_R, 24),
        new THREE_MOD.MeshBasicMaterial({ color: 0x1e1e3a, side: THREE_MOD.DoubleSide }));
      ring.position.set(cx, cy, 0);
      group.add(ring);
    } else {
      let start = 0;
      entries.forEach(([cat, ratio]) => {
        const arcLen = ratio * Math.PI * 2;
        const mesh = new THREE_MOD.Mesh(
          new THREE_MOD.RingGeometry(SIG_DONUT_R * 0.55, SIG_DONUT_R, 24, 1, start, arcLen),
          new THREE_MOD.MeshBasicMaterial({ color: TOOL_MIX_COLORS[cat] || '#555577', side: THREE_MOD.DoubleSide }));
        mesh.position.set(cx, cy, 0);
        group.add(mesh);
        start += arcLen;
      });
    }

    const label = makeTextSprite(id, harnessColors[id] || '#889');
    label.position.set(cx, cy - SIG_DONUT_R - 10, 0);
    label.scale.set(30, 8, 1);
    group.add(label);
  });

  group.position.set(0, -130, 40);
  scene.add(group);
}

function buildSignaturesLegend(container, ids, harnessColors) {
  const legend = document.createElement('div');
  legend.style.cssText = 'position:absolute;top:12px;left:16px;font-family:"IBM Plex Mono","Courier New",monospace;'
    + 'font-size:9px;letter-spacing:0.4px;text-transform:uppercase;pointer-events:none;';
  legend.innerHTML = ids.map(id =>
    `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;color:${harnessColors[id]}">`
    + `<span style="width:8px;height:8px;display:inline-block;background:${harnessColors[id]}"></span>${esc(id)}</div>`
  ).join('');
  container.appendChild(legend);
}

// `generation` closes over the scene this loop belongs to — if a newer scene
// has since been built (disposeSignaturesScene bumps _sceneGeneration), this
// chain stops itself instead of rendering/updating disposed three.js objects.
function signaturesRenderLoop(generation) {
  if (generation !== _sceneGeneration) return;
  _rafId = requestAnimationFrame(() => signaturesRenderLoop(generation));
  _controls.update();
  _renderer.render(_scene, _camera);
}

// Idempotent: always tears down any live scene/render-loop first, so calling
// this more than once (e.g. the tab re-entered while a prior load was still
// in flight) can never leave a stale renderer or rAF chain running.
function disposeSignaturesScene() {
  _sceneGeneration++;
  if (_rafId != null) cancelAnimationFrame(_rafId);
  _rafId = null;
  if (_controls) _controls.dispose();
  if (_renderer) _renderer.dispose();
  _scene = null; _camera = null; _controls = null; _renderer = null;
}

function buildSignaturesScene() {
  const container = document.getElementById('signatures-view');
  if (!container) return;
  disposeSignaturesScene();
  const generation = _sceneGeneration;
  container.innerHTML = '';
  container.style.position = 'relative';

  _scene = new THREE_MOD.Scene();
  _scene.background = new THREE_MOD.Color(0x000000);
  _camera = new THREE_MOD.PerspectiveCamera(45, W / H, 1, 2000);
  _camera.position.set(0, 60, 420);

  _renderer = new THREE_MOD.WebGLRenderer({ antialias: true });
  _renderer.setSize(W, H);
  container.appendChild(_renderer.domElement);

  _controls = new OrbitControlsCtor(_camera, _renderer.domElement);
  _controls.target.set(0, -20, -60);
  _controls.enableDamping = true;

  const sessions = ontologyVisibleSessions();
  const ids = ontologyHarnessIds(sessions);
  const { HARNESS_COLORS } = assignHarnessColors(ids);
  const maxima = computeOntologyMaxima(sessions);

  const shapeVals = {}, capVals = {};
  ids.forEach(id => {
    const sig = harnessSignature(sessions, id, maxima, HARNESS_CAPS);
    shapeVals[id] = sig.shape;
    capVals[id]   = sig.capability;
  });

  buildRadarStack(_scene, -150, ['scale', 'diversity', 'structure', 'density'], shapeVals, HARNESS_COLORS, ids);
  buildRadarStack(_scene, 150, ['branches', 'tokenful', 'skills', 'ai_title'], capVals, HARNESS_COLORS, ids);
  buildToolMixGrid(_scene, ids, sessions, HARNESS_COLORS);
  buildSignaturesLegend(container, ids, HARNESS_COLORS);

  signaturesRenderLoop(generation);
}

async function signaturesEnter() {
  document.getElementById('canvas').style.display = 'none';
  document.getElementById('matrix-view').style.display = 'none';
  document.getElementById('three-view').style.display = 'none';
  const container = document.getElementById('signatures-view');
  if (container) container.style.display = 'block';
  simulation.stop();

  if (!THREE_MOD) {
    if (container) container.innerHTML =
      '<div style="color:#445;padding:60px;text-align:center;font-family:monospace;font-size:13px">Loading 3D library…</div>';
    // Shared in-flight promise: if the tab is re-entered while three.js is
    // still loading, later callers await the same load instead of racing a
    // second dynamic import (and a second scene build once it resolves).
    if (!_threeLoadPromise) {
      _threeLoadPromise = (async () => {
        const mod = await import('three');
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        return { mod, OrbitControls };
      })().catch(e => { _threeLoadPromise = null; throw e; });
    }
    try {
      ({ mod: THREE_MOD, OrbitControls: OrbitControlsCtor } = await _threeLoadPromise);
    } catch (e) {
      if (container) container.innerHTML =
        '<div style="color:#a55;padding:60px;text-align:center;font-family:monospace;font-size:13px">Failed to load 3D library.</div>';
      return;
    }
    if (currentLayout !== 'signatures') return; // navigated away while loading
  }
  buildSignaturesScene();
}

function signaturesExit() {
  disposeSignaturesScene();
  const container = document.getElementById('signatures-view');
  if (container) { container.innerHTML = ''; container.style.display = 'none'; }
}
