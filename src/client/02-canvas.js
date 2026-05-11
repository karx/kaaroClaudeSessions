// ── SVG canvas ────────────────────────────────────────────────────────────────
const svg  = d3.select('#canvas').attr('width', W).attr('height', H);
const root = svg.append('g');
const zoom = d3.zoom().scaleExtent([0.05, 16]).on('zoom', e => root.attr('transform', e.transform));
svg.call(zoom);
const initialTransform = d3.zoomIdentity.translate(W * 0.12, H * 0.05).scale(0.88);
svg.call(zoom.transform, initialTransform);

const decorLayer = root.append('g').attr('id', 'decor');
const slLayer    = root.append('g').attr('id', 'sl-layer').style('display', 'none');
const edgeLayer  = root.append('g').attr('id', 'edges');
const nodeLayer  = root.append('g').attr('id', 'nodes');
const labelLayer = root.append('g').attr('id', 'labels');
