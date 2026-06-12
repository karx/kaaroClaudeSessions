// â”€â”€ Context Window Trace Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Shows a session's context windows (segments between compact_boundary events)
// as proportional strips inside the detail panel.
//
// Cognitive design:
//   Width  = relative token weight â†’ instant sense of where effort was spent
//   Color  = dominant tool category â†’ mode of work (write/read/agent/bash)
//   Badge  = subagent spawned, branch change, extended thinking
//   Order  = left=earliest, right=most-recent (current segment has open border)
//
// Lazy-fetches /api/trace/:session_id on first expand; caches per session.

(function() {
  // _traceCache shared with 18-thread-view.js so openThread skips a redundant fetch
  window._traceCache = window._traceCache || new Map();
  const _cache = window._traceCache;

  function _domTool(seg) {
    const s = seg.tool_summary;
    if (!s) return null;
    const top = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
    return top || null;
  }

  function _renderStrips(data, sessionColor) {
    const segs = data.segments;
    if (!segs || !segs.length)
      return '<div class="ctx-empty">no segments</div>';

    const totalTok = segs.reduce((s, g) => s + g.tokens.output + g.tokens.cache_read, 0) || 1;

    return '<div class="ctx-strips">' + segs.map((seg, i) => {
      const tok      = seg.tokens.output + seg.tokens.cache_read;
      const pct      = Math.max(5, (tok / totalTok) * 100);
      const domEntry = _domTool(seg);
      const domName  = domEntry ? domEntry[0] : null;
      const domCount = domEntry ? domEntry[1] : 0;
      const color    = (domName && TOOL_COLORS[domName]) || sessionColor || '#2a3a8a';
      const isCur    = seg.compact_trigger === null;
      const turns    = seg.user_turns + seg.assistant_turns;

      const badges = [];
      if (seg.subagent_count)             badges.push(`â†³${seg.subagent_count}`);
      if (seg.thinking_count > 2)         badges.push(`â—‰${seg.thinking_count}`);
      if (seg.branches && seg.branches.length > 1) badges.push(`âŽ‡${seg.branches.length}`);

      return `<div class="ctx-strip${isCur ? ' ctx-current' : ''}" style="width:${pct.toFixed(1)}%;border-left-color:${color};background:${color}1a" title="Window ${i+1}: ${turns} turns Â· ${fmtTok(tok)} tok${domName ? ' Â· '+domName+'Ã—'+domCount : ''}">` +
        `<div class="ctx-si">${i + 1}</div>` +
        (domName ? `<div class="ctx-tool" style="color:${color}">${domName}</div>` : '') +
        `<div class="ctx-turns">${turns}t</div>` +
        (badges.length ? `<div class="ctx-badges">${badges.join(' ')}</div>` : '') +
        `<div class="ctx-tok">${fmtTok(tok)}</div>` +
      `</div>`;
    }).join('<div class="ctx-sep">âŸ²</div>') + '</div>';
  }

  // â”€â”€ Public: returns HTML to embed in the session panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Called from 05-interaction.js showPanel() when context_resets > 0.
  function traceSection(d) {
    // Gated on the harness's trace capability (registry-injected at build);
    // single-segment sessions render one strip + VIEW THREAD.
    if (!TRACE_HARNESSES.has(d.harness)) return '';
    const n = (d.context_resets || 0) + 1;
    return `<div class="psep"></div>` +
      `<div class="p-section-hd ctx-hd" data-trace-id="${d.id}">` +
        `â—† CONTEXT WINDOWS <span class="ctx-n">(${n})</span>` +
        `<span class="ctx-chev">â–¸</span>` +
      `</div>` +
      `<div class="ctx-body" data-trace-body="${d.id}" style="display:none"></div>`;
  }
  window._traceSection = traceSection;

  // â”€â”€ Click delegation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  document.getElementById('panel').addEventListener('click', async e => {
    const hd = e.target.closest('[data-trace-id]');
    if (!hd) return;

    const id   = hd.dataset.traceId;
    const body = document.querySelector(`[data-trace-body="${id}"]`);
    const chev = hd.querySelector('.ctx-chev');
    if (!body) return;

    // Toggle collapse
    if (body.style.display !== 'none') {
      body.style.display = 'none';
      if (chev) chev.textContent = 'â–¸';
      return;
    }

    body.style.display = 'block';
    if (chev) chev.textContent = 'â–¾';

    const _threadBtn = id => `<button class="ctx-thread-btn" data-thread-open="${id}">â—† VIEW THREAD â–¸</button>`;

    // Serve from cache if available
    if (_cache.has(id)) {
      const node = typeof nodeById !== 'undefined' ? nodeById[id] : null;
      body.innerHTML = _renderStrips(_cache.get(id), node?.color) + _threadBtn(id);
      return;
    }

    body.innerHTML = '<div class="ctx-loading">loadingâ€¦</div>';

    try {
      const res = await fetch(`/api/trace/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      _cache.set(id, data);
      const node = typeof nodeById !== 'undefined' ? nodeById[id] : null;
      body.innerHTML = _renderStrips(data, node?.color) + _threadBtn(id);
    } catch (_) {
      body.innerHTML = '<div class="ctx-err">trace unavailable</div>';
    }
  });
})();
