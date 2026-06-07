// ── Thread View — Session Context Arc ─────────────────────────────────────
// Full-screen overlay showing a session's context windows as a narrative
// flow: spine → segments → compact resets → (Tier 2: subagent branches).
//
// Tier 1 (current): segment-level composition — stacked tool bar per window,
//   permission mode tint, branch tag, token weight, subagent count.
// Tier 2 (future): per-turn detail — individual tool-call dots in sequence,
//   subagent threads branching from the spawn turn.
//
// Entry: window.openThread(sessionId)  — called from panel buttons
// Exit:  window.closeThread()  or  Escape key

(function() {

  const _COLORS = {
    Write:'#00bb55', Edit:'#ccaa00', Read:'#2a5c8a',
    Bash:'#cc6622', PowerShell:'#cc6622',
    Grep:'#7733aa', Glob:'#7733aa',
    Agent:'#cc2244', ToolSearch:'#6644aa',
    WebFetch:'#336688', WebSearch:'#336688',
  };

  // Permission mode background tints — subtle, not distracting
  const _MODE_BG = {
    default:           '#050810',
    plan:              '#06050e',
    acceptEdits:       '#0b0700',
    bypassPermissions: '#0b0404',
  };

  function _fmtTok(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(0) + 'k';
    return String(n);
  }

  // ── Stacked composition bar ────────────────────────────────────────────────
  // Width of each segment = proportion of total tool calls.
  // Color = tool semantic vocabulary. Label inside if wide enough.
  function _compBar(toolSummary) {
    if (!toolSummary) return '';
    const entries = Object.entries(toolSummary).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '';
    const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
    const bars  = entries.map(([name, n]) => {
      const pct   = (n / total * 100).toFixed(2);
      const color = _COLORS[name] || '#2a3a5a';
      return `<div class="thr-bar-seg" style="width:${pct}%;background:${color}" title="${name} × ${n}">` +
             `<span class="thr-bar-lbl">${name}</span></div>`;
    }).join('');
    return `<div class="thr-compbar">${bars}</div>`;
  }

  // ── Single segment block ───────────────────────────────────────────────────
  function _segBlock(seg, sessionColor) {
    const primaryMode = seg.permission_modes?.[0] || 'default';
    const modeLabel   = seg.permission_modes?.length > 1
      ? seg.permission_modes.join(' → ')
      : primaryMode;
    const branches    = seg.branches?.join(' → ') || '';
    const turns       = seg.user_turns + seg.assistant_turns;
    const tok         = seg.tokens.output + seg.tokens.cache_read;
    const border      = sessionColor || '#2a5c8a';
    const bg          = _MODE_BG[primaryMode] || _MODE_BG.default;

    const badges = [];
    if (seg.subagent_count) badges.push(`↳ ${seg.subagent_count} subagent${seg.subagent_count > 1 ? 's' : ''}`);
    if (seg.thinking_count) badges.push(`◉ ${seg.thinking_count}`);

    return `<div class="thr-seg" style="border-left-color:${border};background:${bg}">` +
      `<div class="thr-seg-hd">` +
        `<span class="thr-wn" style="color:${border}">W${seg.index + 1}</span>` +
        `<span class="thr-mode">${modeLabel}</span>` +
        (branches ? `<span class="thr-branch">⎇ ${branches}</span>` : '') +
        `<span class="thr-meta">${turns} turns · ${_fmtTok(tok)}</span>` +
        (badges.length ? `<span class="thr-badges">${badges.join('  ')}</span>` : '') +
      `</div>` +
      _compBar(seg.tool_summary || {}) +
    `</div>`;
  }

  // ── Compact reset divider ──────────────────────────────────────────────────
  function _compactDivider() {
    return `<div class="thr-compact">` +
      `<span class="thr-cline"></span>` +
      `<span class="thr-clbl">⟲ context reset</span>` +
      `<span class="thr-cline"></span>` +
    `</div>`;
  }

  // ── Full render ────────────────────────────────────────────────────────────
  function _render(data, node) {
    const segs  = data.segments || [];
    const color = node?.color || '#4488cc';
    const label = node?.label || (data.session_id || '').slice(0, 8) || '?';

    const chromeLbl = document.getElementById('thr-chrome-label');
    const chromeAit = document.getElementById('thr-chrome-ait');
    chromeLbl.textContent = label;
    chromeLbl.style.color = color;
    chromeAit.textContent = data.ai_title || '';
    chromeAit.style.display = data.ai_title ? '' : 'none';

    const parts = [];
    segs.forEach(seg => {
      parts.push(_segBlock(seg, color));
      if (seg.compact_trigger === 'auto') parts.push(_compactDivider());
    });

    // Legend
    const usedTools = [...new Set(segs.flatMap(s => Object.keys(s.tool_summary || {})))];
    const legend = usedTools
      .filter(t => _COLORS[t])
      .map(t => `<span class="thr-legend-dot" style="background:${_COLORS[t]}"></span><span class="thr-legend-lbl">${t}</span>`)
      .join('');

    document.getElementById('thr-body').innerHTML =
      parts.join('') +
      (legend ? `<div class="thr-legend">${legend}</div>` : '');
  }

  // ── DOM ────────────────────────────────────────────────────────────────────
  const ov  = document.createElement('div');
  ov.id     = 'thread-view';
  ov.innerHTML = `
    <div id="thr-chrome">
      <div id="thr-chrome-left">
        <span id="thr-chrome-label"></span>
        <span id="thr-chrome-ait"></span>
      </div>
      <button id="thr-close-btn" onclick="window.closeThread()">✕</button>
    </div>
    <div id="thr-scroll"><div id="thr-body"></div></div>`;
  document.body.appendChild(ov);

  // ── Panel click delegation — VIEW THREAD buttons ───────────────────────────
  document.getElementById('panel').addEventListener('click', e => {
    const btn = e.target.closest('[data-thread-open]');
    if (!btn) return;
    window.openThread(btn.dataset.threadOpen);
  });

  // ── Public ─────────────────────────────────────────────────────────────────
  window.openThread = async function(sessionId) {
    ov.classList.add('open');
    const node = typeof nodeById !== 'undefined' ? nodeById[sessionId] : null;

    // Show label immediately while loading
    const lbl = document.getElementById('thr-chrome-label');
    lbl.textContent = node?.label || sessionId.slice(0, 8);
    lbl.style.color = node?.color || '#4488cc';
    document.getElementById('thr-chrome-ait').style.display = 'none';
    document.getElementById('thr-body').innerHTML = '<div class="thr-loading">loading…</div>';

    try {
      const res  = await fetch(`/api/trace/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      _render(data, node);
    } catch (_) {
      document.getElementById('thr-body').innerHTML = '<div class="thr-err">trace unavailable</div>';
    }
  };

  window.closeThread = function() { ov.classList.remove('open'); };

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ov.classList.contains('open')) window.closeThread();
  });

})();
