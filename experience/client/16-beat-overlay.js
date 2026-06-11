// ── DAW Feed Widget ────────────────────────────────────────────────────────────
// Interactive live event feed above the timeline bar (bottom:74px, height:80px).
// Scroll back with wheel or drag to inspect history. Hover for details and
// to highlight the corresponding session node in the force graph.
// Reads window._beatRing maintained by 14-pulse-audio.js.

(function() {
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;

  const H_TOTAL    = 80;
  const H_HEADER   = 18;
  const H_TRACK    = H_TOTAL - H_HEADER;   // 62px
  const PX_PER_SEC = 30;
  const BLOCK_W    = 7;
  const MAX_HIST_MS = 5 * 60 * 1000;       // 5 minutes of scrollable history

  // ── Block geometry ─────────────────────────────────────────────────────────
  // Two-layer model:
  //   Activity spikes — top-anchored (yOff=2), height = significance.
  //                     Write tallest → Edit → Agent → Read → Bash → Grep.
  //   Ambient floor   — tokens + words pinned to the bottom, independent layer.
  // This creates a consistent "waveform from the ceiling" so you can read a
  // session's phase (write-heavy vs read-heavy vs bash-heavy) at a glance.
  function blockGeom(ev) {
    const t = (ev.tool || '').toLowerCase();
    // Ambient floor strips — always below all activity spikes
    if (ev.type === 'tokens') return { h: 4,  yOff: H_TRACK - 4  };
    if (ev.type === 'words')  return { h: 8,  yOff: H_TRACK - 13 };
    // Activity spikes — all top-anchored
    if (t === 'write')                          return { h: 52, yOff: 2 };
    if (t === 'edit')                           return { h: 46, yOff: 2 };
    if (t === 'agent')                          return { h: 40, yOff: 2 };
    if (t === 'read')                           return { h: 32, yOff: 2 };
    if (t === 'bash' || t === 'powershell')     return { h: 22, yOff: 2 };
    if (t === 'grep' || t === 'glob')           return { h: 14, yOff: 2 };
    return { h: 20, yOff: 2 };
  }

  // Tool-type colour for the 2px stripe at the top of each activity block.
  // Matches the semantic colour vocabulary used in the session panel bars.
  const _TOOL_STRIPE = {
    write:'#00bb55', edit:'#ccaa00', read:'#2a5c8a',
    bash:'#cc6622', powershell:'#cc6622',
    grep:'#7733aa', glob:'#7733aa',
    agent:'#cc2244', toolsearch:'#6644aa',
  };
  function _toolStripeColor(ev) {
    if (ev.type === 'tokens' || ev.type === 'words') return null;
    return _TOOL_STRIPE[(ev.tool || '').toLowerCase()] || null;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _scrollPx      = 0;
  let _isLive        = true;
  let _frozenNow     = null;
  let _hovered       = null;
  let _mouseX        = 0, _mouseY = 0;
  let _dragging      = false, _dragOriX = 0, _dragOriScroll = 0;

  // ── DOM ────────────────────────────────────────────────────────────────────
  const widget  = document.createElement('div');
  widget.id     = 'daw-widget';
  document.body.appendChild(widget);

  const canvas  = document.createElement('canvas');
  canvas.id     = 'daw-canvas';
  canvas.height = H_TOTAL;
  widget.appendChild(canvas);

  const tooltip = document.createElement('div');
  tooltip.id    = 'daw-tooltip';
  document.body.appendChild(tooltip);

  function resize() { canvas.width = window.innerWidth; }
  resize();
  window.addEventListener('resize', resize);

  // ── Input ──────────────────────────────────────────────────────────────────
  widget.addEventListener('wheel', e => {
    e.preventDefault();
    _scrollPx = Math.max(0, _scrollPx + (e.deltaX || e.deltaY) * 0.8);
    _setLive(_scrollPx === 0);
  }, { passive: false });

  widget.addEventListener('mousedown', e => {
    _dragging = true; _dragOriX = e.clientX; _dragOriScroll = _scrollPx;
    e.preventDefault();
  });
  window.addEventListener('mouseup', () => { _dragging = false; });
  window.addEventListener('mousemove', e => {
    if (!_dragging) return;
    _scrollPx = Math.max(0, _dragOriScroll + (_dragOriX - e.clientX));
    _setLive(_scrollPx === 0);
  });

  canvas.addEventListener('mousemove', e => { _mouseX = e.offsetX; _mouseY = e.offsetY; });

  widget.addEventListener('mouseleave', () => {
    _hovered = null;
    tooltip.style.display = 'none';
    _restoreHighlight();
  });

  canvas.addEventListener('click', e => {
    const W = canvas.width;
    if (e.offsetY <= H_HEADER && e.offsetX >= W - 64) {
      _scrollPx = 0; _setLive(true);
    }
  });

  function _setLive(v) {
    if (v) { _isLive = true; _frozenNow = null; }
    else if (_isLive) { _isLive = false; _frozenNow = Date.now(); }
  }

  function _nowMs() { return _isLive ? Date.now() : (_frozenNow ?? Date.now()); }

  // ── Graph highlight ────────────────────────────────────────────────────────
  const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'read', 'write', 'edit']);

  function _restoreHighlight() {
    if (typeof clearAccent === 'function') clearAccent();
    if (typeof highlight !== 'function') return;
    if (typeof selectedId !== 'undefined' && selectedId) highlight(selectedId);
    else highlight(null);
  }

  function _applyHoverHighlight(ev) {
    if (!ev || typeof GRAPH === 'undefined' || typeof highlight !== 'function') return;
    if (typeof clearAccent === 'function') clearAccent();

    const sessNode = GRAPH.nodes.find(n => n.type === 'session' && ev.slug && n.id.startsWith(ev.slug));
    if (sessNode) {
      highlight(sessNode.id);
      // If this event touched a specific file, accent that node over the others
      if (ev.where && FILE_TOOLS.has(ev.tool) && typeof accentNode === 'function') {
        let normWhere = ev.where.replace(/\\/g, '/');
        if (/^[a-zA-Z]:\//.test(normWhere)) normWhere = normWhere.toLowerCase();
        const fileNode  = GRAPH.nodes.find(n => n.type === 'file' && n.id === normWhere);
        if (fileNode) accentNode(fileNode.id);
      }
      return;
    }
    const projNode = GRAPH.nodes.find(n => n.type === 'project' && n.label === ev.project);
    if (projNode) highlight(projNode.id);
  }

  // ── Coordinate helpers ─────────────────────────────────────────────────────
  function evScreenX(ev, nowMs) {
    return canvas.width - (nowMs - ev.ts) / 1000 * PX_PER_SEC + _scrollPx;
  }

  // ── Hover detection ────────────────────────────────────────────────────────
  function findHovered(nowMs) {
    const ring = window._beatRing || [];
    for (let i = ring.length - 1; i >= 0; i--) {
      const ev = ring[i];
      const x  = evScreenX(ev, nowMs);
      if (x < -BLOCK_W || x > canvas.width + BLOCK_W) continue;
      const g  = blockGeom(ev);
      const ty = H_HEADER + g.yOff;
      if (_mouseX >= x - 2 && _mouseX <= x + BLOCK_W + 2 &&
          _mouseY >= ty - 2 && _mouseY <= ty + g.h + 2) return ev;
    }
    return null;
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────
  function renderTooltip(ev) {
    if (!ev) { tooltip.style.display = 'none'; return; }
    const rect = widget.getBoundingClientRect();
    const tipW = 204;
    let left   = _mouseX + 16;
    if (left + tipW > window.innerWidth - 8) left = _mouseX - tipW - 10;
    const top  = Math.max(8, rect.top - 100);

    const where = ev.where
      ? ev.where.replace(/\\/g, '/').split('/').slice(-2).join('/').slice(0, 44)
      : null;
    const time  = new Date(ev.ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const label = ev.tool ? ev.tool : ev.type;

    tooltip.style.cssText = `display:block;left:${left}px;top:${top}px`;
    tooltip.innerHTML = [
      `<div class="dtt-proj" style="color:${ev.color||'#8899cc'}">${ev.project || '?'}</div>`,
      `<div class="dtt-tool">${label}${ev.category ? ' · '+ev.category : ''}</div>`,
      where ? `<div class="dtt-where">${where}</div>` : '',
      ev.slug    ? `<div class="dtt-slug">${ev.slug}</div>` : '',
      ev.preview ? `<div class="dtt-preview">${ev.preview.slice(0, 90)}</div>` : '',
      `<div class="dtt-time">${time}</div>`,
    ].join('');
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    requestAnimationFrame(draw);
    const W    = canvas.width;
    const ctx  = canvas.getContext('2d');
    const now  = _nowMs();
    const ring = window._beatRing || [];

    // hover update
    const hov = findHovered(now);
    if (hov !== _hovered) {
      _hovered = hov;
      renderTooltip(hov);
      if (hov) _applyHoverHighlight(hov);
      else     _restoreHighlight();
    }

    // background
    ctx.fillStyle = '#02020a';
    ctx.fillRect(0, 0, W, H_TOTAL);

    // header band
    ctx.fillStyle = '#030310';
    ctx.fillRect(0, 0, W, H_HEADER);
    ctx.strokeStyle = '#09091e';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H_HEADER - 0.5); ctx.lineTo(W, H_HEADER - 0.5); ctx.stroke();

    // bottom border
    ctx.strokeStyle = '#07071a';
    ctx.beginPath(); ctx.moveTo(0, H_TOTAL - 0.5); ctx.lineTo(W, H_TOTAL - 0.5); ctx.stroke();

    // time grid — 10s intervals
    const gridPx = 10 * PX_PER_SEC;
    const phase  = (_isLive ? 0 : (_frozenNow - Date.now()) / 1000 * PX_PER_SEC) - _scrollPx;
    const firstX = ((W + phase) % gridPx + gridPx) % gridPx;
    for (let x = W - firstX; x >= 0; x -= gridPx) {
      ctx.strokeStyle = '#070720';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x), H_HEADER); ctx.lineTo(Math.round(x), H_TOTAL); ctx.stroke();
    }

    // event blocks
    for (const ev of ring) {
      const x   = evScreenX(ev, now);
      if (x < -BLOCK_W - 4 || x > W + 4) continue;
      const age  = now - ev.ts;
      const g    = blockGeom(ev);
      const ty   = H_HEADER + g.yOff;
      const hot  = ev === _hovered;
      const fade = Math.max(0.12, 1 - age / MAX_HIST_MS);

      ctx.globalAlpha = hot ? 1 : (0.18 + 0.62 * fade);
      ctx.fillStyle   = ev.color || '#2a3a8a';
      ctx.fillRect(Math.round(x), ty, BLOCK_W, g.h);

      // 2px tool-type stripe at the top of activity blocks
      const stripe = _toolStripeColor(ev);
      if (stripe) {
        ctx.globalAlpha = hot ? 0.95 : (0.28 + 0.52 * fade);
        ctx.fillStyle   = stripe;
        ctx.fillRect(Math.round(x), ty, BLOCK_W, 2);
      }

      if (hot) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#e0e8ff';
        ctx.lineWidth   = 1;
        ctx.strokeRect(Math.round(x) - 0.5, ty - 0.5, BLOCK_W + 1, g.h + 1);
      }
    }
    ctx.globalAlpha = 1;

    // live edge glow
    if (_isLive) {
      const lg = ctx.createLinearGradient(W - 36, 0, W, 0);
      lg.addColorStop(0, 'rgba(16,36,100,0)');
      lg.addColorStop(1, 'rgba(16,36,100,0.22)');
      ctx.fillStyle = lg;
      ctx.fillRect(W - 36, H_HEADER, 36, H_TRACK);
      ctx.strokeStyle = '#182868';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(W - 1, H_HEADER); ctx.lineTo(W - 1, H_TOTAL); ctx.stroke();
    }

    // ◆ FEED label
    ctx.fillStyle = '#1a2a48';
    ctx.font = "bold 8px 'IBM Plex Mono',monospace";
    ctx.fillText('◆ FEED', 8, 12);

    // scroll position readout
    if (!_isLive) {
      const secAgo = Math.round(_scrollPx / PX_PER_SEC);
      ctx.fillStyle = '#2a3a5a';
      ctx.font = "8px 'IBM Plex Mono',monospace";
      const txt = `-${secAgo}s`;
      ctx.fillText(txt, W / 2 - ctx.measureText(txt).width / 2, 12);
    }

    // LIVE button
    const btnW  = 60, btnH = 13, btnX = W - btnW - 4, btnY = 3;
    const lastEv    = ring[ring.length - 1];
    const hasRecent = lastEv && (Date.now() - lastEv.ts) < 3500;

    ctx.fillStyle   = _isLive ? 'rgba(0,22,10,0.94)' : 'rgba(6,6,18,0.94)';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.strokeStyle = _isLive ? '#174028' : '#161630';
    ctx.lineWidth   = 1;
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    const dotColor = _isLive && hasRecent ? '#00cc60' : (_isLive ? '#0b3018' : '#28284a');
    ctx.fillStyle  = dotColor;
    ctx.beginPath(); ctx.arc(btnX + 9, 9.5, 2.5, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = _isLive ? '#00cc60' : '#3a4466';
    ctx.font      = "bold 8px 'IBM Plex Mono',monospace";
    ctx.fillText(_isLive ? 'LIVE' : '◀ LIVE', btnX + 16, 13);
  }

  requestAnimationFrame(draw);
})();
