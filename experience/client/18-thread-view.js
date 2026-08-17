// ── Thread View — Session Context Arc ─────────────────────────────────────
// Full-screen overlay. Each context window is a segment block with:
//   • a stacked composition bar (tool proportions at a glance)
//   • every turn: user messages, assistant reasoning, tool calls with inputs
// Entry: window.openThread(sessionId)   Exit: Escape or ✕

(function () {

  // TOOL_COLORS defined in 01-data.js
  const _C = TOOL_COLORS;

  const _MODE_BG = {
    default:           '#050810',
    plan:              '#06050e',
    acceptEdits:       '#0b0700',
    bypassPermissions: '#0b0404',
  };

  // _fmtTok and _esc defined in 01-data.js

  function _fmtDur(ms) {
    if (!ms) return null;
    if (ms < 60_000)  return (ms / 1000).toFixed(0) + 's';
    return Math.round(ms / 60_000) + 'm' + Math.round((ms % 60_000) / 1000) + 's';
  }

  function _timeLabel(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
    catch { return ''; }
  }

  // ── Stacked composition bar ───────────────────────────────────────────────
  function _compBar(toolSummary) {
    if (!toolSummary) return '';
    const entries = Object.entries(toolSummary).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '';
    const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
    const segs  = entries.map(([name, n]) => {
      const pct   = (n / total * 100).toFixed(2);
      const color = _C[name] || KAARO_TOKENS.dim;
      return `<div class="thr-bar-seg" style="width:${pct}%;background:${color}" title="${esc(name)} × ${n}">` +
             `<span class="thr-bar-lbl">${esc(name)}</span></div>`;
    }).join('');
    return `<div class="thr-compbar">${segs}</div>`;
  }

  // ── Tool call row ─────────────────────────────────────────────────────────
  function _renderToolCall(tc) {
    const color = _C[tc.name] || '#3a5070';
    const err   = tc.is_error === true;
    const n     = tc.name;
    const inp   = tc.input || {};

    // Build the primary argument line
    let arg = '';
    if (n === 'Bash' || n === 'Shell' || n === 'PowerShell') {
      arg = inp.command || '';
    } else if (n === 'Read' || n === 'Write') {
      arg = inp.file_path || '';
    } else if (n === 'Edit' || n === 'MultiEdit') {
      arg = inp.file_path || '';
    } else if (n === 'Grep') {
      arg = inp.pattern ? `"${inp.pattern}"${inp.path ? ' in ' + inp.path : ''}` : '';
    } else if (n === 'Glob') {
      arg = inp.pattern || '';
    } else if (n === 'Agent') {
      arg = inp.description || '';
    } else if (n === 'WebSearch' || n === 'ToolSearch') {
      arg = inp.query || '';
    } else if (n === 'WebFetch') {
      arg = inp.url || '';
    } else {
      // Generic: first string value
      const first = Object.values(inp).find(v => typeof v === 'string');
      arg = first || '';
    }

    // Multiline commands — indent continuation lines
    const lines = arg.split('\n');
    const firstLine = esc(lines[0] || '');
    const restLines = lines.slice(1).filter(l => l.trim());
    const moreLines = restLines.length
      ? '<div class="thr-tc-cont">' +
          restLines.map(l => `<span class="thr-tc-contline">${esc(l)}</span>`).join('') +
        '</div>'
      : '';

    // Edit diff preview
    let diffHtml = '';
    if ((n === 'Edit' || n === 'MultiEdit') && (inp.old_string || inp.new_string)) {
      const oldFirst = (inp.old_string || '').split('\n')[0];
      const newFirst = (inp.new_string || '').split('\n')[0];
      diffHtml = `<div class="thr-tc-diff">` +
        (oldFirst ? `<span class="thr-tc-del">- ${esc(oldFirst)}</span>` : '') +
        (newFirst ? `<span class="thr-tc-add">+ ${esc(newFirst)}</span>` : '') +
      `</div>`;
    }

    return `<div class="thr-tc${err ? ' thr-tc-err' : ''}">` +
      `<span class="thr-tc-name" style="color:${color}">${esc(n)}</span>` +
      `<span class="thr-tc-arg">${firstLine}</span>` +
      (err && tc.error_text ? `<span class="thr-tc-errtxt">${esc(tc.error_text.slice(0, 120))}</span>` : '') +
    `</div>` +
    moreLines +
    diffHtml;
  }

  // ── Single turn ───────────────────────────────────────────────────────────
  function _renderTurn(turn) {
    const isUser = turn.role === 'user';
    const time   = _timeLabel(turn.ts);
    const dur    = _fmtDur(turn.duration_ms);

    const header = `<div class="thr-turn-hd">` +
      `<span class="thr-actor thr-actor-${isUser ? 'user' : 'asst'}">${isUser ? 'USER' : 'ASST'}</span>` +
      (time ? `<span class="thr-turn-ts">${time}</span>` : '') +
      (!isUser && turn.has_thinking ? `<span class="thr-thinking" title="extended thinking">◉</span>` : '') +
      (!isUser && dur  ? `<span class="thr-dur">${dur}</span>` : '') +
      (!isUser && turn.stop_reason === 'max_tokens' ? `<span class="thr-maxtok" title="hit context limit">⚠ max_tokens</span>` : '') +
    `</div>`;

    // All thr-turn-text blocks are click-to-copy (user + asst).
    // Grep: thr-turn-text-copy | data-thr-copy
    // turn.text is already capped at 500 by reconstructTraceFromNRs.
    const trunc = turn.text && turn.text.length >= 500
      ? '<span class="thr-truncated">…</span>' : '';
    const textHtml = turn.text
      ? `<div class="thr-turn-text thr-turn-text-copy" data-thr-copy title="Click to copy" role="button" tabindex="0">${esc(turn.text)}${trunc}</div>`
      : '';

    const toolsHtml = (turn.tool_calls || []).length
      ? `<div class="thr-tcs">${turn.tool_calls.map(_renderToolCall).join('')}</div>`
      : '';

    return `<div class="thr-turn thr-turn-${isUser ? 'user' : 'asst'}">${header}${textHtml}${toolsHtml}</div>`;
  }

  // ── Segment block ─────────────────────────────────────────────────────────
  function _segBlock(seg, sessionColor) {
    const primaryMode = seg.permission_modes?.[0] || 'default';
    const modeLabel   = seg.permission_modes?.length > 1
      ? seg.permission_modes.join(' → ')
      : primaryMode;
    const branches  = seg.branches?.join(' → ') || '';
    const turns     = seg.user_turns + seg.assistant_turns;
    const tok       = seg.tokens.output + seg.tokens.cache_read;
    const border    = sessionColor || '#2a5c8a';
    const bg        = _MODE_BG[primaryMode] || _MODE_BG.default;

    const badges = [];
    if (seg.subagent_count) badges.push(`↳ ${seg.subagent_count} subagent${seg.subagent_count > 1 ? 's' : ''}`);
    if (seg.thinking_count) badges.push(`◉ ${seg.thinking_count}`);

    const turnsHtml = (seg.turns || []).length
      ? `<div class="thr-turns">${seg.turns.map(_renderTurn).join('')}</div>`
      : '';

    return `<div class="thr-seg" style="border-left-color:${border};background:${bg}">` +
      `<div class="thr-seg-hd">` +
        `<span class="thr-wn" style="color:${border}">W${seg.index + 1}</span>` +
        `<span class="thr-mode">${esc(modeLabel)}</span>` +
        (branches ? `<span class="thr-branch">⎇ ${esc(branches)}</span>` : '') +
        `<span class="thr-meta">${turns} turns · ${fmtTok(tok)}</span>` +
        (badges.length ? `<span class="thr-badges">${esc(badges.join('  '))}</span>` : '') +
      `</div>` +
      _compBar(seg.tool_summary || {}) +
      turnsHtml +
    `</div>`;
  }

  // ── Compact divider ───────────────────────────────────────────────────────
  function _compact() {
    return `<div class="thr-compact">` +
      `<span class="thr-cline"></span>` +
      `<span class="thr-clbl">⟲ context reset</span>` +
      `<span class="thr-cline"></span>` +
    `</div>`;
  }

  // ── Full render ───────────────────────────────────────────────────────────
  function _render(data, node) {
    const segs  = data.segments || [];
    const color = node?.color || '#4488cc';
    const label = node?.label || (data.session_id || '').slice(0, 8) || '?';

    document.getElementById('thr-chrome-label').textContent = label;
    document.getElementById('thr-chrome-label').style.color = color;
    const aitEl = document.getElementById('thr-chrome-ait');
    aitEl.textContent  = data.ai_title || '';
    aitEl.style.display = data.ai_title ? '' : 'none';

    const parts = [];
    segs.forEach(seg => {
      parts.push(_segBlock(seg, color));
      if (seg.compact_trigger === 'auto') parts.push(_compact());
    });

    // Legend
    const usedTools = [...new Set(segs.flatMap(s => Object.keys(s.tool_summary || {})))];
    const legend = usedTools.filter(t => _C[t])
      .map(t => `<span class="thr-legend-dot" style="background:${_C[t]}"></span><span class="thr-legend-lbl">${esc(t)}</span>`)
      .join('');

    document.getElementById('thr-body').innerHTML =
      parts.join('') +
      (legend ? `<div class="thr-legend">${legend}</div>` : '');
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
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

  // Panel delegation — VIEW THREAD buttons
  document.getElementById('panel').addEventListener('click', e => {
    const btn = e.target.closest('[data-thread-open]');
    if (!btn) return;
    window.openThread(btn.dataset.threadOpen);
  });

  // thr-turn-text click-to-copy (user + asst). Search: data-thr-copy
  function _copyTurnText(el) {
    if (!el || !navigator.clipboard?.writeText) return;
    const clone = el.cloneNode(true);
    const badge = clone.querySelector('.thr-truncated');
    if (badge) badge.remove();
    const text = clone.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      el.classList.add('copied');
      el.title = 'Copied';
      setTimeout(() => {
        el.classList.remove('copied');
        el.title = 'Click to copy';
      }, 1400);
    }).catch(() => {
      el.title = 'Clipboard unavailable';
      setTimeout(() => { el.title = 'Click to copy'; }, 1400);
    });
  }

  document.getElementById('thr-body').addEventListener('click', e => {
    const el = e.target.closest('[data-thr-copy]');
    if (!el) return;
    e.preventDefault();
    _copyTurnText(el);
  });
  document.getElementById('thr-body').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-thr-copy]');
    if (!el) return;
    e.preventDefault();
    _copyTurnText(el);
  });

  // ── Public ────────────────────────────────────────────────────────────────
  window.openThread = async function (sessionId) {
    ov.classList.add('open');
    const node = typeof nodeById !== 'undefined' ? nodeById[sessionId] : null;

    document.getElementById('thr-chrome-label').textContent = node?.label || sessionId.slice(0, 8);
    document.getElementById('thr-chrome-label').style.color = node?.color || '#4488cc';
    document.getElementById('thr-chrome-ait').style.display = 'none';

    const cached = window._traceCache?.get(sessionId);
    if (cached) { _render(cached, node); return; }

    document.getElementById('thr-body').innerHTML = '<div class="thr-loading">loading…</div>';

    try {
      const res  = await fetch(`/api/trace/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      window._traceCache?.set(sessionId, data);
      _render(data, node);
    } catch (_) {
      document.getElementById('thr-body').innerHTML = '<div class="thr-err">trace unavailable</div>';
    }
  };

  window.closeThread = function () { ov.classList.remove('open'); };

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ov.classList.contains('open')) window.closeThread();
  });

})();
