// ── 19-daw-builder.js — Dedicated Live Pulse DAW Builder (full audio profile experience)
// Runs when the page is the pure /daw view. Works entirely from the live /events SSE
// (plus a powerful simulator). Re-uses the audio engine, beat ring, and playPulse
// established by 14-pulse-audio.js (which must be loaded first in the daw concat).

(function () {
  // Only activate the full builder UI when we see our dedicated containers.
  // This file can be safely concatenated into the main graph bundle without side effects.
  const root = document.getElementById('daw-root');
  if (!root) return; // not the builder page

  // ── Minimal live pulse ingestion for the builder (independent of 13's graph ticker) ──
  let _seenProjects = new Set();
  let _pulseCount = 0;

  function _onPulse(type, data) {
    try {
      _pulseCount++;
      const c = document.getElementById('live-count');
      if (c) c.textContent = _pulseCount + ' pulses';

      if (data && data.project) _seenProjects.add(data.project);

      // The heavy lifting (ring push + synthesis + filter) is already done by
      // window.playPulse (from 14) which we call below. We just keep local state.
      if (window.playPulse) window.playPulse(type, data);

      // Update our own log
      appendLog(type, data);
    } catch (e) { /* never break the stream */ }
  }

  function connectLive() {
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      // Offline mode — rely on simulator only
      const st = document.getElementById('daw-status');
      if (st) st.textContent = 'OFFLINE — use simulator (no /events)';
      return;
    }
    try {
      const es = new EventSource('/events');
      es.addEventListener('tool_call', e => { try { _onPulse('tool_call', JSON.parse(e.data)); } catch {} });
      es.addEventListener('tokens',    e => { try { _onPulse('tokens',    JSON.parse(e.data)); } catch {} });
      es.addEventListener('words',     e => { try { _onPulse('words',     JSON.parse(e.data)); } catch {} });
      es.onopen = () => {
        const st = document.getElementById('daw-status');
        if (st) st.textContent = 'LIVE — connected to /events';
      };
      es.onerror = () => {
        const st = document.getElementById('daw-status');
        if (st) st.textContent = 'RECONNECTING…';
      };
    } catch (e) {
      const st = document.getElementById('daw-status');
      if (st) st.textContent = 'LIVE FAILED — simulator only';
    }
  }

  // ── Enhanced standalone large DAW canvas (builder version of 16-beat-overlay logic) ──
  const H_TOTAL = 9999; // we size to container
  const H_HEADER = 18;
  const BLOCK_W = 8;
  const PX_PER_SEC = 38;
  const MAX_HIST_MS = 8 * 60 * 1000;

  let _scrollPx = 0;
  let _isLive = true;
  let _frozenNow = null;
  let _hovered = null;
  let _mouseX = 0, _mouseY = 0;
  let _dragging = false, _dragOriX = 0, _dragOriScroll = 0;

  const canvas = document.getElementById('daw-canvas');
  const wrap = document.getElementById('daw-canvas-wrap');
  let ctx = null;

  function resizeCanvas() {
    if (!canvas || !wrap) return;
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
  }
  window.addEventListener('resize', resizeCanvas);

  function nowMs() {
    return _isLive ? Date.now() : (_frozenNow ?? Date.now());
  }

  function evScreenX(ev, now) {
    return canvas.width - (now - ev.ts) / 1000 * PX_PER_SEC + _scrollPx;
  }

  function blockGeom(ev) {
    const t = (ev.tool || '').toLowerCase();
    if (ev.type === 'tokens') return { h: 5,  yOff: canvas.height - H_HEADER - 6 };
    if (ev.type === 'words')  return { h: 10, yOff: canvas.height - H_HEADER - 16 };
    if (t === 'write') return { h: 68, yOff: 2 };
    if (t === 'edit')  return { h: 58, yOff: 2 };
    if (t === 'agent') return { h: 48, yOff: 2 };
    if (t === 'read' || t === 'view_file') return { h: 38, yOff: 2 };
    if (t === 'bash' || t === 'powershell' || t === 'run_command' || t === 'shell') return { h: 26, yOff: 2 };
    if (t === 'grep' || t === 'glob' || t === 'grep_search') return { h: 16, yOff: 2 };
    return { h: 22, yOff: 2 };
  }

  const STRIPE = {
    write: '#00bb55', edit: '#ccaa00', read: '#2a5c8a',
    bash: '#cc6622', powershell: '#cc6622', shell: '#cc6622', run_command: '#cc6622',
    grep: '#7733aa', glob: '#7733aa', grep_search: '#7733aa',
    agent: '#cc2244', task: '#cc2244',
  };

  function draw() {
    if (!canvas || !wrap) return;
    if (!ctx) ctx = canvas.getContext('2d');
    resizeCanvas(); // cheap
    const W = canvas.width;
    const H = canvas.height;
    const now = nowMs();
    const ring = (window._beatRing || []).slice(); // copy for safety

    // hover
    const hov = findHovered(now, ring);
    if (hov !== _hovered) {
      _hovered = hov;
      if (hov) {
        highlightInGraphIfPossible(hov);
      }
    }

    // bg
    ctx.fillStyle = '#02020a';
    ctx.fillRect(0, 0, W, H);

    // header band
    ctx.fillStyle = '#030310';
    ctx.fillRect(0, 0, W, H_HEADER);
    ctx.strokeStyle = '#09091e';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H_HEADER - 0.5); ctx.lineTo(W, H_HEADER - 0.5); ctx.stroke();

    // time grid
    const gridPx = 10 * PX_PER_SEC;
    const phase = (_isLive ? 0 : (_frozenNow - Date.now()) / 1000 * PX_PER_SEC) - _scrollPx;
    const firstX = ((W + phase) % gridPx + gridPx) % gridPx;
    for (let x = W - firstX; x >= 0; x -= gridPx) {
      ctx.strokeStyle = '#070720';
      ctx.beginPath(); ctx.moveTo(Math.round(x), H_HEADER); ctx.lineTo(Math.round(x), H); ctx.stroke();
    }

    // event blocks (newest on the right, scrolling left)
    for (const ev of ring) {
      const x = evScreenX(ev, now);
      if (x < -BLOCK_W - 10 || x > W + 10) continue;
      const age = now - ev.ts;
      const g = blockGeom(ev);
      const ty = H_HEADER + g.yOff;
      const hot = ev === _hovered;
      const fade = Math.max(0.12, 1 - age / MAX_HIST_MS);

      ctx.globalAlpha = hot ? 1 : (0.22 + 0.58 * fade);
      ctx.fillStyle = ev.color || '#2a3a8a';
      ctx.fillRect(Math.round(x), ty, BLOCK_W, g.h);

      const stripe = STRIPE[(ev.tool || '').toLowerCase()] || (ev.type === 'tool_call' ? '#556688' : null);
      if (stripe) {
        ctx.globalAlpha = hot ? 0.95 : (0.35 + 0.45 * fade);
        ctx.fillStyle = stripe;
        ctx.fillRect(Math.round(x), ty, BLOCK_W, 2);
      }

      if (hot) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#e0e8ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x) - 0.5, ty - 0.5, BLOCK_W + 1, g.h + 1);
      }
    }
    ctx.globalAlpha = 1;

    // live glow
    if (_isLive) {
      const lg = ctx.createLinearGradient(W - 48, 0, W, 0);
      lg.addStop(0, 'rgba(16,36,100,0)');
      lg.addStop(1, 'rgba(16,36,100,0.28)');
      ctx.fillStyle = lg;
      ctx.fillRect(W - 48, H_HEADER, 48, H - H_HEADER);
    }

    // labels
    ctx.fillStyle = '#1a2a48';
    ctx.font = "bold 9px 'IBM Plex Mono',monospace";
    ctx.fillText('LIVE PULSE DAW', 10, 13);

    if (!_isLive) {
      const sec = Math.round(_scrollPx / PX_PER_SEC);
      ctx.fillStyle = '#2a3a5a';
      ctx.font = "8px 'IBM Plex Mono',monospace";
      const txt = `-${sec}s`;
      ctx.fillText(txt, W / 2 - ctx.measureText(txt).width / 2, 13);
    }

    requestAnimationFrame(draw);
  }

  function findHovered(now, ring) {
    for (let i = ring.length - 1; i >= 0; i--) {
      const ev = ring[i];
      const x = evScreenX(ev, now);
      if (x < -BLOCK_W || x > canvas.width + BLOCK_W) continue;
      const g = blockGeom(ev);
      const ty = H_HEADER + g.yOff;
      if (_mouseX >= x - 3 && _mouseX <= x + BLOCK_W + 3 &&
          _mouseY >= ty - 3 && _mouseY <= ty + g.h + 3) return ev;
    }
    return null;
  }

  function highlightInGraphIfPossible(ev) {
    // Best-effort: if the main graph page is also open or we have highlight fn
    try {
      if (typeof highlight === 'function' && ev.slug && typeof GRAPH !== 'undefined') {
        const node = GRAPH.nodes.find(n => n.type === 'session' && n.id && n.id.startsWith(ev.slug));
        if (node) highlight(node.id);
      }
    } catch {}
  }

  // Input handling for the big canvas
  function setupCanvasInput() {
    if (!canvas || !wrap) return;

    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      _scrollPx = Math.max(0, _scrollPx + (e.deltaX || e.deltaY) * 1.1);
      _setLive(_scrollPx === 0);
    }, { passive: false });

    wrap.addEventListener('mousedown', e => {
      _dragging = true; _dragOriX = e.clientX; _dragOriScroll = _scrollPx;
    });
    window.addEventListener('mouseup', () => { _dragging = false; });
    window.addEventListener('mousemove', e => {
      if (!_dragging) return;
      _scrollPx = Math.max(0, _dragOriScroll + (_dragOriX - e.clientX));
      _setLive(_scrollPx === 0);
    });

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      _mouseX = e.clientX - rect.left;
      _mouseY = e.clientY - rect.top;
    });

    canvas.addEventListener('click', e => {
      const now = nowMs();
      const ring = window._beatRing || [];
      const hov = findHovered(now, ring);
      if (hov) {
        captureEventForMapping(hov);
      } else if (e.offsetY <= H_HEADER && e.offsetX > canvas.width - 80) {
        // click LIVE label area → go live
        _scrollPx = 0; _setLive(true);
      }
    });

    wrap.addEventListener('mouseleave', () => {
      _hovered = null;
    });
  }

  function _setLive(v) {
    if (v) { _isLive = true; _frozenNow = null; }
    else if (_isLive) { _isLive = false; _frozenNow = Date.now(); }
    const b = document.getElementById('daw-live-btn');
    if (b) b.textContent = _isLive ? 'LIVE' : '◀ SCRUB';
  }

  // ── Mapping rule UI + engine glue ───────────────────────────────────────────
  let _editingRule = null;

  function renderMappings() {
    const list = document.getElementById('mappings-list');
    if (!list) return;
    const prof = window.AUDIO_PROFILE || { mappings: [] };
    list.innerHTML = '';
    (prof.mappings || []).forEach((rule, idx) => {
      const row = document.createElement('div');
      row.className = 'mapping-row';
      const m = rule.match || {};
      const eff = rule.set || {};
      row.innerHTML = `
        <div class="map-match">${JSON.stringify(m).slice(0, 92)}</div>
        <div class="map-effect">${eff.instrument || ''} ${eff.volMult ? '×' + eff.volMult : ''}</div>
        <div class="map-actions">
          <button data-act="edit" data-idx="${idx}">✎</button>
          <button data-act="del" data-idx="${idx}">✕</button>
          <button data-act="up" data-idx="${idx}">↑</button>
        </div>`;
      list.appendChild(row);
    });

    list.onclick = (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      const act = btn.dataset.act;
      const prof = window.AUDIO_PROFILE;
      if (act === 'del') {
        prof.mappings.splice(idx, 1);
        window.updateAudioProfile({ mappings: prof.mappings });
        renderMappings();
      } else if (act === 'edit') {
        _editingRule = { ...prof.mappings[idx], _idx: idx };
        showRuleForm(_editingRule);
      } else if (act === 'up' && idx > 0) {
        const tmp = prof.mappings[idx - 1];
        prof.mappings[idx - 1] = prof.mappings[idx];
        prof.mappings[idx] = tmp;
        window.updateAudioProfile({ mappings: prof.mappings });
        renderMappings();
      }
    };
  }

  function showRuleForm(rule = null) {
    const form = document.getElementById('rule-form');
    if (!form) return;
    form.style.display = 'block';
    _editingRule = rule || { match: {}, set: {} };

    // populate chips (simple)
    populateChips('match-family', ['file', 'system', 'ai', 'context'], _editingRule.match.family);
    populateChips('match-action', ['read','write','edit','bash_git','bash_run','bash_other','grep_glob','agent','other','tokens','words'], _editingRule.match.key);
    populateChips('match-harness', ['claude-code','pi','antigravity','grok'], _editingRule.match.harness);

    const where = document.getElementById('match-where');
    where.value = _editingRule.match.whereContains || '';
    document.getElementById('match-word-min').value = _editingRule.match.wordMin || '';
    document.getElementById('match-out-min').value = _editingRule.match.outMin || '';

    const instSel = document.getElementById('effect-inst');
    instSel.innerHTML = '<option value="">— keep —</option>' +
      ['harp','bass','bell','flute','bit','pling','snare','kick','hat','off']
        .map(i => `<option value="${i}">${i}</option>`).join('');
    instSel.value = _editingRule.set.instrument || '';

    document.getElementById('effect-vol').value = _editingRule.set.volMult || '';
    document.getElementById('effect-oct').value = _editingRule.set.octave || '';
    document.getElementById('effect-degree').value = _editingRule.set.degreeMode || '';
  }

  function populateChips(containerId, values, current) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    const curSet = new Set(Array.isArray(current) ? current : (current ? [current] : []));
    values.forEach(v => {
      const el = document.createElement('span');
      el.className = 'chip' + (curSet.has(v) ? ' on' : '');
      el.textContent = v;
      el.onclick = () => {
        el.classList.toggle('on');
      };
      c.appendChild(el);
    });
  }

  function readRuleFromForm() {
    const fam = readChips('match-family');
    const key = readChips('match-action');
    const harness = readChips('match-harness');
    const where = document.getElementById('match-where').value.trim();
    const wmin = parseInt(document.getElementById('match-word-min').value, 10);
    const omin = parseInt(document.getElementById('match-out-min').value, 10);

    const match = {};
    if (fam.length) match.family = fam.length === 1 ? fam[0] : fam;
    if (key.length) match.key = key.length === 1 ? key[0] : key;
    if (harness.length) match.harness = harness.length === 1 ? harness[0] : harness;
    if (where) match.whereContains = where;
    if (!isNaN(wmin)) match.wordMin = wmin;
    if (!isNaN(omin)) match.outMin = omin;

    const set = {};
    const inst = document.getElementById('effect-inst').value;
    if (inst) set.instrument = inst;
    const v = parseFloat(document.getElementById('effect-vol').value);
    if (!isNaN(v)) set.volMult = v;
    const o = parseInt(document.getElementById('effect-oct').value, 10);
    if (!isNaN(o)) set.octave = o;
    const d = document.getElementById('effect-degree').value;
    if (d) set.degreeMode = d;

    return { match, set };
  }

  function readChips(id) {
    const c = document.getElementById(id);
    if (!c) return [];
    return Array.from(c.querySelectorAll('.chip.on')).map(el => el.textContent);
  }

  function wireMappingUI() {
    const addBtn = document.getElementById('btn-add-mapping');
    const form = document.getElementById('rule-form');
    const save = document.getElementById('rule-save');
    const cancel = document.getElementById('rule-cancel');

    if (addBtn) addBtn.onclick = () => showRuleForm(null);

    if (cancel) cancel.onclick = () => { form.style.display = 'none'; _editingRule = null; };

    if (save) save.onclick = () => {
      const rule = readRuleFromForm();
      const prof = window.AUDIO_PROFILE || { mappings: [] };
      if (!prof.mappings) prof.mappings = [];
      if (_editingRule && typeof _editingRule._idx === 'number') {
        prof.mappings[_editingRule._idx] = rule;
      } else {
        prof.mappings.push(rule);
      }
      window.updateAudioProfile({ mappings: prof.mappings });
      form.style.display = 'none';
      _editingRule = null;
      renderMappings();
    };

    // initial render + allow toggling sections
    renderMappings();
    document.querySelectorAll('#side .sec-hd').forEach(h => {
      h.onclick = () => {
        const body = document.getElementById(h.getAttribute('data-toggle') + '-body');
        if (body) body.style.display = (body.style.display === 'none' ? 'block' : 'none');
      };
    });
  }

  // ── Simulator ───────────────────────────────────────────────────────────────
  function wireSimulator() {
    const emit = document.getElementById('btn-emit');
    if (!emit) return;

    emit.onclick = () => {
      const type = document.getElementById('sim-type').value;
      const data = {
        project: document.getElementById('sim-project').value || 'demo',
        harness: document.getElementById('sim-harness').value,
        tool: document.getElementById('sim-tool').value || undefined,
        where: document.getElementById('sim-where').value || undefined,
        category: document.getElementById('sim-cat').value || undefined,
        output: parseInt(document.getElementById('sim-out').value, 10) || 0,
        word_count: parseInt(document.getElementById('sim-words').value, 10) || 0,
        ts: Date.now(),
        slug: 'sim-' + Math.random().toString(36).slice(2, 8),
      };
      // Push a synthetic ring entry so the visual shows it even if audio muted
      try {
        if (window._beatRing) {
          window._beatRing.push({
            ts: data.ts,
            color: '#88aaff',
            label: data.tool || type,
            type,
            project: data.project,
            tool: data.tool,
            where: data.where,
            category: data.category,
            preview: type === 'words' ? 'simulated text…' : null,
          });
          if (window._beatRing.length > 1000) window._beatRing.shift();
        }
      } catch {}

      if (window.playPulse) window.playPulse(type, data);
      appendLog(type + ' (sim)', data);
    };
  }

  // ── Timbre Lab (basic live param overrides) ─────────────────────────────────
  // For v1 we expose a few high-impact params per instrument and patch the
  // synth functions at runtime. A full data-driven rewrite of the 9 synths
  // can come in a follow-up.
  const TIMBRE_DEFAULTS = {
    bass: { vol: 0.48, decay: 1.4 },
    bell: { vol: 0.32, decay: 2.5 },
    flute: { vol: 0.18, decay: 0.65 },
    harp: { vol: 0.42, decay: 0.9 },
    pling: { vol: 0.30, decay: 0.48 },
    bit: { vol: 0.14, decay: 0.22 },
    snare: { vol: 0.32, decay: 0.12 },
    kick: { vol: 0.46, decay: 0.25 },
    hat: { vol: 0.18, decay: 0.04 },
  };

  function wireTimbreLab() {
    const container = document.getElementById('timbre-insts');
    if (!container) return;

    const prof = window.AUDIO_PROFILE;
    if (!prof.timbre) prof.timbre = {};

    Object.keys(TIMBRE_DEFAULTS).forEach(inst => {
      const d = TIMBRE_DEFAULTS[inst];
      const t = prof.timbre[inst] || (prof.timbre[inst] = { ...d });

      const row = document.createElement('div');
      row.className = 'timbre-row';
      row.innerHTML = `
        <label>${inst}</label>
        <input type="range" min="0.02" max="0.9" step="0.01" value="${t.vol}">
        <span class="v vol">${t.vol.toFixed(2)}</span>
        <input type="range" min="0.02" max="3.5" step="0.02" value="${t.decay}">
        <span class="v dec">${t.decay.toFixed(2)}</span>
      `;
      const [vSlider, , dSlider] = row.querySelectorAll('input');
      const [vLab, dLab] = row.querySelectorAll('.v');

      vSlider.oninput = () => { t.vol = parseFloat(vSlider.value); vLab.textContent = t.vol.toFixed(2); };
      dSlider.oninput = () => { t.decay = parseFloat(dSlider.value); dLab.textContent = t.decay.toFixed(2); };

      // Live patch into the synths where easy (we mutate the closed-over behaviour by
      // wrapping the original INSTS functions for the builder session).
      vSlider.onchange = dSlider.onchange = () => applyTimbrePatch(inst, t);

      container.appendChild(row);
    });

    const reset = document.getElementById('btn-reset-timbre');
    if (reset) reset.onclick = () => {
      window.AUDIO_PROFILE.timbre = JSON.parse(JSON.stringify(TIMBRE_DEFAULTS));
      window.updateAudioProfile({ timbre: window.AUDIO_PROFILE.timbre });
      // crude reload of the lab
      container.innerHTML = '';
      wireTimbreLab();
    };
  }

  function applyTimbrePatch(inst, t) {
    // For the most impactful instruments we monkey the closed INST functions.
    // This is a builder-only live hack; the main view keeps original behaviour.
    const orig = window._origInsts || (window._origInsts = {});
    const INSTS = window.INSTS || {};
    if (!orig[inst]) orig[inst] = INSTS[inst];

    if (inst === 'bass') {
      INSTS[inst] = function bass(c, at, hz, vol) {
        vol = (vol ?? t.vol ?? 0.48);
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = (hz || 110) / 2;
        const g = c.createGain();
        g.gain.setValueAtTime(vol, at);
        g.gain.exponentialRampToValueAtTime(0.001, at + (t.decay || 1.4));
        o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + (t.decay || 1.4) + 0.1);
      };
    } else if (inst === 'bell') {
      INSTS[inst] = function bell(c, at, hz, vol) {
        vol = vol ?? t.vol ?? 0.32;
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = (hz || 440) * 2;
        const g = c.createGain();
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, at + (t.decay || 2.5));
        o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + (t.decay || 2.5) + 0.1);
      };
    }
    // Other instruments keep their original (or can be extended the same way).
  }

  // ── Profiles (rich: settings + mappings + timbre) ───────────────────────────
  function loadProfiles() {
    try {
      return JSON.parse(localStorage.getItem('kaaro-daw-profiles') || '{}');
    } catch { return {}; }
  }
  function saveProfiles(p) {
    try { localStorage.setItem('kaaro-daw-profiles', JSON.stringify(p)); } catch {}
  }

  function renderProfiles() {
    const box = document.getElementById('profile-list');
    if (!box) return;
    const profs = loadProfiles();
    box.innerHTML = '';
    Object.keys(profs).forEach(name => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = name;
      b.onclick = () => applyProfile(name, profs[name]);
      box.appendChild(b);
    });
    if (!Object.keys(profs).length) {
      box.innerHTML = '<span style="color:#334">no saved profiles yet</span>';
    }
  }

  function applyProfile(name, data) {
    if (!data) return;
    // Merge into the live windows
    if (data.settings) window.updateAudioSettings(data.settings);
    if (data.profile) window.updateAudioProfile(data.profile);
    document.getElementById('profile-name').textContent = name.toUpperCase();
    renderMappings();
    // push bpm etc if present
    if (data.profile && data.profile.bpm && window.setClickTrack) {
      // restart click if on
    }
  }

  function wireProfiles() {
    const saveBtn = document.getElementById('btn-save-profile');
    const nameIn = document.getElementById('profile-save-name');
    if (!saveBtn || !nameIn) return;

    saveBtn.onclick = () => {
      const nm = (nameIn.value || 'untitled').trim();
      if (!nm) return;
      const profs = loadProfiles();
      profs[nm] = {
        settings: JSON.parse(JSON.stringify(window.AUDIO_SETTINGS || {})),
        profile: JSON.parse(JSON.stringify(window.AUDIO_PROFILE || {})),
        savedAt: new Date().toISOString(),
      };
      saveProfiles(profs);
      renderProfiles();
      document.getElementById('profile-name').textContent = nm.toUpperCase();
      nameIn.value = '';
    };

    // quick export / import of the active profile
    const exp = document.getElementById('btn-export');
    if (exp) exp.onclick = () => {
      const blob = new Blob([JSON.stringify({
        settings: window.AUDIO_SETTINGS,
        profile: window.AUDIO_PROFILE,
      }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kaaro-audio-profile.json';
      a.click();
    };

    const imp = document.getElementById('btn-import');
    if (imp) imp.onclick = () => {
      const ta = prompt('Paste JSON profile (or leave empty to cancel)');
      if (!ta) return;
      try {
        const j = JSON.parse(ta);
        if (j.settings) window.updateAudioSettings(j.settings);
        if (j.profile) window.updateAudioProfile(j.profile);
        document.getElementById('profile-name').textContent = 'IMPORTED';
        renderMappings();
      } catch (e) { alert('Bad JSON: ' + e.message); }
    };

    renderProfiles();
  }

  // ── Log + helpers ───────────────────────────────────────────────────────────
  function appendLog(type, data) {
    const log = document.getElementById('log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'log-line';
    const proj = data.project || '?';
    const tool = data.tool || type;
    const extra = data.where ? ' ' + String(data.where).slice(0, 28) : '';
    line.innerHTML = `<span class="t">${new Date().toLocaleTimeString().slice(0,8)}</span> ` +
      `<span class="proj">${proj}</span> <span class="tool">${tool}</span>${extra}`;
    log.appendChild(line);
    while (log.children.length > 120) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function captureEventForMapping(ev) {
    // Pre-fill the rule form from a real (or simulated) event
    const form = document.getElementById('rule-form');
    if (!form) return;

    const key = (ev.type === 'tool_call')
      ? (ev.tool || '').toLowerCase() === 'write' ? 'write'
      : (ev.tool || '').toLowerCase() === 'edit' ? 'edit'
      : (ev.tool || '').toLowerCase() === 'read' ? 'read'
      : (ev.tool || '').toLowerCase() === 'agent' ? 'agent' : 'other'
      : ev.type;

    const fam = (window.TOOL_FAMILY || {})[key] || (ev.type === 'tokens' ? 'context' : ev.type === 'words' ? 'context' : 'ai');

    _editingRule = {
      match: { key, family: fam },
      set: {},
      _fromEvent: ev,
    };
    showRuleForm(_editingRule);

    // Also scroll the side into view
    const side = document.getElementById('side');
    if (side) side.scrollTop = 40;
  }

  function wireGlobalKeys() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        _scrollPx = 0; _setLive(true);
        const form = document.getElementById('rule-form');
        if (form) form.style.display = 'none';
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'enter') {
        const emit = document.getElementById('btn-emit');
        if (emit) emit.click();
      }
    });

    // BPM slider in hud
    const bpmS = document.getElementById('daw-bpm');
    const bpmV = document.getElementById('daw-bpm-val');
    if (bpmS && bpmV) {
      bpmS.oninput = () => {
        const v = parseInt(bpmS.value, 10);
        bpmV.textContent = v;
        if (window.updateAudioSettings) window.updateAudioSettings({ bpm: v });
      };
      // seed
      bpmS.value = (window.AUDIO_SETTINGS && window.AUDIO_SETTINGS.bpm) || 120;
      bpmV.textContent = bpmS.value;
    }
    const tap = document.getElementById('daw-tap');
    if (tap) {
      let taps = [];
      tap.onclick = () => {
        const now = Date.now();
        taps = taps.filter(t => now - t < 2200).concat(now);
        if (taps.length >= 2) {
          const diffs = taps.slice(1).map((t, i) => t - taps[i]);
          const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
          const bpm = Math.max(40, Math.min(240, Math.round(60000 / avg)));
          if (bpmS) bpmS.value = bpm;
          if (bpmV) bpmV.textContent = bpm;
          if (window.updateAudioSettings) window.updateAudioSettings({ bpm });
        }
      };
    }

    const liveBtn = document.getElementById('daw-live-btn');
    if (liveBtn) liveBtn.onclick = () => { _scrollPx = 0; _setLive(true); };

    const clr = document.getElementById('daw-clear-btn');
    if (clr) clr.onclick = () => {
      if (window._beatRing) window._beatRing.length = 0;
    };
  }

  // ── Boot the builder experience ─────────────────────────────────────────────
  function bootBuilder() {
    // 1. Live connection (or simulator fallback)
    connectLive();

    // 2. Big canvas DAW
    resizeCanvas();
    setupCanvasInput();
    requestAnimationFrame(draw);

    // 3. Mapping UI
    wireMappingUI();

    // 4. Simulator
    wireSimulator();

    // 5. Timbre lab (lightweight live overrides)
    wireTimbreLab();

    // 6. Profiles
    wireProfiles();

    // 7. Keys + misc
    wireGlobalKeys();

    // Seed a couple of example mappings the first time someone opens the builder
    const prof = window.AUDIO_PROFILE || {};
    if (!prof.mappings || prof.mappings.length === 0) {
      prof.mappings = [
        { match: { key: 'write' }, set: { instrument: 'bass', volMult: 1.15 } },
        { match: { family: 'context', type: 'tokens' }, set: { volMult: 0.7, octave: -1 } },
        { match: { key: 'agent' }, set: { instrument: 'bell', octave: 1 } },
      ];
      window.updateAudioProfile({ mappings: prof.mappings });
      renderMappings();
    }

    // Make sure the ring is the one 14 is using
    if (!window._beatRing) window._beatRing = [];

    // Initial status
    const st = document.getElementById('daw-status');
    if (st && st.textContent.indexOf('LIVE') === -1) {
      st.textContent = 'READY — emit or wait for real pulses';
    }

    // Expose a couple of helpers on window for power users / console
    window.emitPulse = (type, data) => _onPulse(type, data || {});
    window.captureLastForMapping = () => {
      const ring = window._beatRing || [];
      if (ring.length) captureEventForMapping(ring[ring.length - 1]);
    };

    console.log('%c[kaaro-daw] Full builder ready — live event stream + sonic axis mapping', 'color:#4455aa');
  }

  // kick off
  bootBuilder();
})();
