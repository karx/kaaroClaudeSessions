/**
 * experience/client-core/04-daw.mjs — DAW lane geometry, playback voice
 * coalescing. Part of the client-core split; see experience/client-core.mjs.
 */

// ── DAW lane geometry (Cognitive DAW Builder) ─────────────────────────────────
// Lane tool colors are deliberately brighter variants of TOOL_COLORS — they sit
// on the dark per-family lane backgrounds (visual contract, do not unify).

export const DAW_FAMILY_LANES = [
  {
    id: 'file', label: 'FILE OPS', bg: '#0b1a0e', portion: 0.28,
    toolColors: { write: '#00cc55', edit: '#ccaa00', read: '#3a6aaa', grep_glob: '#8844cc' },
    blockW: e => e.key === 'write' ? 10 : e.key === 'edit' ? 8 : 5,
    blockH: e => e.key === 'write' ? 0.85 : e.key === 'edit' ? 0.70 : 0.50,
  },
  {
    id: 'system', label: 'SYSTEM', bg: '#0a0a18', portion: 0.20,
    toolColors: { bash_git: '#cc5522', bash_run: '#dd7733', bash_other: '#555577' },
    blockW: () => 7,
    blockH: () => 0.70,
  },
  {
    id: 'ai', label: 'AI / AGENT', bg: '#100818', portion: 0.25,
    toolColors: { agent: '#cc2244', other: '#884466' },
    blockW: e => e.key === 'agent' ? 14 : 8,
    blockH: () => 0.85,
  },
  {
    id: 'context', label: 'CONTEXT', bg: '#080c18', portion: 0.15,
    toolColors: { tokens: '#00ddcc', words: '#00aaff', thinking: '#ffaa00' },
    blockW: e => e.type === 'tokens' ? 3 : e.type === 'thinking' ? 6 : 8,
    blockH: e => {
      if (e.type === 'tokens')
        return Math.max(0.1, Math.min(0.8, Math.log1p((e.output || 0) / 200) * 0.35));
      if (e.type === 'thinking') return 0.45;
      return Math.max(0.1, Math.min(0.85, (e.word_count || 0) / 80));
    },
  },
];

/** Stack lanes under the ruler; every lane keeps an 18px minimum height. */
export function computeLaneLayout(H, lanes = DAW_FAMILY_LANES, rulerH = 20) {
  const usable = H - rulerH;
  let y = rulerH;
  return lanes.map(lane => {
    const h = Math.max(18, Math.floor(usable * lane.portion));
    const r = { id: lane.id, y, h };
    y += h;
    return r;
  });
}

export function laneForEvent(ev, lanes = DAW_FAMILY_LANES) {
  return lanes.find(l => l.id === ev.family) || null;
}

/** Right-anchored time axis: x of an event on a live-scrolling canvas. */
export function evTimeX(ev, now, W, pxPerSec, scrollMs = 0) {
  return W - (now - ev.ts) / 1000 * pxPerSec + scrollMs / 1000 * pxPerSec;
}

/** Voices whose AudioContext start time `at` still covers `t` (plus a short hold). */
export function voicesSoundingAt(voices, t, holdSec = 0.08) {
  if (!voices || !voices.length) return [];
  return voices.filter(v => {
    const dur = Math.max(Number(v.dur) || 0, holdSec);
    return t >= v.at && t < v.at + dur;
  });
}

/** Session-relative clock for the DAW now-playing readout. */
export function fmtSessionT(relMs) {
  if (relMs == null || !Number.isFinite(relMs)) return '';
  const s = Math.max(0, relMs) / 1000;
  if (s < 60) return 't+' + s.toFixed(1) + 's';
  const m = Math.floor(s / 60);
  const r = Math.floor(s - m * 60);
  return 't+' + m + 'm' + String(r).padStart(2, '0') + 's';
}

/** Compact now-playing line for DAW header and Graph beat overlay. */
export function fmtSoundingLine(sounding, max = 3) {
  if (!sounding || !sounding.length) return '';
  const clock = fmtSessionT(sounding[0].relMs);
  const bits = sounding.slice(0, max).map(v => {
    const hz = v.hz ? Math.round(v.hz) + 'Hz' : '';
    const n  = v.clusterN > 1 ? '×' + v.clusterN : '';
    return [v.instrument + n, v.label || v.key, hz].filter(Boolean).join(' ');
  });
  return '▶ ' + (clock ? clock + '  ' : '') + bits.join(' · ');
}

/**
 * Playback policy for a simultaneous burst (one scheduler flush).
 *
 * Under MAX_POLYPHONY, unisons are spread into a scale chord so N harps
 * at C4 don't stack. Over the cap: keep a few high-salience voices
 * (write/error/words) and collapse the rest per family into one chord
 * (or a single percussion hit). Oscillator count never exceeds maxPoly.
 *
 * `ghosts` are originals with no oscillator — the DAW still draws them.
 */
export const VOICE_MAX_POLYPHONY = 4;
export const VOICE_MAX_CHORD = 3;

const VOICE_PRIORITY = {
  tool_error: 100, api_error: 100,
  write: 90, edit: 80,
  words: 70, human_turn: 70, agent: 65,
  bash_git: 55, bash_run: 50, bash_other: 45,
  read: 30, grep_glob: 28, other: 25,
  tokens: 12, thinking: 10, unknown: 8, permission: 8,
};

const PERC_VOICES = new Set(['snare', 'kick', 'hat']);

export function voicePriority(v) {
  const key = v?.sonic?.key || v?.key || '';
  const event = v?.meta?.event || v?.event || '';
  return VOICE_PRIORITY[key] ?? VOICE_PRIORITY[event] ?? 40;
}

function hzOf(v) { return Number(v.hz) || 261.6; }

function spreadChord(voices, intervals) {
  if (voices.length <= 1) return voices;
  const hzs = voices.map(hzOf);
  if (Math.max(...hzs) - Math.min(...hzs) >= 2) return voices;
  const root = hzs[0];
  const iv = intervals && intervals.length ? intervals : [0, 4, 7, 12];
  return voices.map((v, i) => ({
    ...v,
    hz: root * Math.pow(2, (iv[i % iv.length] || 0) / 12),
  }));
}

export function coalesceVoices(voices, opts = {}) {
  const maxPoly  = opts.maxPoly  ?? VOICE_MAX_POLYPHONY;
  const chordMax = opts.chordMax ?? VOICE_MAX_CHORD;
  const scale    = opts.scale    || [0, 4, 7, 12];

  if (!voices || !voices.length) return { audible: [], ghosts: [] };
  if (voices.length <= maxPoly) {
    return { audible: spreadChord(voices, scale), ghosts: [] };
  }

  const byFam = new Map();
  for (const v of voices) {
    const f = v.sonic?.fam || v.fam || 'other';
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f).push(v);
  }
  for (const g of byFam.values())
    g.sort((a, b) => voicePriority(b) - voicePriority(a));

  const fams = [...byFam.entries()]
    .sort((a, b) => voicePriority(b[1][0]) - voicePriority(a[1][0]));

  function want(group) {
    if (PERC_VOICES.has(group[0].name)) return 1;
    if (group.length === 1) return 1;
    return Math.min(chordMax, group.length);
  }

  const alloc = new Map(fams.map(([f]) => [f, 0]));
  let slots = maxPoly;
  while (slots > 0) {
    let gave = false;
    for (const [f, group] of fams) {
      if (alloc.get(f) < want(group) && slots > 0) {
        alloc.set(f, alloc.get(f) + 1);
        slots--;
        gave = true;
      }
    }
    if (!gave) break;
  }

  const audible = [];
  const ghosts  = [];
  for (const [f, group] of fams) {
    const n = group.length;
    const k = alloc.get(f);
    if (!k) { ghosts.push(...group); continue; }
    const boost = n > 1 ? 1 + 0.18 * Math.log2(n) : 1;
    if (PERC_VOICES.has(group[0].name) || n === 1) {
      audible.push({ ...group[0], vol: (group[0].vol ?? 0.42) * boost, clusterN: n > 1 ? n : undefined });
      ghosts.push(...group.slice(1));
      continue;
    }
    const rootHz = hzOf(group[0]);
    const vol = (group[0].vol ?? 0.42) * boost / Math.sqrt(k);
    for (let i = 0; i < k; i++) {
      audible.push({
        ...group[Math.min(i, n - 1)],
        hz: rootHz * Math.pow(2, (scale[i] || 0) / 12),
        vol,
        clusterN: n,
      });
    }
    ghosts.push(...group);
  }
  return { audible, ghosts };
}
