/**
 * experience/client-core/11-share-card.mjs — session/project/full-canvas
 * share-card SVG generation. Part of the client-core split; see
 * experience/client-core.mjs. Real `import`s below are for Node/tests only,
 * stripped at build time (loads last — needs 00/01/02's globals).
 */
import { esc, fmtTok } from './00-format.mjs';
import { TOOL_COLORS } from './01-color.mjs';
import { glyphSpiralCell, glyphCellPosition, projectGlyphMarkup, meGlyphMarkup } from './02-glyph.mjs';

// ── Share card (session summary → shareable 1200×630 SVG) ────────────────────
// A per-session "receipt": one panel button generates a PNG a user can share
// or download. Register A colors mirror experience/design-tokens.mjs verbatim
// (this file has no import graph — it's injected as plain script — so the
// palette is duplicated here rather than imported).

const SHARE_CARD_TOKENS = {
  bg: '#000000', panel: '#080800', card: '#101008', border: '#1e1e00',
  accent: '#ff6600', label: '#ffaa00', data: '#e8e000', select: '#00cccc',
  geo: '#00ff88', dim: '#445544', body: '#ccccaa', err: '#ff5555',
};

function _shareTrunc(s, max) {
  const str = String(s || '');
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Highest-count [name, count] entry from a tool_summary object, or null.
 * The single "which tool dominated this window" rule — shared by the share
 * card's context strip and the panel's context-window strips
 * (experience/client/17-trace-panel.js `_domTool`) so the two can't drift.
 */
export function dominantTool(toolSummary) {
  if (!toolSummary) return null;
  const entries = Object.entries(toolSummary);
  return entries.length ? entries.sort((a, b) => b[1] - a[1])[0] : null;
}

/**
 * Reduce /api/trace segments into card-ready strips: proportional width by
 * token weight, colored by each window's dominant tool (same idea as the
 * panel's context-window strips, kept independent since this feeds a fixed
 * pixel layout rather than a flex row).
 */
export function contextStripSegments(segments, fallbackColor) {
  const segs = segments || [];
  if (!segs.length) return [];
  const totalTok = segs.reduce((s, g) => s + (g.tokens?.output || 0) + (g.tokens?.cache_read || 0), 0) || 1;
  return segs.map(seg => {
    const tok = (seg.tokens?.output || 0) + (seg.tokens?.cache_read || 0);
    const top = dominantTool(seg.tool_summary);
    return {
      pct:  Math.max(4, tok / totalTok * 100),
      tok,
      tool: top ? top[0] : null,
      color: (top && TOOL_COLORS[top[0]]) || fallbackColor || SHARE_CARD_TOKENS.dim,
      turns: (seg.user_turns || 0) + (seg.assistant_turns || 0),
    };
  });
}

// Shared 1200×630 chrome (header/divider/footer/stat column) so the three
// card kinds (session / project / full-canvas) don't triplicate layout math.
function _shareGeom() {
  const width = 1200, height = 630;
  const headerH = 80, footerH = 70;
  const bodyTop = headerH, bodyBot = height - footerH;
  const dividerX = 660, leftPad = 55, rightPad = dividerX + 40;
  return { width, height, headerH, footerH, bodyTop, bodyBot, dividerX, leftPad, rightPad };
}

function _shareHeader(g, { kicker, dateRight, subRight }) {
  const c = SHARE_CARD_TOKENS;
  return `<rect width="${g.width}" height="${g.headerH}" fill="${c.panel}"/>
  <line x1="0" y1="${g.headerH}" x2="${g.width}" y2="${g.headerH}" stroke="${c.border}" stroke-width="1"/>
  <text x="${g.leftPad}" y="34" style="font-size:20px;font-weight:bold;fill:${c.accent};letter-spacing:3px;">KAAROSESSIONS</text>
  <text x="${g.leftPad}" y="58" style="font-size:9px;fill:${c.dim};letter-spacing:2px;">${esc(kicker || '')}</text>
  <text x="${g.width - g.leftPad}" y="34" style="font-size:12px;fill:${c.dim};text-anchor:end;">${esc(dateRight || '')}</text>
  <text x="${g.width - g.leftPad}" y="58" style="font-size:12px;fill:${c.label};text-anchor:end;">${esc(subRight || '')}</text>`;
}

function _shareDivider(g) {
  return `<line x1="${g.dividerX}" y1="${g.bodyTop + 16}" x2="${g.dividerX}" y2="${g.bodyBot - 16}" stroke="${SHARE_CARD_TOKENS.border}" stroke-width="1" stroke-dasharray="4,4"/>`;
}

function _shareFooter(g, { tagLine, footerRightLabel }) {
  const c = SHARE_CARD_TOKENS;
  return `<line x1="0" y1="${g.bodyBot}" x2="${g.width}" y2="${g.bodyBot}" stroke="${c.border}" stroke-width="1"/>
  <rect y="${g.bodyBot}" width="${g.width}" height="${g.footerH}" fill="${c.panel}"/>
  <text x="${g.leftPad}" y="${g.bodyBot + 26}" style="font-size:11px;fill:${c.select};letter-spacing:0.5px;">${esc(tagLine || 'KAAROSESSIONS')}</text>
  <text x="${g.leftPad}" y="${g.bodyBot + 48}" style="font-size:10px;fill:${c.dim};">an observability surface for coding agents</text>
  <text x="${g.width - g.leftPad}" y="${g.bodyBot + 40}" style="font-size:14px;font-weight:bold;fill:${c.accent};text-anchor:end;letter-spacing:1px;">${esc(footerRightLabel || '◆ KAAROSESSIONS')}</text>`;
}

/** Right-column label/value stat rows, 50px apart, starting under the header (or `startY`). */
function _shareStatRows(stats, g, startY) {
  const c = SHARE_CARD_TOKENS;
  const y0 = startY != null ? startY : g.bodyTop + 44;
  return stats.map(([label, val], i) => {
    const sy = y0 + i * 50;
    return `<text x="${g.rightPad}" y="${sy}" style="font-size:9px;fill:${c.dim};letter-spacing:2px;">${esc(label)}</text>` +
      `<text x="${g.rightPad}" y="${sy + 22}" style="font-size:20px;font-weight:bold;fill:${c.data};">${esc(val)}</text>`;
  }).join('');
}

/**
 * Single assembler — preview, share, and download all build the card from
 * this. `node` is a graph session node (see experience/graph-pipeline.mjs);
 * `opts.traceSegments` is the raw segments array from /api/trace, when
 * available (the card renders fine without it — one placeholder strip).
 */
export function buildShareCardData(node, opts = {}) {
  const d = node || {};
  return {
    kind: 'session',
    sessionLabel:   d.ai_title || d.label || 'session',
    harness:        d.harness || d.source || 'claude-code',
    project:        opts.projectLabel || d.project_id || '',
    date:           d.date_str || '',
    duration_min:   d.duration_min ?? null,
    model:          d.model || null,
    tokens_total:   d.tokens_total || 0,
    tokens_work:    d.tokens_work || 0,
    cache_hit_rate: d.cache_hit_rate || 0,
    tool_calls:     d.tool_calls || 0,
    tool_errors:    d.tool_errors || 0,
    tool_diversity: d.tool_diversity || 0,
    subagent_count: d.subagent_count || 0,
    context_resets: d.context_resets || 0,
    segments:       contextStripSegments(opts.traceSegments, d.color),
    skills:         d.skills || [],
    color:          d.color || SHARE_CARD_TOKENS.accent,
  };
}

export function generateShareCardSVG(data) {
  const c = SHARE_CARD_TOKENS;
  const g = _shareGeom();

  const stripBoxX = g.leftPad;
  const stripBoxY = g.bodyTop + 90;
  const stripBoxW = g.dividerX - g.leftPad - 30;
  const stripBoxH = 34;

  const segs = data.segments && data.segments.length
    ? data.segments
    : [{ pct: 100, tok: data.tokens_work, tool: null, color: data.color }];
  const totalPct = segs.reduce((s, seg) => s + seg.pct, 0) || 1;
  let x = 0;
  const stripRects = segs.map(seg => {
    const w = seg.pct / totalPct * stripBoxW;
    const rect = `<rect x="${(stripBoxX + x).toFixed(1)}" y="${stripBoxY}" width="${Math.max(1, w - 2).toFixed(1)}" height="${stripBoxH}" fill="${seg.color}" opacity="0.8"><title>${esc(seg.tool || 'window')} · ${fmtTok(seg.tok)} tok</title></rect>`;
    x += w;
    return rect;
  }).join('');

  const windowCount = (data.context_resets || 0) + 1;

  const stats = [
    ['CONSUMPTION', fmtTok(data.tokens_total)],
    ['AI WORK',     fmtTok(data.tokens_work)],
    ['CACHE HIT',   data.cache_hit_rate + '%'],
    ['TOOL CALLS',  String(data.tool_calls)],
    ['ERRORS',      String(data.tool_errors)],
    ['SUBAGENTS',   String(data.subagent_count)],
  ];

  // Raw (unescaped) — _shareFooter is the single escaping point for tagLine.
  const skillTags = (data.skills || []).slice(0, 4).map(s => '/' + s).join('  ');

  return `<svg width="${g.width}" height="${g.height}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: 'IBM Plex Mono', 'Courier New', monospace; }</style></defs>
  <rect width="${g.width}" height="${g.height}" fill="${c.bg}"/>
  ${_shareHeader(g, { kicker: `SESSION CARD · ${(data.harness || '').toUpperCase()}`, dateRight: data.date, subRight: data.project })}
  ${_shareDivider(g)}

  <!-- LEFT: title + context strip -->
  <text x="${g.leftPad}" y="${g.bodyTop + 46}" style="font-size:22px;fill:${c.body};letter-spacing:0.3px;">${esc(_shareTrunc(data.sessionLabel, 46))}</text>
  <text x="${g.leftPad}" y="${g.bodyTop + 68}" style="font-size:9px;fill:${c.dim};letter-spacing:1.5px;">◆ CONTEXT WINDOWS (${windowCount})</text>
  <rect x="${stripBoxX}" y="${stripBoxY}" width="${stripBoxW}" height="${stripBoxH}" fill="${c.card}" stroke="${c.border}" stroke-width="1"/>
  ${stripRects}
  ${data.duration_min != null ? `<text x="${g.leftPad}" y="${stripBoxY + stripBoxH + 24}" style="font-size:11px;fill:${c.dim};">${data.duration_min} min · ${data.tool_diversity} tool types</text>` : ''}

  ${_shareStatRows(stats, g)}
  ${_shareFooter(g, { tagLine: skillTags || 'AI CODING SESSION' })}
</svg>`.trim();
}

/**
 * Project card assembler. `node` is a graph project node; `opts.harnessRows`
 * is the per-harness session-count breakdown (see harnessBreakdown()) — the
 * caller already has the project's session list from neighbours(node.id).
 */
export function buildProjectShareCardData(node, opts = {}) {
  const d = node || {};
  return {
    kind: 'project',
    label:         d.label || d.id || 'project',
    session_count: d.session_count || 0,
    tokens_total:  d.tokens_total || 0,
    tokens_work:   d.tokens_work || 0,
    skills:        d.skills || [],
    harnessRows:   opts.harnessRows || [],
    last_activity: d.last_activity || null,
    color:         d.color || SHARE_CARD_TOKENS.accent,
  };
}

export function generateProjectShareCardSVG(data) {
  const c = SHARE_CARD_TOKENS;
  const g = _shareGeom();

  const rows = data.harnessRows.length
    ? data.harnessRows
    : [{ harness: 'unknown', count: data.session_count, color: data.color }];
  const maxCount = Math.max(1, ...rows.map(r => r.count));
  const barX = g.leftPad, barW = g.dividerX - g.leftPad - 30;
  const barRows = rows.map((r, i) => {
    const y = g.bodyTop + 96 + i * 32;
    const w = Math.max(2, r.count / maxCount * barW);
    return `<text x="${barX}" y="${y - 6}" style="font-size:10px;fill:${c.dim};letter-spacing:1px;">${esc(r.harness)} · ${r.count}</text>` +
      `<rect x="${barX}" y="${y}" width="${barW}" height="8" fill="${c.card}" stroke="${c.border}"/>` +
      `<rect x="${barX}" y="${y}" width="${w}" height="8" fill="${r.color || data.color}"/>`;
  }).join('');

  const stats = [
    ['SESSIONS',    String(data.session_count)],
    ['CONSUMPTION', fmtTok(data.tokens_total)],
    ['AI WORK',     fmtTok(data.tokens_work)],
    ['HARNESSES',   String(rows.length)],
  ];

  // Raw (unescaped) — _shareFooter is the single escaping point for tagLine.
  const skillTags = (data.skills || []).slice(0, 4).map(s => '/' + s).join('  ');

  return `<svg width="${g.width}" height="${g.height}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: 'IBM Plex Mono', 'Courier New', monospace; }</style></defs>
  <rect width="${g.width}" height="${g.height}" fill="${c.bg}"/>
  ${_shareHeader(g, { kicker: 'PROJECT CARD', dateRight: data.last_activity ? String(data.last_activity).slice(0, 10) : '' })}
  ${_shareDivider(g)}

  <text x="${g.leftPad}" y="${g.bodyTop + 46}" style="font-size:24px;font-weight:bold;fill:${data.color};letter-spacing:0.3px;">${esc(_shareTrunc(data.label, 40))}</text>
  <text x="${g.leftPad}" y="${g.bodyTop + 68}" style="font-size:9px;fill:${c.dim};letter-spacing:1.5px;">◆ HARNESS BREAKDOWN</text>
  ${barRows}

  ${_shareStatRows(stats, g)}
  ${_shareFooter(g, { tagLine: skillTags || 'PROJECT SUMMARY' })}
</svg>`.trim();
}

/**
 * Full-canvas ("ME") card assembler — "Project & Session Constellation":
 * the left field layers two marks — a hex per project (foreground landmark,
 * wedge-filled by harness) over a ball per session (background texture,
 * colored by its project) — so both the project *and* the individual-session
 * count read as the intelligence report, not one traded off for the other.
 * The ME glyph is the hero, big and vertically centered in the right column.
 *
 * `me` is the output of meGlyph(sessions); `opts.projects` / `opts.sessions`
 * are the raw graph project/session-node arrays (see
 * experience/graph-pipeline.mjs); sessions rank by their project's
 * consumption so a project's balls cluster near its own hex; `opts` also
 * supplies the cross-project numbers meGlyph doesn't carry (project count,
 * total tokens, date range).
 */
export function buildUsageShareCardData(me, opts = {}) {
  const projects = (opts.projects || [])
    .slice()
    .sort((a, b) => (b.tokens_total || 0) - (a.tokens_total || 0))
    .map(p => ({
      id: p.id, label: p.label || p.id || 'project', color: p.color || SHARE_CARD_TOKENS.dim,
      harnesses: p.harnesses || [], recencyLevel: p.recencyLevel || 0, inFlight: !!p.inFlight,
      sizeNorm: p.sizeNorm || 0, session_count: p.session_count || 0, tokens_total: p.tokens_total || 0,
    }));
  const projRank = new Map(projects.map((p, i) => [p.id, i]));

  const sessions = (opts.sessions || [])
    .slice()
    .sort((a, b) => {
      const ra = projRank.has(a.project_id) ? projRank.get(a.project_id) : projects.length;
      const rb = projRank.has(b.project_id) ? projRank.get(b.project_id) : projects.length;
      if (ra !== rb) return ra - rb;
      return (a.date_str || '').localeCompare(b.date_str || '');
    })
    .map(s => ({ color: s.color || SHARE_CARD_TOKENS.dim, diversity: s.tool_diversity || 0 }));

  return {
    kind: 'usage',
    total_sessions: me?.total || 0,
    project_count:  opts.projectCount || projects.length,
    tokens_total:   opts.tokensTotal || 0,
    dateFrom:       opts.dateFrom || '',
    dateTo:         opts.dateTo || '',
    rows: (me?.rows || []).map(r => ({ harness: r.harness, count: r.count, pct: r.pct, color: r.color })),
    topProject: projects[0]?.label || '',
    projects,
    sessions,
    me: me || null,
  };
}

/** Minimal spiral ring count k with capacity 1+3k(k+1) >= n. */
function _spiralRingsNeeded(n) {
  let k = 0;
  while (1 + 3 * k * (k + 1) < n) k++;
  return k;
}

/** Pitch radius that spirals n items out to ~targetRadius, clamped to [minR, maxR]. */
function _fillRadius(n, targetRadius, { minR = 4, maxR = 30 } = {}) {
  if (n <= 1) return maxR;
  const rings = Math.max(1, _spiralRingsNeeded(n));
  return Math.max(minR, Math.min(maxR, targetRadius / (rings * 1.5)));
}

const MOSAIC_MAX_SESSIONS = 200;     // ring-8 capacity (1 + 3*8*9 = 217)
const CONSTELLATION_MAX_PROJECTS = 60; // ring-4 capacity (1 + 3*4*5 = 61)

export function generateUsageShareCardSVG(data) {
  const c = SHARE_CARD_TOKENS;
  const g = _shareGeom();

  // ── LEFT: project hexes over a session-ball texture, same center — both
  // counts (25 projects, 122 sessions) are legible in one field.
  const fieldX0 = g.leftPad, fieldX1 = g.dividerX - 30;
  const fieldY0 = g.bodyTop + 20, fieldY1 = g.bodyBot - 46;
  const centerX = (fieldX0 + fieldX1) / 2;
  const centerY = (fieldY0 + fieldY1) / 2;
  const targetR = Math.min(fieldX1 - fieldX0, fieldY1 - fieldY0) / 2 * 0.92;

  const sessions = data.sessions || [];
  const shownSess = sessions.slice(0, MOSAIC_MAX_SESSIONS);
  const sessOverflow = sessions.length - shownSess.length;
  const ballPitch = _fillRadius(shownSess.length, targetR, { minR: 5, maxR: 16 });
  const maxDiversity = Math.max(1, ...shownSess.map(s => s.diversity));
  const balls = shownSess.map((s, i) => {
    const cell = glyphSpiralCell(i);
    const pos = glyphCellPosition(cell.col, cell.row, { r: ballPitch, originX: centerX, originY: centerY });
    const norm = s.diversity / maxDiversity;
    const ballR = Math.max(ballPitch * 0.25, ballPitch * (0.3 + 0.35 * norm));
    return `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${ballR.toFixed(1)}" fill="${s.color}" opacity="0.65"/>`;
  }).join('');

  const projects = data.projects || [];
  const shownProj = projects.slice(0, CONSTELLATION_MAX_PROJECTS);
  const projOverflow = projects.length - shownProj.length;
  const hexPitch = _fillRadius(shownProj.length, targetR, { minR: 16, maxR: 34 });
  // Painted after the balls, each with a solid backing disc, so hexes read
  // as clean foreground landmarks instead of blending into the ball texture.
  const hexes = shownProj.map((p, i) => {
    const cell = glyphSpiralCell(i);
    const pos = glyphCellPosition(cell.col, cell.row, { r: hexPitch, originX: centerX, originY: centerY });
    const hexR = Math.max(hexPitch * 0.6, Math.min(hexPitch * 0.92, hexPitch * (0.6 + 0.32 * p.sizeNorm)));
    return `<g transform="translate(${pos.x.toFixed(1)},${pos.y.toFixed(1)})">` +
      `<circle r="${(hexR + 3).toFixed(1)}" fill="${c.bg}"/>` +
      projectGlyphMarkup(p, { r: hexR, bg: c.bg }) +
      `</g>`;
  }).join('');

  const overflowBits = [];
  if (projOverflow > 0) overflowBits.push(`+${projOverflow} projects`);
  if (sessOverflow > 0) overflowBits.push(`+${sessOverflow} sessions`);
  const caption = '◆ hex = project · ball = session · size = activity' +
    (overflowBits.length ? ` · ${overflowBits.join(', ')} more` : '');

  // ── RIGHT: stats + legend on the left half; ME hero hex big, vertically
  // centered, in the right half of the right column.
  const avgDiversity = shownSess.length
    ? Math.round(shownSess.reduce((s, x) => s + x.diversity, 0) / shownSess.length)
    : 0;
  const stats = [
    ['SESSIONS',       String(data.total_sessions)],
    ['PROJECTS',       String(data.project_count)],
    ['CONSUMPTION',    fmtTok(data.tokens_total)],
    ['AVG TOOL TYPES', String(avgDiversity)],
  ];

  const legendY0 = g.bodyTop + 44 + stats.length * 50 + 20;
  const legend = data.rows.map((row, i) => {
    const y = legendY0 + i * 18;
    return `<rect x="${g.rightPad}" y="${y - 9}" width="8" height="8" fill="${row.color}"/>` +
      `<text x="${g.rightPad + 14}" y="${y}" style="font-size:9px;fill:${c.dim};">${esc(row.harness)} ${row.pct}%</text>`;
  }).join('');

  const rightColX0 = g.rightPad, rightColX1 = g.width - g.leftPad;
  const meCenterX = rightColX0 + (rightColX1 - rightColX0) * 0.72; // right half of the right column
  const meCenterY = (g.bodyTop + g.bodyBot) / 2;                    // vertically centered in the body
  const meR = 56;
  const meMarkup = data.me ? meGlyphMarkup(data.me, { r: meR, bg: c.bg, color: c.accent }) : '';
  const meGroup = `<g transform="translate(${meCenterX.toFixed(1)},${meCenterY.toFixed(1)})">` +
    `<circle r="${meR + 10}" fill="${c.card}" stroke="${c.border}" stroke-width="1"/>` +
    `<circle r="${meR + 8}" fill="none" stroke="${c.accent}" stroke-width="1.5" opacity="0.7"/>` +
    meMarkup +
    `</g>`;

  const dateRange = (data.dateFrom || data.dateTo) ? `${data.dateFrom} → ${data.dateTo}` : '';

  return `<svg width="${g.width}" height="${g.height}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: 'IBM Plex Mono', 'Courier New', monospace; }</style></defs>
  <rect width="${g.width}" height="${g.height}" fill="${c.bg}"/>
  ${_shareHeader(g, { kicker: 'FULL USAGE CANVAS · INTELLIGENCE TRACE', dateRight: dateRange })}
  ${_shareDivider(g)}

  ${balls}
  ${hexes}
  <text x="${fieldX0}" y="${fieldY1 + 22}" style="font-size:9px;fill:${c.dim};letter-spacing:1px;">${esc(caption)}</text>

  ${_shareStatRows(stats, g)}
  ${legend}
  ${meGroup}
  ${_shareFooter(g, { tagLine: 'ALL PROJECTS · ALL TIME' })}
</svg>`.trim();
}

/** Plain-text sibling — no live URL (kaaroSessions is a local observability tool). */
export function buildShareText(data) {
  if (data.kind === 'project') {
    return [
      `📊 ${data.label}`,
      `${data.session_count} sessions · ${fmtTok(data.tokens_total)} tokens`,
    ].join('\n');
  }
  if (data.kind === 'usage') {
    return [
      `📊 My kaaroSessions canvas`,
      `${data.total_sessions} sessions · ${data.project_count} projects · ${fmtTok(data.tokens_total)} tokens`,
    ].join('\n');
  }
  const windowCount = (data.context_resets || 0) + 1;
  const lines = [
    `📊 ${data.sessionLabel}`,
    `${data.harness} · ${fmtTok(data.tokens_total)} tokens · ${data.tool_calls} tool calls · ${windowCount} context window${windowCount === 1 ? '' : 's'}`,
  ];
  if (data.project) lines.push(`project: ${data.project}`);
  return lines.join('\n');
}

function _shareCardDataURL(svgString) {
  return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
}

/** SVG string → PNG Blob, same size as _shareGeom(). Browser-only (Image/canvas); not Node-tested. */
export async function svgToPNG(svgString) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const { width, height } = _shareGeom();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('canvas.toBlob failed')), 'image/png');
    };
    img.onerror = reject;
    img.src = _shareCardDataURL(svgString);
  });
}

export async function downloadCard(svgString, filename = 'kaaro-share-card.png') {
  const blob = await svgToPNG(svgString);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Web Share API (mobile) or download (desktop fallback). Returns 'shared' | 'downloaded' | 'cancelled'. */
export async function shareCard(svgString, title = 'kaaroSessions', text = '', filename = 'kaaro-share-card.png') {
  const blob = await svgToPNG(svgString);
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.share) {
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, text, files: [file] });
      } else {
        await navigator.share({ title, text });
      }
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  await downloadCard(svgString, filename);
  return 'downloaded';
}
