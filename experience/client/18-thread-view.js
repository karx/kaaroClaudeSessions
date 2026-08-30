// ── Thread View — Session Context Arc ─────────────────────────────────────
// Full-screen overlay, centered reading column (oldest turn at top, newest
// at bottom — same order the transcript was recorded in). Each context
// window is a segment block with:
//   • a stacked composition bar (tool proportions at a glance)
//   • every turn: user messages, assistant reasoning, tool calls with inputs
// While open on an active session, a live tail below the transcript
// aggregates incoming tool_call/words/cognition pulses off window._beatRing
// (14-pulse-audio.js) — see _startLive/_liveTick.
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
  // highlightMatches / readableTextOn defined in experience/client-core.mjs (injected by build.mjs)

  // ── Find-in-thread ─────────────────────────────────────────────────────────
  let _query = '';
  /** esc() every non-match run, wrap matches in <mark class="thr-hit"> when a search is active. */
  function _hl(text) { return highlightMatches(text || '', _query, esc); }

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
      const label = readableTextOn(color);
      return `<div class="thr-bar-seg" style="width:${pct}%;background:${color}" title="${esc(name)} × ${n}">` +
             `<span class="thr-bar-lbl" style="color:${label}">${esc(name)}</span></div>`;
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
    } else if (n === 'Agent' || n === 'Task') {
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
    const firstLine = _hl(lines[0] || '');
    const restLines = lines.slice(1).filter(l => l.trim());
    const moreLines = restLines.length
      ? '<div class="thr-tc-cont">' +
          restLines.map(l => `<span class="thr-tc-contline">${_hl(l)}</span>`).join('') +
        '</div>'
      : '';

    // Edit diff preview
    let diffHtml = '';
    if ((n === 'Edit' || n === 'MultiEdit') && (inp.old_string || inp.new_string)) {
      const oldFirst = (inp.old_string || '').split('\n')[0];
      const newFirst = (inp.new_string || '').split('\n')[0];
      diffHtml = `<div class="thr-tc-diff">` +
        (oldFirst ? `<span class="thr-tc-del">- ${_hl(oldFirst)}</span>` : '') +
        (newFirst ? `<span class="thr-tc-add">+ ${_hl(newFirst)}</span>` : '') +
      `</div>`;
    }

    // Tool identity is a small color swatch, not the text color itself — the
    // name text stays a fixed AA-readable tone (WCAG 1.4.1: color is not the
    // only signal, and per-tool hues are too dark on near-black to hit 4.5:1).
    return `<div class="thr-tc${err ? ' thr-tc-err' : ''}">` +
      `<span class="thr-tc-dot" style="background:${color}"></span>` +
      `<span class="thr-tc-name">${_hl(n)}</span>` +
      `<span class="thr-tc-arg">${firstLine}</span>` +
      (err && tc.error_text ? `<span class="thr-tc-errtxt">${esc(tc.error_text.slice(0, 120))}</span>` : '') +
    `</div>` +
    moreLines +
    diffHtml;
  }

  // ── Nested subagent tree (from /api/trace subagents / turn.spawned_subagents)
  function _toolSummaryLine(summary) {
    if (!summary || !Object.keys(summary).length) return '';
    return Object.entries(summary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, n]) => `${name}×${n}`)
      .join(' · ');
  }

  function _renderSubagent(ref, depth = 0) {
    if (!ref || depth > 2) return '';
    const type = ref.agent_type || 'agent';
    const desc = ref.description || ref.agent_id || 'subagent';
    const shortId = (ref.agent_id || '').slice(0, 8);
    const toolsLine = _toolSummaryLine(ref.tree?.segments?.[0]?.tool_summary);
    const nestedTurns = (ref.tree?.segments || []).flatMap(s => s.turns || []);
    const body = ref.tree
      ? (nestedTurns.length
          ? `<div class="thr-sub-turns">${nestedTurns.map(t => _renderTurn(t, depth + 1)).join('')}</div>`
          : '<div class="thr-sub-empty">no turns in child transcript</div>')
      : '<div class="thr-sub-empty">transcript unavailable</div>';

    return `<details class="thr-subagent" data-agent-id="${esc(ref.agent_id || '')}">` +
      `<summary class="thr-sub-sum">` +
        `<span class="thr-sub-mark">↳</span>` +
        `<span class="thr-sub-type">${_hl(type)}</span>` +
        `<span class="thr-sub-desc">${_hl(desc)}</span>` +
        (shortId ? `<span class="thr-sub-id">${esc(shortId)}</span>` : '') +
        (toolsLine ? `<span class="thr-sub-tools">${esc(toolsLine)}</span>` : '') +
      `</summary>` +
      body +
    `</details>`;
  }

  function _subagentRoster(subagents) {
    if (!subagents || !subagents.length) return '';
    const rows = subagents.map(s => {
      const toolsLine = _toolSummaryLine(s.tree?.segments?.[0]?.tool_summary);
      return `<div class="thr-roster-row">` +
        `<span class="thr-sub-mark">↳</span>` +
        `<span class="thr-sub-type">${_hl(s.agent_type || 'agent')}</span>` +
        `<span class="thr-sub-desc">${_hl(s.description || s.agent_id || '?')}</span>` +
        (s.linked === false ? '<span class="thr-sub-unlinked">unlinked</span>' : '') +
        (toolsLine ? `<span class="thr-sub-tools">${esc(toolsLine)}</span>` : '') +
      `</div>`;
    }).join('');
    return `<div class="thr-roster">` +
      `<div class="thr-roster-hd">◆ SUBAGENTS (${subagents.length})</div>` +
      rows +
    `</div>`;
  }

  // ── Single turn ───────────────────────────────────────────────────────────
  function _renderTurn(turn, depth = 0) {
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
      ? `<div class="thr-turn-text thr-turn-text-copy" data-thr-copy title="Click to copy" role="button" tabindex="0">${_hl(turn.text)}${trunc}</div>`
      : '';

    const spawnById = new Map(
      (turn.spawned_subagents || []).filter(s => s.tool_use_id).map(s => [s.tool_use_id, s]),
    );

    const toolsHtml = (turn.tool_calls || []).length
      ? `<div class="thr-tcs">${turn.tool_calls.map(tc => {
          let html = _renderToolCall(tc);
          if ((tc.name === 'Agent' || tc.name === 'Task') && tc.id && spawnById.has(tc.id)) {
            html += _renderSubagent(spawnById.get(tc.id), depth);
          }
          return html;
        }).join('')}</div>`
      : '';

    // Spawns not attached under an Agent/Task tool row (missing tool_use_id or no matching tool)
    const renderedIds = new Set(
      (turn.tool_calls || [])
        .filter(tc => (tc.name === 'Agent' || tc.name === 'Task') && tc.id && spawnById.has(tc.id))
        .map(tc => tc.id),
    );
    const orphanSpawns = (turn.spawned_subagents || [])
      .filter(s => !s.tool_use_id || !renderedIds.has(s.tool_use_id));
    const orphanHtml = orphanSpawns.map(s => _renderSubagent(s, depth)).join('');

    return `<div class="thr-turn thr-turn-${isUser ? 'user' : 'asst'}">${header}${textHtml}${toolsHtml}${orphanHtml}</div>`;
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
  let _lastData = null, _lastNode = null;

  function _render(data, node) {
    _lastData = data; _lastNode = node;
    const segs  = data.segments || [];
    const color = node?.color || '#4488cc';
    const label = node?.label || (data.session_id || '').slice(0, 8) || '?';

    document.getElementById('thr-chrome-label').textContent = label;
    document.getElementById('thr-chrome-label').style.color = color;
    const aitEl = document.getElementById('thr-chrome-ait');
    aitEl.textContent  = data.ai_title || '';
    aitEl.style.display = data.ai_title ? '' : 'none';

    const parts = [];
    if (data.subagents?.length) parts.push(_subagentRoster(data.subagents));
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

    _refreshHits();
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  const ov  = document.createElement('div');
  ov.id     = 'thread-view';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Session thread');
  ov.tabIndex = -1;
  ov.innerHTML = `
    <div id="thr-chrome">
      <div id="thr-chrome-left">
        <span id="thr-chrome-label"></span>
        <span id="thr-chrome-ait"></span>
        <span id="thr-chrome-order" title="Transcript order">oldest → newest</span>
        <span id="thr-live-badge" class="thr-live-badge" title="Live tool activity on this session">● LIVE</span>
      </div>
      <div id="thr-search">
        <input id="thr-search-input" type="text" placeholder="find in thread… (/)"
               aria-label="Search thread" autocomplete="off" spellcheck="false">
        <span id="thr-search-count" role="status" aria-live="polite"></span>
        <button id="thr-search-prev" class="thr-search-btn" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled>▲</button>
        <button id="thr-search-next" class="thr-search-btn" aria-label="Next match" title="Next match (Enter)" disabled>▼</button>
      </div>
      <button id="thr-close-btn" onclick="window.closeThread()" aria-label="Close thread view (Esc)">✕</button>
    </div>
    <div id="thr-scroll"><div id="thr-content"><div id="thr-body"></div><div id="thr-live"></div></div></div>`;
  document.body.appendChild(ov);

  // Panel delegation — VIEW THREAD buttons
  let _opener = null;
  document.getElementById('panel').addEventListener('click', e => {
    const btn = e.target.closest('[data-thread-open]');
    if (!btn) return;
    _opener = btn;
    window.openThread(btn.dataset.threadOpen);
  });

  // ── Find-in-thread wiring ────────────────────────────────────────────────
  const _searchInput = document.getElementById('thr-search-input');
  const _searchCount = document.getElementById('thr-search-count');
  const _searchPrev  = document.getElementById('thr-search-prev');
  const _searchNext  = document.getElementById('thr-search-next');
  let _hits = [];
  let _hitIdx = -1;
  let _debounce = null;

  function _updateCount() {
    _searchCount.textContent = !_query ? ''
      : _hits.length ? `${_hitIdx + 1} / ${_hits.length}` : 'no matches';
    _searchPrev.disabled = _searchNext.disabled = _hits.length === 0;
  }

  // Re-collect .thr-hit nodes after every render (query change, or a fresh
  // thread load while a search is still active) and jump to the first match.
  function _refreshHits() {
    _hits = Array.from(document.querySelectorAll('#thr-body .thr-hit'));
    _hitIdx = -1;
    if (_hits.length) _setCurrentHit(0); else _updateCount();
  }

  function _setCurrentHit(idx) {
    if (!_hits.length) { _hitIdx = -1; _updateCount(); return; }
    if (_hitIdx >= 0 && _hits[_hitIdx]) _hits[_hitIdx].classList.remove('thr-hit-current');
    _hitIdx = ((idx % _hits.length) + _hits.length) % _hits.length;
    const el = _hits[_hitIdx];
    el.classList.add('thr-hit-current');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    _updateCount();
  }

  function _runSearch() {
    _query = _searchInput.value.trim();
    if (_lastData) _render(_lastData, _lastNode);
  }

  function _clearSearch() {
    _searchInput.value = '';
    const had = !!_query;
    _searchInput.blur();
    if (had) _runSearch();
  }

  _searchInput.addEventListener('input', () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(_runSearch, 120);
  });
  _searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _setCurrentHit(_hitIdx + (e.shiftKey ? -1 : 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _clearSearch(); }
  });
  _searchPrev.addEventListener('click', () => _setCurrentHit(_hitIdx - 1));
  _searchNext.addEventListener('click', () => _setCurrentHit(_hitIdx + 1));

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

  // ── Live tail (active session) ───────────────────────────────────────────
  // Reads window._beatRing (14-pulse-audio.js), which every live SSE pulse
  // is pushed onto regardless of audio mute state — see window.playPulse.
  // ev.slug is session_id.slice(0,8); sessionId.startsWith(ev.slug) matches it.
  const _liveEl    = document.getElementById('thr-live');
  const _liveBadge = document.getElementById('thr-live-badge');
  let _liveSessionId  = null;
  let _liveIdx        = 0;
  let _liveTimer       = null;
  let _liveHeaderShown = false;
  let _liveLastSeenAt  = 0;
  const LIVE_POLL_MS  = 600;
  const LIVE_IDLE_MS  = 15_000; // no pulse in this long → drop the LIVE badge

  function _liveRowHtml(ev) {
    const time = _timeLabel(ev.ts);
    if (ev.type === 'tokens') return ''; // folded into the badge only — too noisy as rows
    if (ev.type === 'tool_call') {
      const color = _C[ev.tool] || '#3a5070';
      const where = ev.where ? ev.where.replace(/\\/g, '/').split('/').pop() : '';
      return `<div class="thr-live-row">` +
        `<span class="thr-tc-dot" style="background:${color}"></span>` +
        `<span class="thr-tc-name">${esc(ev.tool || 'tool')}</span>` +
        `<span class="thr-tc-arg">${esc(where)}</span>` +
        `<span class="thr-live-ts">${time}</span>` +
      `</div>`;
    }
    if (ev.type === 'words') {
      return `<div class="thr-live-row thr-live-words">` +
        `<span class="thr-actor thr-actor-asst">ASST</span>` +
        `<span class="thr-turn-text">${esc(ev.preview || '')}</span>` +
        `<span class="thr-live-ts">${time}</span>` +
      `</div>`;
    }
    // cognition pulses: human_turn, compact, permission, mode_shift, tool_error, api_error, …
    return `<div class="thr-live-row thr-live-cog">` +
      `<span class="thr-live-cog-lbl">${esc(ev.type)}</span>` +
      `<span class="thr-live-ts">${time}</span>` +
    `</div>`;
  }

  function _setLiveBadge(on) { _liveBadge.classList.toggle('on', on); }

  function _liveTick() {
    const ring = window._beatRing || [];
    if (_liveIdx > ring.length) _liveIdx = 0; // ring truncated/reset under us
    let appended = '';
    for (; _liveIdx < ring.length; _liveIdx++) {
      const ev = ring[_liveIdx];
      if (!ev.slug || !_liveSessionId || !_liveSessionId.startsWith(ev.slug)) continue;
      const row = _liveRowHtml(ev);
      if (row) appended += row;
      _liveLastSeenAt = Date.now();
    }
    if (appended) {
      if (!_liveHeaderShown) {
        _liveEl.insertAdjacentHTML('beforeend', '<div class="thr-live-hd"><span class="thr-live-dot"></span>LIVE — incoming activity</div>');
        _liveHeaderShown = true;
      }
      const scrollEl = document.getElementById('thr-scroll');
      const wasAtBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 48;
      _liveEl.insertAdjacentHTML('beforeend', appended);
      if (wasAtBottom) scrollEl.scrollTop = scrollEl.scrollHeight;
    }
    if (_liveLastSeenAt) _setLiveBadge(Date.now() - _liveLastSeenAt < LIVE_IDLE_MS);
  }

  function _startLive(sessionId) {
    _stopLive();
    _liveSessionId  = sessionId;
    _liveIdx        = (window._beatRing || []).length; // only pulses from here forward
    _liveHeaderShown = false;
    _liveLastSeenAt  = 0;
    _liveEl.innerHTML = '';
    _setLiveBadge(false);
    _liveTimer = setInterval(_liveTick, LIVE_POLL_MS);
  }

  function _stopLive() {
    if (_liveTimer) clearInterval(_liveTimer);
    _liveTimer = null;
    _liveSessionId = null;
    _setLiveBadge(false);
  }

  // ── Public ────────────────────────────────────────────────────────────────
  window.openThread = async function (sessionId) {
    if (!_opener) _opener = document.activeElement;
    ov.classList.add('open');
    _query = '';
    _searchInput.value = '';
    ov.focus();
    _startLive(sessionId);
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

  window.closeThread = function () {
    ov.classList.remove('open');
    _stopLive();
    _opener?.focus?.();
    _opener = null;
  };

  document.addEventListener('keydown', e => {
    if (!ov.classList.contains('open')) return;
    if (e.key === 'Escape') {
      if (document.activeElement === _searchInput && _query) { e.preventDefault(); _clearSearch(); return; }
      window.closeThread();
      return;
    }
    if (e.key === '/' && document.activeElement !== _searchInput) {
      e.preventDefault();
      _searchInput.focus();
    }
  });

})();
