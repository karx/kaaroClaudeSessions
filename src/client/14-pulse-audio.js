// ── Pulse audio — Minecraft note block synthesis via Web Audio API ─────────────
//
// Three musical dimensions (Minecraft-inspired):
//   Instrument — what kind of work  (configurable per event type / family)
//   Note       — which file/path    (degree in active scale, mode-selectable)
//   Scale      — which project      (root note from project color index)
//
// Notes are BPM-quantized: each note lands on the next beat slot.
// A burst of tool_calls fills beats 1-2-3-4, then the bar rolls over.
// Settings live in window.AUDIO_SETTINGS and persist to localStorage.

(function() {

  // ── Scales ───────────────────────────────────────────────────────────────────
  const SCALES = {
    major_pentatonic: [0, 2, 4, 7, 9],
    minor_pentatonic: [0, 3, 5, 7, 10],
    blues:            [0, 3, 5, 6, 7, 10],
    major:            [0, 2, 4, 5, 7, 9, 11],
    dorian:           [0, 2, 3, 5, 7, 9, 10],
  };

  // ── Instrument families (tool groupings) ─────────────────────────────────────
  window.AUDIO_FAMILIES = [
    { id:'file',    label:'File Ops', color:'#2a6a2a', tools:['read','write','edit'] },
    { id:'system',  label:'System',   color:'#2a3a7a', tools:['bash_git','bash_run','bash_other','grep_glob'] },
    { id:'ai',      label:'AI',       color:'#6a2a7a', tools:['agent','other'] },
    { id:'context', label:'Context',  color:'#2a5a6a', tools:['tokens','words'] },
  ];

  const TOOL_FAMILY = {};
  for (const f of window.AUDIO_FAMILIES)
    for (const t of f.tools) TOOL_FAMILY[t] = f.id;

  // ── Default settings ─────────────────────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    instruments: {
      read:'harp', write:'bass', edit:'pling',
      bash_git:'snare', bash_run:'hat', bash_other:'kick',
      grep_glob:'bit', agent:'bell', other:'harp',
      tokens:'flute', words:'bell',
    },
    scale:       'major_pentatonic',
    noteMode:    'path_hash',
    bpm:         120,
    beatsPerBar: 4,
    clickTrack:  false,
    clickVol:    0.15,
    filter: { mutedFamilies:[], mutedProjects:[] },
  };

  function _load() {
    try {
      const raw = localStorage.getItem('kaaro-audio-settings');
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      const s = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS, ...s,
        instruments: { ...DEFAULT_SETTINGS.instruments, ...(s.instruments||{}) },
        filter:      { ...DEFAULT_SETTINGS.filter,      ...(s.filter||{}) },
      };
    } catch { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
  }

  window.AUDIO_SETTINGS = _load();
  window.AUDIO_SCALES   = SCALES;
  window.AUDIO_DEFAULTS = DEFAULT_SETTINGS;

  window.updateAudioSettings = function(patch) {
    if (patch.instruments) Object.assign(window.AUDIO_SETTINGS.instruments, patch.instruments);
    if (patch.filter)      Object.assign(window.AUDIO_SETTINGS.filter, patch.filter);
    const rest = Object.fromEntries(
      Object.entries(patch).filter(([k]) => k !== 'instruments' && k !== 'filter')
    );
    Object.assign(window.AUDIO_SETTINGS, rest);
    try { localStorage.setItem('kaaro-audio-settings', JSON.stringify(window.AUDIO_SETTINGS)); } catch {}
  };

  // ── AudioContext ──────────────────────────────────────────────────────────────
  let _ac   = null;
  let muted = true;

  function ac() {
    if (!_ac) {
      try { _ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    }
    if (_ac.state === 'suspended') _ac.resume().catch(() => {});
    return _ac;
  }

  // ── Musical system ────────────────────────────────────────────────────────────
  const ROOTS = [60,62,64,65,67,69,71,72,74,76,77,79]; // C4…B4

  function midiToHz(m)   { return 440 * Math.pow(2, (m - 69) / 12); }
  function activeIv()    { return SCALES[window.AUDIO_SETTINGS.scale] || SCALES.major_pentatonic; }

  function projectRoot(project) {
    const n = GRAPH.nodes.find(n => n.type === 'project' && n.label === project);
    return n ? ROOTS[(COLOR_TO_INDEX[n.color] ?? 0) % ROOTS.length] : ROOTS[0];
  }

  function noteHz(project, degree, octaveShift) {
    const iv  = activeIv();
    const idx = ((degree % iv.length) + iv.length) % iv.length;
    return midiToHz(projectRoot(project) + iv[idx] + (octaveShift || 0) * 12);
  }

  function strHash(s) {
    if (!s) return 0;
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    return h;
  }

  let _seqIdx = 0;
  function getDegree(where) {
    const iv = activeIv(), mode = window.AUDIO_SETTINGS.noteMode;
    if (mode === 'root')       return 0;
    if (mode === 'random')     return Math.floor(Math.random() * iv.length);
    if (mode === 'sequential') { _seqIdx = (_seqIdx + 1) % iv.length; return _seqIdx; }
    return where ? strHash(where) % iv.length : 0; // path_hash
  }

  // ── Beat-quantized note scheduler with batch coalescing ───────────────────────
  // Events arriving within BATCH_MS of each other are collected and played at one
  // shared beat onset (with 5ms stagger for audible texture). The beat clock then
  // advances by ONE beat for the whole batch — so a burst of 10 tool calls from a
  // single assistant turn sounds like a chord cluster, not a 10-beat sequence.
  let _beatAt   = 0;
  let _barBeat  = 0;
  let _batchBuf = [];
  let _batchTimer = null;
  const BATCH_MS  = 80;

  function _flushBatch() {
    _batchTimer = null;
    if (_batchBuf.length === 0) return;
    const buf = _batchBuf.splice(0);
    const c   = ac(); if (!c) return;
    const S   = window.AUDIO_SETTINGS;
    const bd  = 60 / (S.bpm || 120);
    const now = c.currentTime;
    if (_beatAt < now + 0.02) { _beatAt = now + 0.02; _barBeat = 0; }
    const at = _beatAt;
    _barBeat = (_barBeat + 1) % (S.beatsPerBar || 4);
    _beatAt += bd;
    // Tiny stagger so each voice is audible; cap total cluster width at 40ms
    const stagger = Math.min(0.005, 0.04 / Math.max(1, buf.length - 1));
    buf.forEach((fn, i) => fn(c, at + i * stagger));
  }

  function sched(fn) {
    if (!ac()) return;
    _batchBuf.push(fn);
    if (!_batchTimer) _batchTimer = setTimeout(_flushBatch, BATCH_MS);
  }

  // ── Click track (Web Audio lookahead metronome) ───────────────────────────────
  let _clickAt    = 0;
  let _clickBeat  = 0;
  let _clickTimer = null;

  function tick(c, at, isDown) {
    const vol = (window.AUDIO_SETTINGS.clickVol || 0.15) * (isDown ? 1 : 0.5);
    const o   = c.createOscillator(); o.type = 'triangle'; o.frequency.value = isDown ? 880 : 660;
    const g   = c.createGain();
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.03);
  }

  function _schedClicks() {
    const c = ac(); if (!c) return;
    const S   = window.AUDIO_SETTINGS;
    const bd  = 60 / (S.bpm || 120);
    const bpb = S.beatsPerBar || 4;
    const now = c.currentTime;
    if (_clickAt < now) { _clickAt = now + 0.02; _clickBeat = 0; }
    while (_clickAt < now + 0.12) {
      tick(c, _clickAt, _clickBeat % bpb === 0);
      _clickBeat++;
      _clickAt += bd;
    }
  }

  function _startClick() {
    if (_clickTimer) return;
    const c = ac(); if (!c) return;
    _clickAt = c.currentTime + 0.05; _clickBeat = 0;
    _clickTimer = setInterval(_schedClicks, 25);
  }

  function _stopClick() { clearInterval(_clickTimer); _clickTimer = null; }

  // Called from settings panel to start/stop click track respecting mute state.
  // Also called on BPM change to restart the click clock at the new tempo.
  window.setClickTrack = function(on, forceRestart) {
    window.updateAudioSettings({ clickTrack: on });
    if (forceRestart && _clickTimer) { _stopClick(); }
    if (!muted && on) _startClick();
    else if (!on)     _stopClick();
  };

  // ── Filter ────────────────────────────────────────────────────────────────────
  function passesFilter(toolKey, project) {
    const f = window.AUDIO_SETTINGS.filter || {};
    if (f.mutedFamilies?.length && f.mutedFamilies.includes(TOOL_FAMILY[toolKey])) return false;
    if (f.mutedProjects?.length && f.mutedProjects.includes(project)) return false;
    return true;
  }

  // ── Instrument synthesizers ───────────────────────────────────────────────────

  function harp(c, at, hz, vol) {
    vol = vol ?? 0.42;
    const m = c.createGain();
    m.gain.setValueAtTime(vol, at); m.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
    m.connect(c.destination);
    [[1,'triangle',0.72],[2,'sine',0.28]].forEach(([mult,type,w]) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = hz * mult;
      const g = c.createGain(); g.gain.value = w;
      o.connect(g); g.connect(m); o.start(at); o.stop(at + 0.9);
    });
  }

  function bass(c, at, hz, vol) {
    vol = vol ?? 0.48;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz / 2;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 1.4);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 1.4);
  }

  function bell(c, at, hz, vol) {
    vol = vol ?? 0.32;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz * 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, at + 2.5);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 2.5);
  }

  function flute(c, at, hz, vol) {
    vol = vol ?? 0.18;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.07);
    g.gain.setValueAtTime(vol, at + 0.2); g.gain.exponentialRampToValueAtTime(0.001, at + 0.65);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.65);
  }

  function bit(c, at, hz, vol) {
    vol = vol ?? 0.14;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = hz;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.22);
  }

  function pling(c, at, hz, vol) {
    vol = vol ?? 0.30;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.48);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.48);
  }

  function snare(c, at, vol) {
    vol = vol ?? 0.32;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.12), c.sampleRate);
    const d   = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(at); src.stop(at + 0.12);
  }

  function kick(c, at, vol) {
    vol = vol ?? 0.46;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, at); o.frequency.exponentialRampToValueAtTime(40, at + 0.15);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + 0.25);
  }

  function hat(c, at, vol) {
    vol = vol ?? 0.18;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.04), c.sampleRate);
    const d   = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(at); src.stop(at + 0.04);
  }

  const INSTS = { harp, bass, bell, flute, bit, pling, snare, kick, hat };
  const PERC  = new Set(['snare','kick','hat']);

  window.previewInstrument = function(name) {
    const fn = INSTS[name]; if (!fn) return;
    const c  = ac(); if (!c) return;
    const at = c.currentTime + 0.05;
    PERC.has(name) ? fn(c, at) : fn(c, at, midiToHz(64)); // E4
  };

  function bashKey(cat) {
    if (cat === 'git')                                      return 'bash_git';
    if (cat==='npm'||cat==='npx'||cat==='node'||cat==='python') return 'bash_run';
    return 'bash_other';
  }

  // ── Beat ring buffer (shared with overlay — mutate in place so reference stays valid) ──
  const _beatRing    = [];
  const BEAT_RING_MAX = 1000;
  window._beatRing   = _beatRing;

  function _pushToBeatRing(ev) {
    _beatRing.push(ev);
    if (_beatRing.length > BEAT_RING_MAX) _beatRing.shift();
  }

  // ── Main pulse dispatcher ─────────────────────────────────────────────────────
  window.playPulse = function(event, data) {
    // Push to beat ring for the DAW widget — always, even when muted
    try {
      if (event === 'tool_call' || event === 'words' || event === 'tokens') {
        const projNode = (typeof GRAPH !== 'undefined')
          ? GRAPH.nodes.find(n => n.type === 'project' && n.label === data.project)
          : null;
        _pushToBeatRing({
          ts:       Date.now(),
          color:    projNode?.color || '#334466',
          label:    event === 'tool_call' ? (data.tool || 'tool') : event,
          type:     event,
          slug:     data.slug     || null,
          project:  data.project  || null,
          tool:     data.tool     || null,
          where:    data.where    || null,
          category: data.category || null,
          preview:  data.preview  || null,
        });
      }
    } catch {}

    if (muted) return;
    try {
      const S = window.AUDIO_SETTINGS;
      if (event === 'tool_call') {
        const tool = (data.tool || '').toLowerCase();
        let key;
        if      (tool==='read')                          key = 'read';
        else if (tool==='write')                         key = 'write';
        else if (tool==='edit')                          key = 'edit';
        else if (tool==='grep'||tool==='glob')           key = 'grep_glob';
        else if (tool==='agent')                         key = 'agent';
        else if (tool==='bash'||tool==='powershell')     key = bashKey(data.category||'other');
        else                                             key = 'other';

        if (!passesFilter(key, data.project)) return;
        const name = S.instruments[key] || 'harp';
        if (name === 'off') return;
        const fn  = INSTS[name] || harp;
        const hz  = noteHz(data.project, getDegree(data.where), 0);
        sched((c, at) => PERC.has(name) ? fn(c, at) : fn(c, at, hz));

      } else if (event === 'tokens') {
        if (!passesFilter('tokens', data.project)) return;
        const name = S.instruments.tokens || 'flute';
        if (name === 'off') return;
        const fn  = INSTS[name] || flute;
        const hz  = noteHz(data.project, 0, -1);
        const vol = Math.min(0.11, 0.04 + Math.log1p((data.output||0) / 300) * 0.028);
        sched((c, at) => PERC.has(name) ? fn(c, at, vol) : fn(c, at, hz, vol));

      } else if (event === 'words') {
        if (!passesFilter('words', data.project)) return;
        const name = S.instruments.words || 'bell';
        if (name === 'off') return;
        const fn  = INSTS[name] || bell;
        const iv  = activeIv();
        const deg = Math.min(iv.length - 1, Math.floor((data.word_count||0) / 15));
        const hz  = noteHz(data.project, deg, 1);
        sched((c, at) => PERC.has(name) ? fn(c, at) : fn(c, at, hz, 0.11));
      }
    } catch { /* audio must never break UI */ }
  };

  // ── ♪ Mute toggle button ──────────────────────────────────────────────────────
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    const btn = document.createElement('div');
    btn.id    = 'sound-btn';
    btn.title = 'Toggle pulse sounds';
    btn.style.cssText = 'position:fixed;top:8px;right:110px;background:#0e0e22;color:#2a3050;font:bold 10px \'IBM Plex Mono\',monospace;padding:3px 9px;z-index:9998;cursor:pointer;user-select:none;border:1px solid #1c1c34;transition:color .15s,background .15s,border-color .15s;letter-spacing:1px';
    btn.textContent = '♪ OFF';
    document.body.appendChild(btn);
    btn.addEventListener('click', () => {
      muted = !muted;
      if (!muted) {
        ac();
        if (window.AUDIO_SETTINGS.clickTrack) _startClick();
        btn.textContent='♪ ON';  btn.style.color='#00ff88'; btn.style.background='#061a0e'; btn.style.borderColor='#1a4a2a';
      } else {
        _stopClick();
        btn.textContent='♪ OFF'; btn.style.color='#2a3050'; btn.style.background='#0e0e22'; btn.style.borderColor='#1c1c34';
      }
    });
  }

})();
