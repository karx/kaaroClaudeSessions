// ── Share Card — shareable 1200×630 PNGs ────────────────────────────────────
// Three triggers, one preview/share/download pipeline (client-core.mjs,
// injected above as plain script):
//   • session panel  data-share          → buildShareCardData / generateShareCardSVG
//   • project panel  data-share-project  → buildProjectShareCardData / generateProjectShareCardSVG
//   • #me-share-btn (sidebar)            → buildUsageShareCardData / generateUsageShareCardSVG
// Session trace segments come from window._traceCache (shared with
// 17-trace-panel.js / 18-thread-view.js) and are fetched on demand.

(function () {

  async function _traceSegmentsFor(node) {
    if (!TRACE_HARNESSES.has(node.harness) || !node.context_resets) return null;
    window._traceCache = window._traceCache || new Map();
    if (window._traceCache.has(node.id)) return window._traceCache.get(node.id).segments;
    try {
      const res = await fetch(`/api/trace/${encodeURIComponent(node.id)}`);
      if (!res.ok) return null;
      const data = await res.json();
      window._traceCache.set(node.id, data);
      return data.segments;
    } catch (_) {
      return null;
    }
  }

  function _actionBtn(label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'paction';
    b.style.cssText = 'display:inline-block;width:auto;margin-top:0;padding:8px 18px;';
    return b;
  }

  function _showPreview(svgString, cardData) {
    const box = { svg: svgString, cardData };
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9600;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      "gap:14px;padding:20px;font-family:'IBM Plex Mono','Courier New',monospace;";

    const img = document.createElement('img');
    img.src = 'data:image/svg+xml,' + encodeURIComponent(box.svg);
    img.style.cssText = `max-width:100%;max-height:70vh;border:1px solid ${KAARO_TOKENS.border};`;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;';

    const shareBtn = _actionBtn('◆ SHARE / SAVE');
    const closeBtn = _actionBtn('✕ CLOSE');
    shareBtn.addEventListener('click', async () => {
      shareBtn.textContent = '…';
      try {
        const filename = box.cardData.shareFilename || `kaaro-${box.cardData.kind || 'share'}-card.png`;
        const result = await shareCard(box.svg, 'kaaroSessions', buildShareText(box.cardData), filename);
        shareBtn.textContent = result === 'shared' ? '✓ SHARED' : result === 'downloaded' ? '✓ SAVED' : '◆ SHARE / SAVE';
      } catch (_) {
        shareBtn.textContent = '⚠ FAILED';
      }
      setTimeout(() => { shareBtn.textContent = '◆ SHARE / SAVE'; }, 2000);
    });
    closeBtn.addEventListener('click', () => document.body.removeChild(overlay));
    overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });

    row.appendChild(shareBtn);
    row.appendChild(closeBtn);
    overlay.appendChild(img);

    if (cardData.kind === 'usage') {
      const nameRow = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'SIGN YOUR CARD (OPTIONAL)';
      input.maxLength = 24;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.value = box.cardData.displayName || '';
      input.style.cssText =
        'width:280px;background:' + KAARO_TOKENS.card +
        ';color:' + KAARO_TOKENS.body +
        ';border:1px solid ' + KAARO_TOKENS.border +
        ';border-radius:0;box-shadow:none;outline:none;' +
        "font:11px 'IBM Plex Mono','Courier New',monospace;" +
        'letter-spacing:0.08em;padding:8px 10px;text-transform:none;';
      function commit() {
        const name = sanitizeDisplayName(input.value);
        input.value = name;
        if (name) localStorage.setItem('kaaro-display-name', name);
        else localStorage.removeItem('kaaro-display-name');
        box.cardData = applyDisplayName(box.cardData, name);
        box.svg = generateUsageShareCardSVG(box.cardData);
        img.src = 'data:image/svg+xml,' + encodeURIComponent(box.svg);
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      nameRow.appendChild(input);
      overlay.appendChild(nameRow);
    }

    overlay.appendChild(row);
    document.body.appendChild(overlay);
  }

  /** Busy-label the trigger button while `build()` runs, then open the preview. */
  async function _runShare(btn, build) {
    const original = btn.textContent;
    btn.textContent = '…';
    try {
      const { svg, cardData } = await build();
      btn.textContent = original;
      _showPreview(svg, cardData);
    } catch (_) {
      btn.textContent = '⚠ CARD FAILED';
      setTimeout(() => { btn.textContent = original; }, 2000);
    }
  }

  // ── Session card ─────────────────────────────────────────────────────────
  document.getElementById('panel').addEventListener('click', e => {
    const btn = e.target.closest('[data-share]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const node = nodeById[btn.dataset.share];
    if (!node) return;
    _runShare(btn, async () => {
      const projLbl = nodeById[node.project_id]?.label || node.project_id || '';
      const traceSegments = await _traceSegmentsFor(node);
      const cardData = buildShareCardData(node, { projectLabel: projLbl, traceSegments });
      return { svg: generateShareCardSVG(cardData), cardData };
    });
  });

  // ── Project card ─────────────────────────────────────────────────────────
  document.getElementById('panel').addEventListener('click', e => {
    const btn = e.target.closest('[data-share-project]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const node = nodeById[btn.dataset.shareProject];
    if (!node) return;
    _runShare(btn, async () => {
      const nb = neighbours(node.id);
      const sessions = [...nb].filter(id => id !== node.id)
        .map(id => nodeById[id]).filter(n => n?.type === 'session');
      const harnessRows = harnessBreakdown(node.harnesses, sessions);
      const cardData = buildProjectShareCardData(node, { harnessRows });
      return { svg: generateProjectShareCardSVG(cardData), cardData };
    });
  });

  // ── Full usage canvas ("ME") card ────────────────────────────────────────
  const meBtn = document.getElementById('me-share-btn');
  if (meBtn) {
    meBtn.addEventListener('click', e => {
      e.preventDefault();
      _runShare(meBtn, async () => {
        const sessions = GRAPH.nodes.filter(n => n.type === 'session');
        const projectCount = GRAPH.nodes.filter(n => n.type === 'project').length;
        const tokensTotal = sessions.reduce((s, n) => s + (n.tokens_total || 0), 0);
        const dates = sessions.map(n => n.date_str).filter(Boolean).sort();
        const displayName = sanitizeDisplayName(localStorage.getItem('kaaro-display-name') || '');
        const cardData = buildUsageShareCardData(meGlyph(sessions), {
          projectCount, tokensTotal,
          dateFrom: dates[0] || '', dateTo: dates[dates.length - 1] || '',
          projects: GRAPH.nodes.filter(n => n.type === 'project'),
          sessions,
          displayName,
        });
        return { svg: generateUsageShareCardSVG(cardData), cardData };
      });
    });
  }
})();
