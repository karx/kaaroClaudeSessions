/**
 * lib/audio-sim.mjs — server-side audio simulation engine.
 *
 * Pure mirror of src/client/14-pulse-audio.js resolveSonic logic.
 * No Web Audio API, no DOM, no I/O.
 *
 * Pipeline:
 *   JSONL records → parsePulse() → pulses → resolveSonic() → SimEvent[]
 */

import { parsePulse } from './pulse-adapters.mjs';

// ── Scales (mirrors 14-pulse-audio.js) ───────────────────────────────────────
export const SCALES = {
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  blues:            [0, 3, 5, 6, 7, 10],
  major:            [0, 2, 4, 5, 7, 9, 11],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
};

// ── Family map ────────────────────────────────────────────────────────────────
export const TOOL_FAMILY = {
  read: 'file', write: 'file', edit: 'file', grep_glob: 'file',
  bash_git: 'system', bash_run: 'system', bash_other: 'system',
  agent: 'ai', other: 'ai', web: 'ai',
  tokens: 'context', words: 'context',
};

// ── Spatial defaults per action key ──────────────────────────────────────────
export const SPATIAL = {
  write:      { pan: -0.15, sendAmt: 0.05, brightness: 10000 },
  edit:       { pan: -0.10, sendAmt: 0.05, brightness:  9000 },
  read:       { pan:  0.05, sendAmt: 0.06, brightness:  7000 },
  grep_glob:  { pan:  0.10, sendAmt: 0.04, brightness:  5500 },
  agent:      { pan:  0.35, sendAmt: 0.40, brightness:  4500 },
  bash_git:   { pan: -0.30, sendAmt: 0.04, brightness:  3500 },
  bash_run:   { pan: -0.30, sendAmt: 0.04, brightness:  3500 },
  bash_other: { pan: -0.30, sendAmt: 0.04, brightness:  3500 },
  other:      { pan:  0.00, sendAmt: 0.08, brightness:  6000 },
  web:        { pan:  0.45, sendAmt: 0.28, brightness:  5800 },
  tokens:     { pan:  0.00, sendAmt: 0.00, brightness:  5000 },
  words:      { pan:  0.20, sendAmt: 0.15, brightness:  9000 },
};

export const HARNESS_PAN_BIAS = { pi: -0.15, antigravity: 0.15, grok: 0.25 };

export const DEFAULT_SETTINGS = {
  instruments: {
    read: 'harp', write: 'bass', edit: 'pling',
    bash_git: 'snare', bash_run: 'kick', bash_other: 'hat',
    grep_glob: 'bit', agent: 'bell', other: 'harp',
    web: 'bell', tokens: 'flute', words: 'bell',
  },
  scale:    'major_pentatonic',
  noteMode: 'path_hash',
  bpm:      120,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function strHash(s) {
  if (!s) return 0;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function bashKey(cat) {
  if (cat === 'git')  return 'bash_git';
  if (['npm', 'npx', 'node', 'python'].includes(cat)) return 'bash_run';
  return 'bash_other';
}

function ruleMatches(rule, evType, data, key) {
  const m = rule.match || {};
  const fam = TOOL_FAMILY[key] || null;
  if (m.type && m.type !== evType) return false;
  const mFam = Array.isArray(m.family) ? m.family : (m.family ? [m.family] : null);
  if (mFam && !mFam.includes(fam)) return false;
  const mKey = Array.isArray(m.key) ? m.key : (m.key ? [m.key] : null);
  if (mKey && !mKey.includes(key)) return false;
  const mH = Array.isArray(m.harness) ? m.harness : (m.harness ? [m.harness] : null);
  if (mH && data.harness && !mH.includes(data.harness)) return false;
  if (m.project && data.project && data.project !== m.project) return false;
  if (m.whereContains && data.where && !String(data.where).includes(m.whereContains)) return false;
  if (m.wordMin != null && (data.word_count || 0) < m.wordMin) return false;
  if (m.outMin  != null && (data.output    || 0) < m.outMin)   return false;
  return true;
}

// ── resolveSonic ──────────────────────────────────────────────────────────────
/**
 * Pure mirror of 14-pulse-audio.js resolveSonic().
 * @param {string} event    'tool_call' | 'tokens' | 'words'
 * @param {object} data     pulse data payload
 * @param {object} settings AUDIO_SETTINGS shape
 * @param {object} profile  AUDIO_PROFILE shape { mappings[] }
 * @returns {{ key, instrument, volMult, octave, degreeMode, scale, fam, pan, sendAmt, brightness }}
 */
export function resolveSonic(event, data, settings = DEFAULT_SETTINGS, profile = { mappings: [] }) {
  const S = { ...DEFAULT_SETTINGS, instruments: { ...DEFAULT_SETTINGS.instruments }, ...settings };
  if (settings.instruments) S.instruments = { ...DEFAULT_SETTINGS.instruments, ...settings.instruments };
  const P = profile || { mappings: [] };

  let key = null, instrument = null, volMult = 1, octave = 0;
  let degreeMode = S.noteMode;
  let scale = (P.scale || S.scale) || 'major_pentatonic';

  if (event === 'tool_call') {
    const tool = (data.tool || '').toLowerCase();
    if      (tool === 'read'  || tool === 'view_file'  || tool === 'read_file')        key = 'read';
    else if (tool === 'write' || tool === 'write_to_file')                             key = 'write';
    else if (tool === 'edit'  || tool === 'replace_file_content'
             || tool === 'search_replace')                                             key = 'edit';
    else if (tool === 'grep'  || tool === 'glob' || tool === 'grep_search'
             || tool === 'list_dir')                                                   key = 'grep_glob';
    else if (tool === 'agent')                                                         key = 'agent';
    else if (tool === 'bash' || tool === 'powershell' || tool === 'shell'
             || tool === 'run_command')                                                key = bashKey(data.category || 'other');
    else if (tool === 'web_fetch' || tool === 'web_search'
             || tool === 'web search:')                                                key = 'web';
    else                                                                               key = 'other';
    instrument = S.instruments[key] || 'harp';

  } else if (event === 'tokens') {
    key = 'tokens';
    instrument = S.instruments.tokens || 'flute';
    octave = -1;
    // default vol scaling by output size; mapping rules may override
    volMult = Math.min(1.5, 0.04 + Math.log1p((data.output || 0) / 300) * 0.028) / 0.11;

  } else if (event === 'words') {
    key = 'words';
    instrument = S.instruments.words || 'bell';
    octave = 1;
  } else {
    return null; // unknown event type
  }

  const sp = SPATIAL[key] || { pan: 0, sendAmt: 0.05, brightness: 7000 };
  let pan = sp.pan, sendAmt = sp.sendAmt, brightness = sp.brightness;

  // Tokens brightness driven by cache ratio
  if (key === 'tokens') {
    const total = (data.output || 0) + (data.cache_read || 0);
    const cR = total > 0 ? (data.cache_read || 0) / total : 0;
    brightness = Math.round(800 + 4200 * (1 - cR));
  }

  // Harness pan bias (additive, clamped)
  const hBias = (data && data.harness) ? (HARNESS_PAN_BIAS[data.harness] || 0) : 0;
  pan = Math.max(-1, Math.min(1, pan + hBias));

  // Mapping rules — first match wins
  for (const rule of (P.mappings || [])) {
    if (!ruleMatches(rule, event, data, key)) continue;
    const eff = rule.set || {};
    if (eff.instrument)                      instrument  = eff.instrument;
    if (typeof eff.volMult    === 'number')  volMult     = eff.volMult;
    if (typeof eff.octave     === 'number')  octave      = eff.octave;
    if (eff.degreeMode)                      degreeMode  = eff.degreeMode;
    if (eff.scale)                           scale       = eff.scale;
    if (typeof eff.pan        === 'number')  pan         = Math.max(-1, Math.min(1, eff.pan));
    if (typeof eff.send       === 'number')  sendAmt     = eff.send;
    if (typeof eff.brightness === 'number')  brightness  = eff.brightness;
    break;
  }

  const fam = TOOL_FAMILY[key] || null;
  return { key, instrument, volMult, octave, degreeMode, scale, fam, pan, sendAmt, brightness };
}

// ── resolveHz ─────────────────────────────────────────────────────────────────
/**
 * Deterministic pitch. Mirrors noteHz() from 14-pulse-audio.js.
 * Uses `projectRoot` (MIDI note, default 60=C4) instead of graph lookup.
 * `seqState` is mutated in-place for sequential mode.
 */
export function resolveHz(data, sonic, projectRoot = 60, seqState = { idx: 0 }) {
  const iv  = SCALES[sonic.scale] || SCALES.major_pentatonic;
  const mode = sonic.degreeMode;
  let degree = 0;

  if (mode === 'root') {
    degree = 0;
  } else if (mode === 'random') {
    // Deterministic "random": hash of where+ts so same input → same pitch
    degree = strHash((data.where || '') + String(data.ts || '')) % iv.length;
  } else if (mode === 'sequential') {
    seqState.idx = (seqState.idx + 1) % iv.length;
    degree = seqState.idx;
  } else {
    // path_hash (default)
    degree = data.where ? strHash(String(data.where)) % iv.length : 0;
  }

  const idx  = ((degree % iv.length) + iv.length) % iv.length;
  const midi = projectRoot + iv[idx] + (sonic.octave || 0) * 12;
  return parseFloat(midiToHz(midi).toFixed(1));
}

// ── simulateSession ───────────────────────────────────────────────────────────
/**
 * Run a full JSONL session through the audio pipeline.
 *
 * @param {object[]} records  Parsed JSONL records
 * @param {object}   ctx      { session_id, slug, harness, project_id, project_label }
 * @param {object}   settings AUDIO_SETTINGS
 * @param {object}   profile  AUDIO_PROFILE { mappings[] }
 * @param {number}   [projectRoot=60]  MIDI root for pitch (C4 default)
 * @returns {{ events: SimEvent[], summary: object, silentCount: number }}
 */
export function simulateSession(records, ctx = {}, settings = DEFAULT_SETTINGS, profile = { mappings: [] }, projectRoot = 60) {
  const seqState = { idx: 0 };
  const events   = [];
  let tsFirst    = null;
  let silentCount = 0;

  const silentTypes = new Set(['permission-mode', 'ai-title', 'system', 'attachment']);

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const rawTs = rec.timestamp || rec.created_at;
    const ts = rawTs ? new Date(rawTs).getTime() : null;
    if (ts !== null && tsFirst === null) tsFirst = ts;

    // Count structurally silent records
    if (silentTypes.has(rec.type)) { silentCount++; continue; }
    if (rec.type === 'user') {
      const content = rec.message?.content;
      const hasTR = Array.isArray(content) && content.some(c => c?.type === 'tool_result');
      if (hasTR || typeof content === 'string') { silentCount++; continue; }
    }

    const recordCtx = { harness: 'claude-code', ...ctx };
    const pulses = parsePulse(rec, recordCtx);
    if (!pulses.length) { silentCount++; continue; }

    for (const pulse of pulses) {
      const relMs = (ts !== null && tsFirst !== null) ? ts - tsFirst : 0;
      const sonic = resolveSonic(pulse.event, pulse.data, settings, profile);
      if (!sonic) { silentCount++; continue; }
      if (sonic.instrument === 'off') continue; // explicitly silenced — excluded

      const hz = resolveHz(pulse.data, sonic, projectRoot, seqState);

      events.push({
        relMs,
        event:  pulse.event,
        data:   pulse.data,
        sonic,
        hz,
      });
    }
  }

  const summary = {
    total:    events.length,
    silent:   silentCount,
    tool_call: events.filter(e => e.event === 'tool_call').length,
    tokens:    events.filter(e => e.event === 'tokens').length,
    words:     events.filter(e => e.event === 'words').length,
  };

  return { events, summary, silentCount };
}

// ── formatTranscript ──────────────────────────────────────────────────────────
/**
 * Render SimEvent[] to a text transcript (one event per line).
 * Stable and diffable — use for snapshots.
 */
export function formatTranscript(events) {
  return events.map(ev => {
    const { event, data, sonic, hz, relMs } = ev;
    const t      = `t+${(relMs / 1000).toFixed(3)}s`;
    const pan    = (sonic.pan >= 0 ? '+' : '') + sonic.pan.toFixed(2);
    const vol    = sonic.volMult.toFixed(2);
    const bri    = String(sonic.brightness).padStart(5);
    const hzStr  = String(hz).padStart(7);
    const fam    = (sonic.fam || 'unk').toUpperCase().padEnd(7);
    const inst   = sonic.instrument.padEnd(6);
    const key    = (sonic.key || '?').padEnd(11);

    let detail = '';
    if (event === 'tool_call') {
      const tool  = (data.tool || '?').padEnd(14);
      detail = `${tool}  ${key}`;
    } else if (event === 'tokens') {
      const cr  = data.cache_read != null && (data.output + data.cache_read) > 0
        ? Math.round(data.cache_read / (data.output + data.cache_read) * 100) : 0;
      detail = `out=${String(data.output || 0).padStart(6)} cr=${String(cr).padStart(3)}%  ${'tokens'.padEnd(25)}`;
    } else if (event === 'words') {
      const wc = String(data.word_count || 0).padStart(4);
      const pr = (data.preview || '').slice(0, 28).replace(/\n/g, ' ');
      detail = `${wc}w "${pr}"${''.padEnd(Math.max(0, 28 - pr.length))}  ${'words'.padEnd(11)}`;
    }

    const octStr = sonic.octave != null && sonic.octave !== 0
      ? (sonic.octave > 0 ? `oct+${sonic.octave}` : `oct${sonic.octave}`) : '     ';

    return `${t.padEnd(13)}  ${event.padEnd(10)}  ${detail}  ` +
           `${inst}  hz=${hzStr}  vol=${vol}  pan=${pan}  bri=${bri}  rv=${sonic.sendAmt.toFixed(2)}  ${octStr}  [${fam}]`;
  });
}

// ── formatSnapshotHeader ──────────────────────────────────────────────────────
export function formatSnapshotHeader(sessionId, presetSlug, summary, settings) {
  const now = new Date().toISOString().slice(0, 10);
  return [
    `# AUDIO TRANSCRIPT SNAPSHOT`,
    `# session=${sessionId}`,
    `# preset=${presetSlug}`,
    `# scale=${settings.scale || '?'}  noteMode=${settings.noteMode || '?'}  bpm=${settings.bpm || '?'}`,
    `# generated=${now}  projectRoot=60 (fixed)`,
    `# tool_call=${summary.tool_call}  words=${summary.words}  tokens=${summary.tokens}  total=${summary.total}  silent=${summary.silent}`,
    `# ${'─'.repeat(70)}`,
  ].join('\n');
}
