// â”€â”€ Cognitive DAW Builder v2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Multi-lane canvas Â· mixer strips Â· automation curves Â· tab panel
// Only activates when #daw-root is present (dedicated /daw page).
// Reads window._beatRing (14-pulse-audio.js), calls window.playPulse.

(function () {
  const root = document.getElementById('daw-root');
  if (!root) return; // guard: main graph page loads this file too

  // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const S = {
    scrollMs:       0,
    isLive:         true,
    frozenNow:      null,
    windowMs:       30000,
    hovered:        null,
    mx:             0,
    my:             0,
    dragging:       false,
    dragOriX:       0,
    dragOriScrollMs:0,
    activeTab:      'map',
    editingRuleIdx: null,
    mixer: {
      file:    { gain: 1, muted: false, soloed: false },
      system:  { gain: 1, muted: false, soloed: false },
      ai:      { gain: 1, muted: false, soloed: false },
      context: { gain: 1, muted: false, soloed: false },
    },
  };

  // â”€â”€ Lane definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const FAMILY_LANES = DAW_FAMILY_LANES; // shared core (00-core.js)

  const FAMILY_LABEL_COLORS = {
    file: '#2a7a3a', system: '#3a5aaa', ai: '#aa3388', context: '#2a8aaa',
  };

  // â”€â”€ Canvas refs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function dawCanvas()  { return document.getElementById('daw-canvas'); }
  function autoCanvas() { return document.getElementById('auto-canvas'); }

  function resizeBothCanvases() {
    const dc = dawCanvas();
    if (dc && dc.parentElement) {
      dc.width  = dc.parentElement.clientWidth;
      dc.height = dc.parentElement.clientHeight - 80; // minus auto-canvas
    }
    const ac = autoCanvas();
    if (ac && ac.parentElement) {
      ac.width  = ac.parentElement.clientWidth;
      ac.height = 80;
    }
  }

  // â”€â”€ Lane layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // computeLaneLayout / laneForEvent come from the shared core (00-core.js)

  // â”€â”€ Time helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function nowMs() { return S.isLive ? Date.now() : (S.frozenNow ?? Date.now()); }

  function evX(ev, now, W, PX_PER_SEC) {
    return evTimeX(ev, now, W, PX_PER_SEC, S.scrollMs);
  }

  // â”€â”€ Draw DAW lanes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let _dawCtx = null;

  function drawDaw() {
    requestAnimationFrame(drawDaw);
    const canvas = dawCanvas(); if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    if (!_dawCtx) _dawCtx = canvas.getContext('2d');
    const ctx = _dawCtx;
    const now = nowMs();
    const PX_PER_SEC = W / (S.windowMs / 1000);
    const ring = (window._beatRing || []).slice();

    // bg
    ctx.fillStyle = '#01010a'; ctx.fillRect(0, 0, W, H);

    // time ruler
    drawRuler(ctx, W, now, PX_PER_SEC);

    const layout = computeLaneLayout(H);

    for (const lane of FAMILY_LANES) {
      const l = layout.find(x => x.id === lane.id); if (!l) continue;
      const { y, h } = l;

      // lane bg
      ctx.fillStyle = lane.bg; ctx.fillRect(0, y, W, h);

      // lane label
      const labelCol = FAMILY_LABEL_COLORS[lane.id] || '#334';
      ctx.fillStyle = labelCol; ctx.font = "bold 8px 'IBM Plex Mono',monospace";
      ctx.fillText(lane.label, 4, y + 12);

      // muted overlay
      if (S.mixer[lane.id]?.muted) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, y, W, h);
        ctx.fillStyle = '#333'; ctx.font = "7px 'IBM Plex Mono',monospace";
        ctx.fillText('MUTED', W / 2 - 14, y + h / 2 + 3);
      }

      // events for this lane
      for (const ev of ring) {
        if (ev.family !== lane.id) continue;
        const x   = evX(ev, now, W, PX_PER_SEC);
        const bw  = lane.blockW(ev);
        if (x < -bw - 4 || x > W + 4) continue;
        const bh  = Math.max(2, lane.blockH(ev) * (h - 16));
        const by  = y + h - bh - 3;
        const col = lane.toolColors[ev.key] || lane.toolColors.other || ev.color || '#446';
        const age = now - ev.ts;
        const fade = Math.max(0.12, 1 - age / (S.windowMs * 2));
        const hot  = ev === S.hovered;

        ctx.globalAlpha = hot ? 1 : 0.18 + 0.67 * fade;
        ctx.fillStyle   = col;
        ctx.fillRect(Math.round(x), by, bw, bh);

        // 2px top stripe (brighter)
        ctx.globalAlpha = hot ? 0.95 : (0.4 + 0.4 * fade);
        ctx.fillRect(Math.round(x), by, bw, 2);

        // 2px bottom stripe: project color — note attribution at a glance
        if (ev.color) {
          ctx.fillStyle = ev.color;
          ctx.fillRect(Math.round(x), by + bh - 2, bw, 2);
          ctx.fillStyle = col;
        }

        if (hot) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#e0e8ff'; ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(x) - 0.5, by - 0.5, bw + 1, bh + 1);
        }
      }
      ctx.globalAlpha = 1;

      // lane separator
      ctx.strokeStyle = '#0a0a22'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + h - 0.5); ctx.lineTo(W, y + h - 0.5); ctx.stroke();
    }

    // live glow on right edge
    if (S.isLive) {
      const lg = ctx.createLinearGradient(W - 44, 0, W, 0);
      lg.addColorStop(0, 'rgba(16,30,90,0)'); lg.addColorStop(1, 'rgba(16,30,90,0.22)');
      ctx.fillStyle = lg; ctx.fillRect(W - 44, 20, 44, H - 20);
    }

    // hover tooltip
    drawTooltip(ctx, W, H, now, PX_PER_SEC, ring);
  }

  function drawRuler(ctx, W, now, PX_PER_SEC) {
    ctx.fillStyle = '#030312'; ctx.fillRect(0, 0, W, 20);
    ctx.strokeStyle = '#0a0a28'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 19.5); ctx.lineTo(W, 19.5); ctx.stroke();

    const scrollSec = S.scrollMs / 1000;
    const startSec  = Math.floor(scrollSec / 10) * 10;
    ctx.fillStyle = KAARO_TOKENS.dim; ctx.font = "7px 'IBM Plex Mono',monospace";
    for (let sec = startSec; sec <= scrollSec + S.windowMs / 1000 + 10; sec += 10) {
      const x = W - (now / 1000 - sec) * PX_PER_SEC + scrollSec * PX_PER_SEC;
      if (x < -2 || x > W + 2) continue;
      const major = sec % 30 === 0;
      ctx.strokeStyle = major ? '#181838' : '#0e0e24';
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, major ? 12 : 15); ctx.lineTo(Math.round(x) + 0.5, 19); ctx.stroke();
      if (major) {
        const lbl = sec === 0 ? '0' : (sec > 0 ? '-' + sec + 's' : '+' + (-sec) + 's');
        ctx.fillText(lbl, Math.round(x) - 8, 10);
      }
    }

    if (!S.isLive) {
      ctx.fillStyle = '#2a3a6a'; ctx.font = "bold 8px 'IBM Plex Mono',monospace";
      ctx.fillText('â—€ SCRUB  -' + Math.round(S.scrollMs / 1000) + 's', W / 2 - 40, 13);
    }
  }

  function drawTooltip(ctx, W, H, now, PX_PER_SEC, ring) {
    const ev = findHovered(now, PX_PER_SEC, ring);
    if (ev !== S.hovered) S.hovered = ev;
    if (!ev) return;

    const lane = laneForEvent(ev); if (!lane) return;
    const layout = computeLaneLayout(H);
    const l = layout.find(x => x.id === lane.id); if (!l) return;

    const x = evX(ev, now, W, PX_PER_SEC);
    const lines = [
      (ev.tool || ev.label || ev.type) + (ev.harness ? ' [' + ev.harness + ']' : ''),
      ev.slug    ? 'ses: ' + ev.slug : null,
      ev.project ? 'proj: ' + ev.project : null,
      ev.where   ? 'where: ' + String(ev.where).replace(/\\/g, '/').slice(-36) : null,
      ev.output  ? 'out: ' + ev.output + ' tok' : null,
      ev.pan != null ? 'pan: ' + ev.pan.toFixed(2) + '  bri: ' + (ev.brightness || 'â€”') : null,
    ].filter(Boolean);

    const pad = 5, lh = 13, bw = 180, bh = lines.length * lh + pad * 2;
    let tx = Math.round(x) + 10;
    if (tx + bw > W - 4) tx = Math.round(x) - bw - 4;
    const ty = Math.max(20, l.y - bh - 2);

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#06061a'; ctx.fillRect(tx, ty, bw, bh);
    ctx.strokeStyle = KAARO_TOKENS.dim; ctx.lineWidth = 1;
    ctx.strokeRect(tx + 0.5, ty + 0.5, bw - 1, bh - 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = KAARO_TOKENS.body; ctx.font = "9px 'IBM Plex Mono',monospace";
    lines.forEach((ln, i) => ctx.fillText(ln, tx + pad, ty + pad + lh * i + 9));
  }

  function findHovered(now, PX_PER_SEC, ring) {
    const canvas = dawCanvas(); if (!canvas) return null;
    const H = canvas.height;
    const layout = computeLaneLayout(H);
    const W = canvas.width;
    for (let i = ring.length - 1; i >= 0; i--) {
      const ev = ring[i];
      const lane = laneForEvent(ev); if (!lane) continue;
      const l = layout.find(x => x.id === lane.id); if (!l) continue;
      const x  = evX(ev, now, W, PX_PER_SEC);
      const bw = lane.blockW(ev);
      const bh = Math.max(2, lane.blockH(ev) * (l.h - 16));
      const by = l.y + l.h - bh - 3;
      if (S.mx >= x - 3 && S.mx <= x + bw + 3 && S.my >= by - 3 && S.my <= by + bh + 3) return ev;
    }
    return null;
  }

  // â”€â”€ Automation canvas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let _autoCtx = null;
  const _autoSamples = [];
  let _lastAutoSampleMs = 0;

  function _sampleAuto() {
    const now = Date.now();
    if (now - _lastAutoSampleMs < 1000) return;
    _lastAutoSampleMs = now;
    const ring  = window._beatRing || [];
    const d10   = ring.filter(e => now - e.ts < 10000).length / 10; // events/sec
    _autoSamples.push({
      ts:       now,
      density:  Math.min(1, d10 / 5),
      pressure: window.COGNITIVE_PRESSURE || 0,
      bpm:      Math.min(1, d10 * 12 / 240),
    });
    if (_autoSamples.length > 600) _autoSamples.shift();
  }

  function drawAuto() {
    requestAnimationFrame(drawAuto);
    _sampleAuto();
    const canvas = autoCanvas(); if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    if (!_autoCtx) _autoCtx = canvas.getContext('2d');
    const ctx = _autoCtx;

    ctx.fillStyle = '#020208'; ctx.fillRect(0, 0, W, H);

    const recent = _autoSamples.filter(s => Date.now() - s.ts < 30000);
    if (recent.length < 2) {
      ctx.fillStyle = '#1a1a30'; ctx.font = "7px 'IBM Plex Mono',monospace";
      ctx.fillText('DENSITY Â· BPM Â· PRESSURE  (waiting for eventsâ€¦)', 6, 12);
      return;
    }

    const drawCurve = (key, color, alpha) => {
      ctx.beginPath();
      recent.forEach((s, i) => {
        const x = (i / (recent.length - 1)) * W;
        const y = H - s[key] * (H - 6) - 3;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill();
      ctx.globalAlpha = 1;
    };

    drawCurve('pressure', '#cc2244', 0.30);
    drawCurve('density',  '#00cc88', 0.25);
    drawCurve('bpm',      '#9aa0c8', 0.18);

    // labels
    const last = recent[recent.length - 1];
    ctx.fillStyle = KAARO_TOKENS.dim; ctx.font = "7px 'IBM Plex Mono',monospace";
    ctx.fillText(
      'DENSITY ' + (last.density * 5).toFixed(1) + '/s  ' +
      'BPM~' + Math.round(last.bpm * 240) + '  ' +
      'PRESS ' + (last.pressure * 100).toFixed(0) + '%',
      6, 11
    );

    // grid line at 50%
    ctx.strokeStyle = '#0c0c24'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  }

  // â”€â”€ Canvas input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function setupCanvasInput() {
    const wrap = document.getElementById('daw-center'); if (!wrap) return;

    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      S.scrollMs = Math.max(0, S.scrollMs + (e.deltaX || e.deltaY) * 90);
      setLive(S.scrollMs === 0);
    }, { passive: false });

    wrap.addEventListener('mousedown', e => {
      S.dragging = true; S.dragOriX = e.clientX; S.dragOriScrollMs = S.scrollMs;
    });
    window.addEventListener('mouseup', () => { S.dragging = false; });
    window.addEventListener('mousemove', e => {
      if (!S.dragging) return;
      const dx = S.dragOriX - e.clientX;
      const canvas = dawCanvas(); if (!canvas) return;
      const W = canvas.width;
      const PX_PER_SEC = W / (S.windowMs / 1000);
      S.scrollMs = Math.max(0, S.dragOriScrollMs + dx / PX_PER_SEC * 1000);
      setLive(S.scrollMs === 0);
    });

    const dawC = dawCanvas();
    if (dawC) {
      dawC.addEventListener('mousemove', e => {
        const rect = dawC.getBoundingClientRect();
        S.mx = e.clientX - rect.left; S.my = e.clientY - rect.top;
      });
      dawC.addEventListener('mouseleave', () => { S.mx = -99; S.my = -99; S.hovered = null; });
      dawC.addEventListener('click', () => {
        if (S.hovered) captureEventForMapping(S.hovered);
      });
    }
  }

  function setLive(v) {
    if (v) { S.isLive = true; S.frozenNow = null; }
    else if (S.isLive) { S.isLive = false; S.frozenNow = Date.now(); }
    const b = document.getElementById('daw-live-btn');
    if (b) {
      b.textContent = S.isLive ? 'â— LIVE' : 'â—€ SCRUB';
      b.className = 'hdr-btn' + (S.isLive ? ' live' : '');
    }
  }

  // â”€â”€ Mixer strips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function buildMixerStrips() {
    const mixer = document.getElementById('mixer'); if (!mixer) return;
    for (const lane of FAMILY_LANES) {
      const col   = FAMILY_LABEL_COLORS[lane.id] || KAARO_TOKENS.accent;
      const strip = document.createElement('div');
      strip.className = 'ch-strip'; strip.dataset.family = lane.id;
      strip.innerHTML = `
        <div class="ch-label" style="color:${col}">${lane.label}</div>
        <div class="ch-fader-wrap">
          <input class="ch-fader" type="range" min="0" max="1" step="0.01" value="1">
          <span class="ch-fader-val">100</span>
        </div>
        <div class="ch-vu-wrap">
          <div class="ch-vu-bar"><div class="ch-vu-fill" style="height:0%"></div></div>
          <div class="ch-vu-bar"><div class="ch-vu-fill" style="height:0%"></div></div>
        </div>
        <div class="ch-btns">
          <button class="ch-btn solo-btn">S</button>
          <button class="ch-btn mute-btn">M</button>
        </div>`;

      const fader  = strip.querySelector('.ch-fader');
      const faderV = strip.querySelector('.ch-fader-val');
      const soloB  = strip.querySelector('.solo-btn');
      const muteB  = strip.querySelector('.mute-btn');

      fader.oninput = () => {
        const v = parseFloat(fader.value);
        S.mixer[lane.id].gain = v;
        faderV.textContent = Math.round(v * 100);
        if (window.MIXER_GAINS) window.MIXER_GAINS[lane.id] = v;
      };
      muteB.onclick = () => toggleMute(lane.id);
      soloB.onclick = () => toggleSolo(lane.id);

      mixer.appendChild(strip);
    }
  }

  function _syncMixerButtons() {
    for (const lane of FAMILY_LANES) {
      const strip = document.querySelector(`.ch-strip[data-family="${lane.id}"]`);
      if (!strip) continue;
      const m = S.mixer[lane.id];
      strip.querySelector('.mute-btn').className = 'ch-btn mute-btn' + (m.muted ? ' mute-on' : '');
      strip.querySelector('.solo-btn').className = 'ch-btn solo-btn' + (m.soloed ? ' solo-on' : '');
    }
  }

  function toggleMute(id) {
    S.mixer[id].muted = !S.mixer[id].muted;
    _applyMixerToSettings();
    _syncMixerButtons();
  }

  function toggleSolo(id) {
    const alreadySoloed = S.mixer[id].soloed;
    // Clear all solos
    for (const lane of FAMILY_LANES) S.mixer[lane.id].soloed = false;
    if (!alreadySoloed) {
      // Solo this one, mute all others
      S.mixer[id].soloed = true;
      for (const lane of FAMILY_LANES) S.mixer[lane.id].muted = lane.id !== id;
    } else {
      // Un-solo: clear all mutes
      for (const lane of FAMILY_LANES) S.mixer[lane.id].muted = false;
    }
    _applyMixerToSettings();
    _syncMixerButtons();
  }

  function _applyMixerToSettings() {
    const muted = FAMILY_LANES.filter(l => S.mixer[l.id].muted).map(l => l.id);
    if (window.updateAudioSettings) window.updateAudioSettings({ filter: { mutedFamilies: muted } });
    if (window.MIXER_GAINS) {
      for (const lane of FAMILY_LANES) window.MIXER_GAINS[lane.id] = S.mixer[lane.id].gain;
    }
  }

  // â”€â”€ Tab panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function wireTabs() {
    document.querySelectorAll('.tab[data-tab]').forEach(t => {
      t.onclick = () => renderTab(t.dataset.tab);
    });
  }

  function renderTab(name) {
    S.activeTab = name;
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name)
    );
    const body = document.getElementById('tab-body'); if (!body) return;
    body.innerHTML = '';
    if (name === 'map')   buildMapTab(body);
    if (name === 'synth') buildSynthTab(body);
    if (name === 'sim')   buildSimTab(body);
    if (name === 'prof')  buildProfTab(body);
  }

  // â”€â”€ MAP tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const MATCH_FAMILIES = ['file', 'system', 'ai', 'context'];
  const MATCH_KEYS = [
    'read', 'write', 'edit', 'grep_glob',
    'bash_git', 'bash_run', 'bash_other',
    'agent', 'other', 'web', 'tokens', 'words', 'chirp',
    'human_turn', 'compact', 'permission', 'mode_shift',
    'attachment', 'scaffold', 'tool_error', 'api_error',
  ];
  const MATCH_HARNESSES = ['claude-code', 'pi', 'antigravity', 'grok', 'opencode', 'copilot'];
  const INST_NAMES = ['harp', 'bass', 'bell', 'flute', 'bit', 'pling', 'snare', 'kick', 'hat', 'buzz', 'off'];
  const DEGREE_MODES = ['path_hash', 'sequential', 'random', 'root'];

  function buildMapTab(body) {
    // Rule list
    const listDiv = document.createElement('div');
    listDiv.id = 'map-list';
    body.appendChild(listDiv);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn primary'; addBtn.style.cssText = 'width:100%;margin:6px 0';
    addBtn.textContent = '+ ADD MAPPING RULE';
    addBtn.onclick = () => showRuleForm(body, null);
    body.appendChild(addBtn);

    const formDiv = document.createElement('div'); formDiv.id = 'rule-form';
    body.appendChild(formDiv);

    renderMappingList(listDiv, body);
  }

  function renderMappingList(listDiv, body) {
    listDiv.innerHTML = '';
    const mappings = (window.AUDIO_PROFILE || {}).mappings || [];
    if (!mappings.length) {
      listDiv.innerHTML = '<div style="color:#334;font-size:9px;padding:6px 0;">No rules yet â€” add one below.</div>';
      return;
    }
    mappings.forEach((rule, idx) => {
      const row = document.createElement('div'); row.className = 'map-row';
      const m = rule.match || {}, eff = rule.set || {};
      const matchSummary = [
        m.family && (Array.isArray(m.family) ? m.family.join('/') : m.family),
        m.key    && (Array.isArray(m.key) ? m.key.join('/') : m.key),
        m.harness && (Array.isArray(m.harness) ? m.harness.join('/') : m.harness),
        m.whereContains && ('~' + m.whereContains),
      ].filter(Boolean).join(' ');
      const effSummary = [
        eff.instrument,
        eff.volMult   != null && 'Ã—' + eff.volMult,
        eff.octave    != null && 'oct' + (eff.octave >= 0 ? '+' : '') + eff.octave,
        eff.pan       != null && 'p' + eff.pan.toFixed(1),
        eff.brightness != null && eff.brightness + 'Hz',
        eff.send      != null && 'rv' + eff.send.toFixed(1),
      ].filter(Boolean).join(' ');

      row.innerHTML = `
        <div class="map-match">${matchSummary || '(any)'}</div>
        <div class="map-effect">${effSummary || 'â€”'}</div>
        <div class="map-acts">
          <button data-act="edit" data-idx="${idx}">âœŽ</button>
          <button data-act="del"  data-idx="${idx}">âœ•</button>
          <button data-act="up"   data-idx="${idx}">â†‘</button>
        </div>`;
      listDiv.appendChild(row);
    });

    listDiv.onclick = e => {
      const btn = e.target.closest('button[data-act]'); if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      const act = btn.dataset.act;
      const prof = window.AUDIO_PROFILE;
      if (act === 'del') {
        prof.mappings.splice(idx, 1);
        window.updateAudioProfile({ mappings: prof.mappings });
        renderMappingList(listDiv, body);
      } else if (act === 'edit') {
        S.editingRuleIdx = idx;
        showRuleForm(body, prof.mappings[idx]);
      } else if (act === 'up' && idx > 0) {
        const tmp = prof.mappings[idx - 1];
        prof.mappings[idx - 1] = prof.mappings[idx]; prof.mappings[idx] = tmp;
        window.updateAudioProfile({ mappings: prof.mappings });
        renderMappingList(listDiv, body);
      }
    };
  }

  function showRuleForm(body, rule) {
    let formDiv = document.getElementById('rule-form');
    if (!formDiv) { formDiv = document.createElement('div'); formDiv.id = 'rule-form'; body.appendChild(formDiv); }
    formDiv.innerHTML = '';
    const r = rule || { match: {}, set: {} };

    const head = document.createElement('div');
    head.className = 'form-head'; head.textContent = S.editingRuleIdx != null ? 'EDIT RULE' : 'NEW RULE';
    formDiv.appendChild(head);

    // Match section
    const mHead = document.createElement('div');
    mHead.style.cssText = 'font-size:8px;color:#334;letter-spacing:1px;margin:6px 0 2px;';
    mHead.textContent = 'MATCH'; formDiv.appendChild(mHead);

    const chips = (id, vals, cur) => {
      const wrap = document.createElement('div'); wrap.className = 'chips-wrap'; wrap.id = id;
      const curSet = new Set(Array.isArray(cur) ? cur : (cur ? [cur] : []));
      vals.forEach(v => {
        const c = document.createElement('span'); c.className = 'chip' + (curSet.has(v) ? ' on' : '');
        c.textContent = v; c.onclick = () => c.classList.toggle('on');
        wrap.appendChild(c);
      });
      return wrap;
    };

    formDiv.appendChild(chips('mf', MATCH_FAMILIES, r.match.family));
    formDiv.appendChild(chips('mk', MATCH_KEYS,     r.match.key));
    formDiv.appendChild(chips('mh', MATCH_HARNESSES, r.match.harness));

    const whereRow = document.createElement('div'); whereRow.className = 'row';
    whereRow.innerHTML = '<label>where ~</label>';
    const whereInp = document.createElement('input'); whereInp.className = 'inp';
    whereInp.placeholder = 'path containsâ€¦'; whereInp.value = r.match.whereContains || '';
    whereRow.appendChild(whereInp); formDiv.appendChild(whereRow);

    const threshRow = document.createElement('div'); threshRow.className = 'row';
    threshRow.innerHTML = '<label>min words/out</label>';
    const wminInp = document.createElement('input'); wminInp.className = 'inp inp-sm inp-wmin';
    wminInp.type = 'number'; wminInp.placeholder = 'wordsâ‰¥'; wminInp.value = r.match.wordMin || '';
    const ominInp = document.createElement('input'); ominInp.className = 'inp inp-sm inp-omin';
    ominInp.type = 'number'; ominInp.placeholder = 'outâ‰¥'; ominInp.value = r.match.outMin || '';
    threshRow.appendChild(wminInp); threshRow.appendChild(ominInp); formDiv.appendChild(threshRow);

    // Set section
    const sHead = document.createElement('div');
    sHead.style.cssText = 'font-size:8px;color:#334;letter-spacing:1px;margin:8px 0 2px;';
    sHead.textContent = 'SET'; formDiv.appendChild(sHead);

    const mkRow = (label, content) => {
      const row = document.createElement('div'); row.className = 'row';
      const lbl = document.createElement('label'); lbl.textContent = label;
      row.appendChild(lbl); row.appendChild(content); return row;
    };

    const instSel = document.createElement('select'); instSel.className = 'inp inst-sel';
    instSel.innerHTML = '<option value="">â€” keep â€”</option>' + INST_NAMES.map(n => `<option value="${n}"${(r.set.instrument===n)?' selected':''}>${n}</option>`).join('');
    formDiv.appendChild(mkRow('instrument', instSel));

    const makeNumInp = (cls, ph, val) => {
      const i = document.createElement('input'); i.className = 'inp inp-sm ' + cls;
      i.type = 'number'; i.placeholder = ph; if (val != null) i.value = val; return i;
    };

    const volInp = makeNumInp('inp-vol', 'vol Ã—', r.set.volMult);
    const octInp = makeNumInp('inp-oct', 'oct Â±', r.set.octave);
    const dvRow  = document.createElement('div'); dvRow.className = 'row';
    dvRow.innerHTML = '<label>vol / oct</label>';
    dvRow.appendChild(volInp); dvRow.appendChild(octInp); formDiv.appendChild(dvRow);

    const degSel = document.createElement('select'); degSel.className = 'inp';
    degSel.innerHTML = '<option value="">â€” degree mode â€”</option>' + DEGREE_MODES.map(d => `<option value="${d}"${r.set.degreeMode===d?' selected':''}>${d}</option>`).join('');
    formDiv.appendChild(mkRow('degree mode', degSel));

    // New spatial axes
    const panInp = makeNumInp('inp-pan', 'pan -1..1', r.set.pan);
    panInp.step = '0.05'; panInp.min = '-1'; panInp.max = '1';
    formDiv.appendChild(mkRow('pan', panInp));

    const sendInp = makeNumInp('inp-send', 'reverb 0..1', r.set.send);
    sendInp.step = '0.05'; sendInp.min = '0'; sendInp.max = '1';
    formDiv.appendChild(mkRow('reverb send', sendInp));

    const briInp = makeNumInp('inp-bri', 'Hz 100-12000', r.set.brightness);
    briInp.step = '100'; briInp.min = '100'; briInp.max = '12000';
    formDiv.appendChild(mkRow('brightness', briInp));

    const btnRow = document.createElement('div'); btnRow.className = 'btn-row'; btnRow.style.marginTop = '8px';
    const saveBtn = document.createElement('button'); saveBtn.className = 'btn primary'; saveBtn.textContent = 'SAVE';
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn'; cancelBtn.textContent = 'CANCEL';
    btnRow.appendChild(saveBtn); btnRow.appendChild(cancelBtn);
    formDiv.appendChild(btnRow);

    const readChips = id => Array.from(formDiv.querySelectorAll(`#${id} .chip.on`)).map(c => c.textContent);

    saveBtn.onclick = () => {
      const match = {};
      const fam = readChips('mf'); if (fam.length) match.family = fam.length === 1 ? fam[0] : fam;
      const key = readChips('mk'); if (key.length) match.key    = key.length === 1 ? key[0] : key;
      const h   = readChips('mh'); if (h.length)   match.harness = h.length === 1 ? h[0] : h;
      const wc  = whereInp.value.trim(); if (wc) match.whereContains = wc;
      const wm  = parseInt(wminInp.value, 10); if (!isNaN(wm)) match.wordMin = wm;
      const om  = parseInt(ominInp.value, 10); if (!isNaN(om)) match.outMin = om;

      const set = {};
      if (instSel.value)                 set.instrument  = instSel.value;
      const vv = parseFloat(volInp.value); if (!isNaN(vv)) set.volMult   = vv;
      const ov = parseInt(octInp.value, 10); if (!isNaN(ov)) set.octave  = ov;
      if (degSel.value)                  set.degreeMode  = degSel.value;
      const pv = parseFloat(panInp.value);  if (!isNaN(pv)) set.pan       = pv;
      const sv = parseFloat(sendInp.value); if (!isNaN(sv)) set.send      = sv;
      const bv = parseFloat(briInp.value);  if (!isNaN(bv)) set.brightness = bv;

      const prof = window.AUDIO_PROFILE; if (!prof.mappings) prof.mappings = [];
      const newRule = { match, set };
      if (S.editingRuleIdx != null) prof.mappings[S.editingRuleIdx] = newRule;
      else prof.mappings.push(newRule);
      S.editingRuleIdx = null;
      window.updateAudioProfile({ mappings: prof.mappings });
      renderTab('map');
    };

    cancelBtn.onclick = () => { S.editingRuleIdx = null; renderTab('map'); };
  }

  function captureEventForMapping(ev) {
    S.editingRuleIdx = null;
    renderTab('map');
    const body = document.getElementById('tab-body'); if (!body) return;
    const prefill = {
      match: {
        key:    ev.key    || undefined,
        family: ev.family || undefined,
        harness:ev.harness|| undefined,
      },
      set: {},
    };
    showRuleForm(body, prefill);
    // Scroll panel to form
    const form = document.getElementById('rule-form');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
  }

  // â”€â”€ SYNTH tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const SYNTH_KEYS = [
    ['read','Read'], ['write','Write'], ['edit','Edit'],
    ['bash_git','Bash (git)'], ['bash_run','Bash (run)'], ['bash_other','Bash (other)'],
    ['grep_glob','Grep/Glob'], ['agent','Agent'], ['other','Other'],
    ['tokens','Tokens'], ['words','Words'],
  ];

  function buildSynthTab(body) {
    const S2 = window.AUDIO_SETTINGS || {};

    body.innerHTML += '<div class="sec-head">Instruments</div>';
    const instTable = document.createElement('div');
    SYNTH_KEYS.forEach(([key, label]) => {
      const row = document.createElement('div'); row.className = 'inst-row';
      const lbl = document.createElement('div'); lbl.className = 'inst-key'; lbl.textContent = label;
      const sel = document.createElement('select'); sel.className = 'inp inst-sel';
      sel.innerHTML = ['harp','bass','bell','flute','bit','pling','snare','kick','hat','off']
        .map(n => `<option value="${n}"${S2.instruments?.[key]===n?' selected':''}>${n}</option>`).join('');
      sel.onchange = () => {
        const patch = { instruments: {} }; patch.instruments[key] = sel.value;
        if (window.updateAudioSettings) window.updateAudioSettings(patch);
      };
      const prev = document.createElement('button'); prev.className = 'btn inst-prev'; prev.textContent = 'â–¶';
      prev.onclick = () => { if (window.previewInstrument) window.previewInstrument(sel.value); };
      row.appendChild(lbl); row.appendChild(sel); row.appendChild(prev);
      instTable.appendChild(row);
    });
    body.appendChild(instTable);

    body.innerHTML += '<div class="sec-head" style="margin-top:10px">Scale Â· Note</div>';

    const scaleRow = document.createElement('div'); scaleRow.className = 'row';
    scaleRow.innerHTML = '<label>scale</label>';
    const scaleSel = document.createElement('select'); scaleSel.className = 'inp';
    const scaleOpts = [
      ['major_pentatonic','Maj Pentatonic'], ['minor_pentatonic','Min Pentatonic'],
      ['blues','Blues'], ['major','Major'], ['dorian','Dorian'],
    ];
    scaleSel.innerHTML = scaleOpts.map(([v,l]) => `<option value="${v}"${S2.scale===v?' selected':''}>${l}</option>`).join('');
    scaleSel.onchange = () => {
      if (window.updateAudioSettings) window.updateAudioSettings({ scale: scaleSel.value });
      const hdrSel = document.getElementById('daw-scale');
      if (hdrSel) hdrSel.value = scaleSel.value;
    };
    scaleRow.appendChild(scaleSel); body.appendChild(scaleRow);

    const noteRow = document.createElement('div'); noteRow.className = 'row';
    noteRow.innerHTML = '<label>note mode</label>';
    const noteSel = document.createElement('select'); noteSel.className = 'inp';
    noteSel.innerHTML = [
      ['path_hash','Path hash'], ['sequential','Sequential'], ['random','Random'], ['root','Root only'],
    ].map(([v,l]) => `<option value="${v}"${S2.noteMode===v?' selected':''}>${l}</option>`).join('');
    noteSel.onchange = () => { if (window.updateAudioSettings) window.updateAudioSettings({ noteMode: noteSel.value }); };
    noteRow.appendChild(noteSel); body.appendChild(noteRow);

    body.innerHTML += '<div class="sec-head" style="margin-top:10px">Metronome</div>';
    const clickRow = document.createElement('div'); clickRow.className = 'row';
    clickRow.innerHTML = '<label>click track</label>';
    const clickBtn = document.createElement('button');
    const clickOn = S2.clickTrack;
    clickBtn.className = 'btn' + (clickOn ? ' on' : ''); clickBtn.textContent = clickOn ? 'ON' : 'OFF';
    clickBtn.onclick = () => {
      const nowOn = !window.AUDIO_SETTINGS.clickTrack;
      clickBtn.textContent = nowOn ? 'ON' : 'OFF';
      clickBtn.className = 'btn' + (nowOn ? ' on' : '');
      if (window.setClickTrack) window.setClickTrack(nowOn, true);
    };
    clickRow.appendChild(clickBtn); body.appendChild(clickRow);
  }

  // â”€â”€ SIM tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function buildSimTab(body) {
    body.innerHTML = `
      <div class="sec-head">Event Simulator</div>
      <div class="row"><label>type</label>
        <select id="sim-type" class="inp">
          <option>tool_call</option><option>tokens</option><option>words</option>
        </select>
      </div>
      <div class="row"><label>harness</label>
        <select id="sim-harness" class="inp">
          <option>claude-code</option><option>pi</option><option>antigravity</option><option>grok</option>
        </select>
      </div>
      <div class="row"><label>project</label><input id="sim-project" class="inp" value="demo"></div>
      <div class="row"><label>tool</label><input id="sim-tool" class="inp" value="Write"></div>
      <div class="row"><label>where</label><input id="sim-where" class="inp" value="src/app.js"></div>
      <div class="row"><label>category</label>
        <select id="sim-cat" class="inp"><option value="">â€”</option><option>git</option><option>npm</option><option>fs</option><option>other</option></select>
      </div>
      <div class="row">
        <label>out / words</label>
        <input id="sim-out"   class="inp inp-sm" type="number" value="180">
        <input id="sim-words" class="inp inp-sm" type="number" value="24">
      </div>
      <div class="row">
        <label>cache_read</label>
        <input id="sim-cache" class="inp inp-sm" type="number" value="0" title="Simulates cache_read tokens (high=dull brightness)">
      </div>
      <button class="btn primary" id="btn-emit" style="width:100%;margin:8px 0">EMIT â–¶ hear + visualize</button>
      <div id="sim-resolved" style="font-size:8px;color:#334;margin-top:4px;"></div>
      <div id="sim-log" style="font-size:8px;color:#445;margin-top:8px;max-height:120px;overflow:auto;"></div>`;

    const $ = id => document.getElementById(id);

    $('btn-emit').onclick = () => {
      const type    = $('sim-type').value;
      const harness = $('sim-harness').value;
      const project = $('sim-project').value || 'demo';
      const tool    = $('sim-tool').value || 'Write';
      const where   = $('sim-where').value;
      const cat     = $('sim-cat').value;
      const output  = parseInt($('sim-out').value, 10)   || 0;
      const words   = parseInt($('sim-words').value, 10) || 0;
      const cache   = parseInt($('sim-cache').value, 10) || 0;

      const data = { project, harness, tool, where, category: cat, output, word_count: words,
                     cache_read: cache, ts: Date.now(), slug: 'sim-' + Math.random().toString(36).slice(2, 8) };

      if (window.playPulse) window.playPulse(type, data);

      // Show resolved sonic axes
      if (window.resolveSonicForEvent) {
        const r = window.resolveSonicForEvent(type, data);
        $('sim-resolved').textContent =
          `â†’ inst:${r.instrument}  pan:${(r.pan||0).toFixed(2)}  bri:${r.brightness}Hz  send:${(r.sendAmt||0).toFixed(2)}  key:${r.key}`;
      }

      // Log
      const logDiv = $('sim-log');
      const line = document.createElement('div');
      line.style.padding = '1px 0'; line.style.borderBottom = '1px dotted '+KAARO_TOKENS.border+'';
      line.textContent = new Date().toLocaleTimeString() + '  ' + type + '  ' + tool + '  ' + project;
      logDiv.appendChild(line);
      while (logDiv.children.length > 30) logDiv.removeChild(logDiv.firstChild);
      logDiv.scrollTop = logDiv.scrollHeight;
    };
  }

  // â”€â”€ Built-in presets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Three opinionated presets. Every event key is mapped; all 5 sonic axes covered.
  //
  // Design principles encoded:
  //   Cognitive Flow  â€” timbre=category, velocity=importance, path-hash=file identity
  //   Thrash Detector â€” sequential notes build phrase density; dorian tension; threshold rules
  //   Session Arc     â€” multi-scale: tools=micro, token-bursts=mid chord, words=macro melody

  const DAW_PRESETS = [
    {
      name: 'Cognitive Flow',
      tag:  'Pre-attentive Â· Identity Â· Sustainable',
      desc: 'Timbre maps category. Velocity maps importance. Path-hash pitch gives every file a consistent identity note within a project. Major pentatonic â€” consonant and sustainable for long monitoring sessions.',
      settings: {
        scale: 'major_pentatonic', noteMode: 'path_hash', bpm: 100,
        instruments: {
          read:'harp', write:'bass', edit:'pling',
          bash_git:'snare', bash_run:'kick', bash_other:'hat',
          grep_glob:'bit', agent:'bell', other:'harp',
          tokens:'flute', words:'bell',
        },
      },
      mappings: [
        // FILE â€” left channel, clear identity distinction by volume
        { match: { key:'write'      }, set: { volMult:1.30, pan:-0.20, send:0.04, brightness:10000 } },
        { match: { key:'edit'       }, set: { volMult:1.00, pan:-0.12, send:0.04, brightness: 8500 } },
        { match: { key:'read'       }, set: { volMult:0.65, pan: 0.05, send:0.05, brightness: 6500 } },
        { match: { key:'grep_glob'  }, set: { volMult:0.55, pan: 0.10, send:0.03, brightness: 5000 } },
        // SYSTEM â€” far left, percussive time anchor
        { match: { key:'bash_git'   }, set: { volMult:1.10, pan:-0.38, send:0.03, brightness: 3500 } },
        { match: { key:'bash_run'   }, set: { volMult:1.00, pan:-0.32, send:0.03, brightness: 2800 } },
        { match: { key:'bash_other' }, set: { volMult:0.55, pan:-0.30, send:0.02, brightness: 4000 } },
        // AI â€” right + reverb = spatial weight/distance
        { match: { key:'agent'      }, set: { volMult:1.20, octave: 1, pan: 0.40, send:0.45, brightness: 5000 } },
        { match: { key:'other'      }, set: { volMult:0.60, pan: 0.00, send:0.06, brightness: 6500 } },
        // CONTEXT â€” ambient background
        { match: { key:'tokens'     }, set: { volMult:0.50, pan: 0.00, send:0.02, octave:-1 } },
        { match: { key:'words'      }, set: { volMult:0.90, pan: 0.22, send:0.14, brightness: 9000, octave: 1 } },
      ],
    },

    {
      name: 'Thrash Detector',
      tag:  'Flow Â· Tension Â· Anomaly',
      desc: 'Sequential notes build phrase density â€” steady rhythm = "in flow", dense rapid notes = "thrashing". Dorian scale has inherent tension. Large token bursts (>600) and long words (>40) get boosted dynamics for anomaly salience.',
      settings: {
        scale: 'dorian', noteMode: 'sequential', bpm: 120,
        instruments: {
          read:'harp', write:'bass', edit:'pling',
          bash_git:'snare', bash_run:'kick', bash_other:'hat',
          grep_glob:'bit', agent:'bell', other:'bit',
          tokens:'flute', words:'bell',
        },
      },
      mappings: [
        // FILE â€” writes grounded an octave down (heavy labour feel)
        { match: { key:'write'      }, set: { volMult:1.40, pan:-0.25, send:0.05, brightness: 9000, octave:-1 } },
        { match: { key:'edit'       }, set: { volMult:1.10, pan:-0.15, send:0.05, brightness: 8000          } },
        { match: { key:'read'       }, set: { volMult:0.55, pan: 0.00, send:0.04, brightness: 6000          } },
        { match: { key:'grep_glob'  }, set: { volMult:0.65, pan: 0.12, send:0.03, brightness: 4500          } },
        // SYSTEM â€” rhythmic pulse; bash_run drops an octave for weight
        { match: { key:'bash_git'   }, set: { volMult:1.20, pan:-0.40, send:0.02, brightness: 3000          } },
        { match: { key:'bash_run'   }, set: { volMult:1.15, pan:-0.35, send:0.02, brightness: 2500, octave:-1 } },
        { match: { key:'bash_other' }, set: { volMult:0.60, pan:-0.28, send:0.02, brightness: 3500          } },
        // AI â€” high structural tension: upper octave + heavy reverb
        { match: { key:'agent'      }, set: { volMult:1.35, pan: 0.45, send:0.55, brightness: 4000, octave: 1 } },
        { match: { key:'other'      }, set: { volMult:0.70, pan: 0.05, send:0.08, brightness: 5500          } },
        // CONTEXT â€” threshold rules: big burst = anomaly spike; small = whisper
        { match: { key:'tokens', outMin:600 }, set: { volMult:0.90, pan: 0.05, send:0.05, octave:-1, brightness: 6000 } },
        { match: { key:'tokens'     }, set: { volMult:0.40, pan: 0.00, send:0.02, octave:-1, brightness: 4500 } },
        // Long assistant turns = release/cadence
        { match: { key:'words', wordMin:40 }, set: { volMult:1.10, pan: 0.28, send:0.20, brightness:10000, octave: 1 } },
        { match: { key:'words'      }, set: { volMult:0.75, pan: 0.20, send:0.12, brightness: 8000, octave: 1 } },
      ],
    },

    {
      name: 'Session Arc',
      tag:  'Multi-scale Â· Arc Â· Layers',
      desc: 'Three independent time-scale layers: individual tool calls = rhythmic micro-texture (oct 0), token bursts = harmonic foundation (bass, oct âˆ’2, root-only), assistant words = structural melody (bell, oct +1/+2). Blues scale. Path-hash keeps file identity across layers.',
      settings: {
        scale: 'blues', noteMode: 'path_hash', bpm: 90,
        instruments: {
          read:'harp', write:'bass', edit:'pling',
          bash_git:'snare', bash_run:'kick', bash_other:'hat',
          grep_glob:'bit', agent:'bell', other:'harp',
          tokens:'bass', words:'bell',
        },
      },
      mappings: [
        // MICRO LAYER â€” file tools, restrained volume, textural
        { match: { key:'write'      }, set: { volMult:1.00, pan:-0.18, send:0.04, brightness: 9500 } },
        { match: { key:'edit'       }, set: { volMult:0.85, pan:-0.10, send:0.04, brightness: 8000 } },
        { match: { key:'read'       }, set: { volMult:0.55, pan: 0.05, send:0.04, brightness: 6000 } },
        { match: { key:'grep_glob'  }, set: { volMult:0.50, pan: 0.10, send:0.03, brightness: 4500 } },
        { match: { key:'bash_git'   }, set: { volMult:0.95, pan:-0.38, send:0.03, brightness: 3500 } },
        { match: { key:'bash_run'   }, set: { volMult:0.90, pan:-0.32, send:0.03, brightness: 2800 } },
        { match: { key:'bash_other' }, set: { volMult:0.45, pan:-0.28, send:0.02, brightness: 3800 } },
        // AI â€” harmonic colour accent (right, reverb, root-fixed for consistency)
        { match: { key:'agent'      }, set: { volMult:1.10, pan: 0.42, send:0.50, brightness: 4500, octave: 1, degreeMode:'root' } },
        { match: { key:'other'      }, set: { volMult:0.55, pan: 0.08, send:0.06, brightness: 5500 } },
        // MID LAYER â€” tokens = bass chord, 2 octaves down, root-locked â†’ harmonic foundation
        { match: { key:'tokens'     }, set: { instrument:'bass', volMult:0.70, pan: 0.00, send:0.05, octave:-2, degreeMode:'root', brightness: 4000 } },
        // MACRO LAYER â€” words = structural melody; long replies rise to +2 oct for climax
        { match: { key:'words', wordMin:50 }, set: { volMult:1.20, pan: 0.30, send:0.22, brightness:11000, octave: 2 } },
        { match: { key:'words'      }, set: { volMult:0.90, pan: 0.25, send:0.16, brightness: 9500, octave: 1 } },
      ],
    },
  ];

  function applyPreset(preset) {
    if (window.updateAudioSettings) window.updateAudioSettings(preset.settings);
    if (window.updateAudioProfile)  window.updateAudioProfile({ mappings: preset.mappings });
    // Sync header BPM display
    const bpmSlider = document.getElementById('daw-bpm');
    const bpmVal    = document.getElementById('daw-bpm-val');
    const scaleSel  = document.getElementById('daw-scale');
    if (bpmSlider && preset.settings.bpm) bpmSlider.value = preset.settings.bpm;
    if (bpmVal    && preset.settings.bpm) bpmVal.textContent = preset.settings.bpm;
    if (scaleSel  && preset.settings.scale) scaleSel.value = preset.settings.scale;
  }

  // â”€â”€ PROF tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const PROF_KEY = 'kaaro-daw-profiles';

  function _loadProfiles() { try { return JSON.parse(localStorage.getItem(PROF_KEY) || '{}'); } catch { return {}; } }
  function _saveProfiles(p) { try { localStorage.setItem(PROF_KEY, JSON.stringify(p)); } catch {} }

  function buildProfTab(body) {
    // â”€â”€ Built-in presets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const presHead = document.createElement('div');
    presHead.className = 'sec-head'; presHead.textContent = 'Built-in Presets';
    body.appendChild(presHead);

    DAW_PRESETS.forEach(preset => {
      const card = document.createElement('div'); card.className = 'preset-card';
      const nameEl = document.createElement('div'); nameEl.className = 'preset-name'; nameEl.textContent = preset.name;
      const tagEl  = document.createElement('div'); tagEl.className  = 'preset-tag';  tagEl.textContent  = preset.tag;
      const descEl = document.createElement('div'); descEl.className = 'preset-desc'; descEl.textContent = preset.desc;
      const footEl = document.createElement('div'); footEl.className = 'preset-foot';

      // Rule count summary
      const ruleCount = preset.mappings.length;
      const ruleSummary = document.createElement('span');
      ruleSummary.className = 'preset-rules';
      ruleSummary.textContent = ruleCount + ' mapping rules Â· ' + preset.settings.scale.replace('_', ' ') + ' Â· ' + preset.settings.noteMode.replace('_', ' ');

      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn primary preset-apply'; applyBtn.textContent = 'Apply';
      applyBtn.onclick = () => {
        applyPreset(preset);
        applyBtn.textContent = 'Applied âœ“';
        applyBtn.classList.add('applied');
        setTimeout(() => {
          applyBtn.textContent = 'Apply';
          applyBtn.classList.remove('applied');
        }, 2000);
      };

      footEl.appendChild(ruleSummary); footEl.appendChild(applyBtn);
      card.appendChild(nameEl); card.appendChild(tagEl); card.appendChild(descEl); card.appendChild(footEl);
      body.appendChild(card);
    });

    // â”€â”€ Saved profiles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const profHead = document.createElement('div');
    profHead.className = 'sec-head'; profHead.style.marginTop = '12px'; profHead.textContent = 'Saved Profiles';
    body.appendChild(profHead);

    const listDiv = document.createElement('div'); listDiv.id = 'prof-list';
    _renderProfList(listDiv); body.appendChild(listDiv);

    const saveHead = document.createElement('div');
    saveHead.className = 'sec-head'; saveHead.style.marginTop = '10px'; saveHead.textContent = 'Save';
    body.appendChild(saveHead);

    const saveRow = document.createElement('div'); saveRow.style.display = 'flex'; saveRow.style.gap = '4px';
    const nameInp = document.createElement('input'); nameInp.className = 'inp'; nameInp.placeholder = 'profile name';
    const saveBtn = document.createElement('button'); saveBtn.className = 'btn primary'; saveBtn.textContent = 'SAVE';
    saveBtn.onclick = () => {
      const nm = (nameInp.value || 'untitled').trim();
      const profs = _loadProfiles();
      profs[nm] = {
        settings: JSON.parse(JSON.stringify(window.AUDIO_SETTINGS || {})),
        profile:  JSON.parse(JSON.stringify(window.AUDIO_PROFILE  || {})),
        savedAt:  new Date().toISOString(),
      };
      _saveProfiles(profs); nameInp.value = '';
      _renderProfList(listDiv);
    };
    saveRow.appendChild(nameInp); saveRow.appendChild(saveBtn); body.appendChild(saveRow);

    const ioHead = document.createElement('div');
    ioHead.className = 'sec-head'; ioHead.style.marginTop = '10px'; ioHead.textContent = 'Export / Import';
    body.appendChild(ioHead);

    const ioRow = document.createElement('div'); ioRow.className = 'btn-row';
    const expBtn = document.createElement('button'); expBtn.className = 'btn'; expBtn.textContent = 'EXPORT JSON';
    expBtn.onclick = () => {
      const blob = new Blob([JSON.stringify({
        settings: window.AUDIO_SETTINGS, profile: window.AUDIO_PROFILE,
      }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'kaaro-audio-profile.json'; a.click();
    };
    const impBtn = document.createElement('button'); impBtn.className = 'btn'; impBtn.textContent = 'IMPORT JSON';
    impBtn.onclick = () => {
      const txt = prompt('Paste JSON profile:'); if (!txt) return;
      try {
        const j = JSON.parse(txt);
        if (j.settings && window.updateAudioSettings) window.updateAudioSettings(j.settings);
        if (j.profile  && window.updateAudioProfile)  window.updateAudioProfile(j.profile);
        renderTab('prof');
      } catch (e) { alert('Parse error: ' + e.message); }
    };
    ioRow.appendChild(expBtn); ioRow.appendChild(impBtn); body.appendChild(ioRow);
  }

  function _renderProfList(listDiv) {
    listDiv.innerHTML = '';
    const profs = _loadProfiles();
    const names = Object.keys(profs);
    if (!names.length) {
      listDiv.innerHTML = '<div style="color:#334;font-size:9px;padding:4px 0">No saved profiles yet.</div>';
      return;
    }
    names.forEach(nm => {
      const row = document.createElement('div'); row.style.display = 'flex'; row.style.gap = '4px'; row.style.marginBottom = '3px';
      const loadBtn = document.createElement('button'); loadBtn.className = 'btn prof-btn'; loadBtn.style.flex = '1';
      loadBtn.textContent = nm;
      loadBtn.onclick = () => {
        const p = profs[nm];
        if (p.settings && window.updateAudioSettings) window.updateAudioSettings(p.settings);
        if (p.profile  && window.updateAudioProfile)  window.updateAudioProfile(p.profile);
        renderTab('synth');
      };
      const delBtn = document.createElement('button'); delBtn.className = 'btn danger'; delBtn.textContent = 'âœ•';
      delBtn.onclick = () => { delete profs[nm]; _saveProfiles(profs); _renderProfList(listDiv); };
      row.appendChild(loadBtn); row.appendChild(delBtn); listDiv.appendChild(row);
    });
  }

  // â”€â”€ Header controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let _tapTimes = [];

  function wireHeaderControls() {
    const bpmSlider = document.getElementById('daw-bpm');
    const bpmVal    = document.getElementById('daw-bpm-val');
    const tapBtn    = document.getElementById('daw-tap');
    const scaleSel  = document.getElementById('daw-scale');
    const windowSel = document.getElementById('daw-window');
    const liveBtn   = document.getElementById('daw-live-btn');
    const clearBtn  = document.getElementById('daw-clear');
    const muteBtn   = document.getElementById('btn-mute');

    if (bpmSlider) {
      const cur = (window.AUDIO_SETTINGS?.bpm || 120);
      bpmSlider.value = cur; if (bpmVal) bpmVal.textContent = cur;
      bpmSlider.oninput = () => {
        const v = parseInt(bpmSlider.value, 10);
        if (bpmVal) bpmVal.textContent = v;
        if (window.updateAudioSettings) window.updateAudioSettings({ bpm: v });
      };
    }

    if (tapBtn) {
      tapBtn.onclick = () => {
        const now = Date.now();
        _tapTimes = _tapTimes.filter(t => now - t < 3000).concat(now);
        if (_tapTimes.length >= 2) {
          const diffs = _tapTimes.slice(1).map((t, i) => t - _tapTimes[i]);
          const avg   = diffs.reduce((a, b) => a + b, 0) / diffs.length;
          const bpm   = Math.max(40, Math.min(240, Math.round(60000 / avg)));
          if (bpmSlider) bpmSlider.value = bpm;
          if (bpmVal) bpmVal.textContent = bpm;
          if (window.updateAudioSettings) window.updateAudioSettings({ bpm });
        }
      };
    }

    if (scaleSel) {
      const cur = window.AUDIO_SETTINGS?.scale || 'major_pentatonic';
      scaleSel.value = cur;
      scaleSel.onchange = () => { if (window.updateAudioSettings) window.updateAudioSettings({ scale: scaleSel.value }); };
    }

    if (windowSel) {
      windowSel.value = String(S.windowMs);
      windowSel.onchange = () => { S.windowMs = parseInt(windowSel.value, 10); };
    }

    if (liveBtn) liveBtn.onclick = () => { S.scrollMs = 0; setLive(true); };
    if (clearBtn) clearBtn.onclick = () => { if (window._beatRing) window._beatRing.length = 0; };

    if (muteBtn) {
      const syncMuteBtn = () => {
        const isMuted = window._getAudioMuted ? window._getAudioMuted() : true;
        muteBtn.textContent = isMuted ? 'â™ª OFF' : 'â™ª ON';
        muteBtn.className = 'hdr-btn' + (isMuted ? '' : ' on');
      };
      syncMuteBtn();
      muteBtn.onclick = () => {
        if (window._setAudioMuted) {
          const isMuted = window._getAudioMuted ? window._getAudioMuted() : true;
          window._setAudioMuted(!isMuted);
          setTimeout(syncMuteBtn, 20);
        }
      };
    }
  }

  // â”€â”€ Live SSE connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function connectLive() {
    const statusEl = document.getElementById('daw-status');
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      if (statusEl) statusEl.textContent = 'OFFLINE â€” use SIM tab';
      return;
    }
    try {
      const es = new EventSource('/events');
      es.addEventListener('tool_call', e => { try { if (window.playPulse) window.playPulse('tool_call', JSON.parse(e.data)); } catch {} });
      es.addEventListener('tokens',    e => { try { if (window.playPulse) window.playPulse('tokens',    JSON.parse(e.data)); } catch {} });
      es.addEventListener('words',     e => { try { if (window.playPulse) window.playPulse('words',     JSON.parse(e.data)); } catch {} });
      es.onopen  = () => { if (statusEl) statusEl.textContent = 'LIVE /events'; };
      es.onerror = () => { if (statusEl) statusEl.textContent = 'reconnectingâ€¦'; };
    } catch { if (statusEl) statusEl.textContent = 'SSE failed â€” use SIM'; }
  }

  // â”€â”€ Keyboard shortcuts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function wireKeys() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape')          { S.scrollMs = 0; setLive(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') document.getElementById('btn-emit')?.click();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        if (S.hovered?.family) toggleMute(S.hovered.family);
      }
      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && S.hovered?.family) {
        toggleSolo(S.hovered.family);
      }
    });
  }

  // â”€â”€ Seed default mappings if empty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function seedDefaultMappings() {
    const prof = window.AUDIO_PROFILE || {};
    if (prof.mappings && prof.mappings.length > 0) return;
    prof.mappings = [
      { match: { key: 'write' },  set: { instrument: 'bass',  volMult: 1.15 } },
      { match: { key: 'agent' },  set: { instrument: 'bell',  octave: 1, send: 0.4 } },
      { match: { type: 'tokens'}, set: { volMult: 0.7, octave: -1 } },
    ];
    if (window.updateAudioProfile) window.updateAudioProfile({ mappings: prof.mappings });
  }

  // â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Session legend + context pressure (footer): who is playing, and how full
  // each session's context window is (latest tokens pulse, via shared core).
  function renderSessionLegend() {
    const el = document.getElementById('daw-sessions');
    if (!el) return;
    const legend = sessionLegend(window._beatRing || [], 5);
    if (!legend.length) { el.innerHTML = '<span style="color:var(--k-dim)">no sessions yet</span>'; return; }
    el.innerHTML = legend.map(s => {
      const pct = s.pressure != null ? Math.round(s.pressure * 100) : null;
      const barW = 36;
      const fill = pct != null ? Math.round(barW * s.pressure) : 0;
      const warn = pct != null && pct >= 75;
      return '<span style="display:inline-flex;align-items:center;gap:4px">' +
        '<span style="width:7px;height:7px;background:' + (s.color || 'var(--k-dim)') + ';display:inline-block"></span>' +
        '<span style="color:var(--k-body)">' + esc(s.slug) + '</span>' +
        (s.project ? '<span style="color:var(--k-dim)">' + esc(s.project) + '</span>' : '') +
        (pct != null
          ? '<span title="context pressure: ' + pct + '% of window" style="width:' + barW + 'px;height:5px;border:1px solid var(--k-border);display:inline-block;position:relative">' +
            '<span style="position:absolute;left:0;top:0;bottom:0;width:' + fill + 'px;background:' + (warn ? 'var(--k-err)' : 'var(--k-select)') + '"></span></span>' +
            '<span style="color:' + (warn ? 'var(--k-err)' : 'var(--k-dim)') + '">' + pct + '%</span>'
          : '') +
        '</span>';
    }).join('');
  }

  function boot() {
    setInterval(renderSessionLegend, 1000);
    resizeBothCanvases();
    window.addEventListener('resize', () => { resizeBothCanvases(); _dawCtx = null; _autoCtx = null; });

    buildMixerStrips();
    setupCanvasInput();
    wireHeaderControls();
    wireTabs();
    wireKeys();
    renderTab('map');
    connectLive();
    seedDefaultMappings();

    // Expose for console power users
    window.MIXER_STATE   = S.mixer;
    window.emitPulse     = (type, data) => { if (window.playPulse) window.playPulse(type, data || {}); };
    window.captureHovered = () => { if (S.hovered) captureEventForMapping(S.hovered); };

    requestAnimationFrame(drawDaw);
    requestAnimationFrame(drawAuto);

    console.log('%c[kaaro-daw] Cognitive DAW v2 ready â€” 4 family lanes Â· reverb Â· stereo Â· pressure automation', 'color:'+KAARO_TOKENS.accent);
  }

  boot();
})();
