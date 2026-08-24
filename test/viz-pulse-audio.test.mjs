/**
 * test/viz-pulse-audio.test.mjs → viz-the-pulse-audio.html
 *
 * Guards the visualizer's audio mapping against the live engine
 * (14-pulse-audio.js) and the Event Registry. The viz claims to document
 * what you hear, not the design tables — this file fails if those claims rot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { EVENT_TYPES } from '../experience/audio/event-registry.mjs';
import {
  coalesceVoices, VOICE_MAX_POLYPHONY, VOICE_MAX_CHORD, voicePriority,
} from '../experience/client-core.mjs';

const html = fs.readFileSync(new URL('../viz-the-pulse-audio.html', import.meta.url), 'utf8');
const engineSrc = fs.readFileSync(new URL('../experience/client/14-pulse-audio.js', import.meta.url), 'utf8');

function seedOf() {
  const m = html.match(/<script type="application\/json" id="seed-data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'viz embeds seed-data JSON');
  return JSON.parse(m[1]);
}

function extractAssign(src, name) {
  const re = new RegExp(`(?:(?:const|let|var)\\s+|window\\.)${name}\\s*=\\s*`);
  const m = re.exec(src);
  assert.ok(m, `engine declares ${name}`);
  const start = m.index + m[0].length;
  const open = src[start];
  assert.ok(open === '{' || open === '[', `${name} starts with object/array`);
  const stack = [open];
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

function parseEngine() {
  const spatial = Function(`return ${extractAssign(engineSrc, 'SPATIAL')}`)();
  const cog = Function(`return ${extractAssign(engineSrc, 'COG_SOUND')}`)();
  const settings = Function(`return ${extractAssign(engineSrc, 'DEFAULT_SETTINGS')}`)();
  const families = Function(`return ${extractAssign(engineSrc, 'AUDIO_FAMILIES')}`)();
  const fam = {};
  for (const f of families) for (const t of f.tools) fam[t] = f.id;
  return { spatial, cog, instruments: settings.instruments, fam, families };
}

function engineHeard(key, tables) {
  const { spatial, cog, instruments, fam } = tables;
  const inCog = Object.prototype.hasOwnProperty.call(cog, key);
  const inSpatial = Object.prototype.hasOwnProperty.call(spatial, key);
  const inInst = Object.prototype.hasOwnProperty.call(instruments, key);
  const silent = !inCog && !inSpatial && !inInst && key !== 'thinking' && key !== 'unknown'
    && key !== 'tokens' && key !== 'words';
  // thinking/unknown ride COGNITION_EVENTS with null resolveSonic → harp fallback
  const fallback = (key === 'thinking' || key === 'unknown');
  const sp = spatial[key] || (fallback || inCog ? { pan: 0, sendAmt: 0.05, brightness: 7000 } : null);
  if (!sp && silent) return { silent: true, key };
  let inst = instruments[key] || (inCog ? cog[key].instrument : null);
  if (fallback) inst = 'harp';
  let oct = 0, vol = 1;
  if (key === 'tokens') oct = -1;
  else if (key === 'words') oct = 1;
  else if (inCog) { oct = cog[key].octave; vol = cog[key].volMult; }
  if (fallback) {
    inst = 'harp';
    oct = 0;
    vol = 1;
    return {
      key, silent: false, inst, pan: 0, send: 0.05, bri: 7000, oct, vol,
      fam: fam[key] || null,
    };
  }
  return {
    key, silent: false,
    inst,
    pan: sp.pan, send: sp.sendAmt, bri: sp.brightness,
    oct, vol,
    fam: fam[key] || null,
  };
}

function v(over = {}) {
  const { sonic, ...rest } = over;
  return {
    name: 'harp', hz: 261.6, vol: 0.4,
    sonic: { key: 'read', fam: 'file', ...sonic },
    ...rest,
  };
}

test('viz seed parses and covers engine SPATIAL + COG_SOUND + fallbacks', () => {
  const seed = seedOf();
  const tables = parseEngine();
  const byKey = Object.fromEntries(seed.events.map(e => [e.key, e]));

  for (const key of Object.keys(tables.spatial)) {
    assert.ok(byKey[key], `viz missing engine SPATIAL key: ${key}`);
  }
  for (const key of Object.keys(tables.cog)) {
    assert.ok(byKey[key], `viz missing engine COG_SOUND key: ${key}`);
  }
  assert.ok(byKey.thinking, 'viz documents thinking harp fallback');
  assert.ok(byKey.unknown, 'viz documents unknown harp fallback');
});

test('viz event rows match live-engine heard mapping (not registry)', () => {
  const seed = seedOf();
  const tables = parseEngine();
  const mismatches = [];
  for (const row of seed.events) {
    const heard = engineHeard(row.key, tables);
    if (heard.silent) {
      if (!row.silent) mismatches.push(`${row.key}: engine silent but viz lists it as audible`);
      continue;
    }
    if (row.silent) {
      mismatches.push(`${row.key}: viz silent but engine hears it`);
      continue;
    }
    const fields = [
      ['inst', heard.inst, row.inst],
      ['pan', heard.pan, row.pan],
      ['send', heard.send, row.send],
      ['bri', heard.bri, row.bri],
      ['oct', heard.oct, row.oct],
      ['vol', heard.vol, row.vol],
      ['fam', heard.fam, row.fam],
    ];
    for (const [name, a, b] of fields) {
      if (a !== b) mismatches.push(`${row.key}.${name}: engine ${a} ≠ viz ${b}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('viz registry column matches EVENT_TYPES.instrument', () => {
  const seed = seedOf();
  const mismatches = [];
  for (const [key, inst] of Object.entries(seed.registry)) {
    assert.ok(EVENT_TYPES[key], `viz registry key not in EVENT_TYPES: ${key}`);
    if (EVENT_TYPES[key].instrument !== inst) {
      mismatches.push(`${key}: viz registry ${inst} ≠ EVENT_TYPES ${EVENT_TYPES[key].instrument}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('viz registryAxes matches EVENT_TYPES on every sonic field', () => {
  const seed = seedOf();
  const mismatches = [];
  for (const [key, et] of Object.entries(EVENT_TYPES)) {
    const r = seed.registryAxes[key];
    if (!r) { mismatches.push(`missing ${key}`); continue; }
    const pairs = [
      ['inst', r.inst, et.instrument],
      ['pan', r.pan, et.pan],
      ['send', r.send, et.sendAmt],
      ['bri', r.bri, et.brightness],
      ['oct', r.oct, et.octave],
      ['vol', r.vol, et.volMult],
      ['fam', r.fam, et.family],
    ];
    for (const [n, a, b] of pairs) {
      if (a !== b) mismatches.push(`${key}.${n}: viz ${a} ≠ registry ${b}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('viz documents tool_result as engine-silent (playPulse never dispatches it)', () => {
  assert.ok(engineSrc.includes("const COGNITION_EVENTS = new Set(["), 'COGNITION_EVENTS present');
  const m = engineSrc.match(/const COGNITION_EVENTS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m);
  assert.equal(m[1].includes('tool_result'), false, 'engine does not play tool_result');
  const seed = seedOf();
  const row = seed.events.find(e => e.key === 'tool_result');
  assert.ok(row, 'viz must list tool_result');
  assert.equal(row.silent, true);
  assert.equal(row.inst, 'off');
});

test('missing synths: registry names not in engine INSTS', () => {
  const insts = [...engineSrc.matchAll(/function (harp|bass|bell|flute|bit|pling|snare|kick|hat|buzz)\(/g)].map(x => x[1]);
  const unique = [...new Set(insts)];
  assert.deepEqual(unique.sort(), ['bass','bell','bit','buzz','flute','harp','hat','kick','pling','snare'].sort());
  const seed = seedOf();
  assert.equal(seed.insts.length, 10);
  const engineSet = new Set(unique);
  const registryInst = [...new Set(Object.values(EVENT_TYPES).map(e => e.instrument))];
  const missing = registryInst.filter(n => !engineSet.has(n));
  assert.deepEqual(missing.sort(), ['chime','click','pad','sweep','tick','woodblock'].sort());
});

test('formulas in viz match engine: tokens brightness, words degree, path hash, pressure', () => {
  assert.match(html, /800 \+ 4200 \* \(1 - r\)/);
  assert.match(engineSrc, /800 \+ 4200 \* \(1 - cR\)/);
  assert.match(html, /Math\.floor\(n \/ 15\)/);
  assert.match(engineSrc, /Math\.floor\(\(data\.word_count \|\| 0\) \/ 15\)/);
  assert.match(html, /h = \(\(\(h << 5\) \+ h\) \^ s\.charCodeAt\(i\)\) >>> 0/);
  assert.match(engineSrc, /h = \(\(\(h << 5\) \+ h\) \^ s\.charCodeAt\(i\)\) >>> 0/);
  assert.match(html, /0\.6·cache \+ 0\.4·density/);
  assert.match(engineSrc, /avgCache \* 0\.6 \+ densityP \* 0\.4/);
  assert.match(html, /max\(200, 12000/);
  assert.match(engineSrc, /Math\.max\(200, 12000 \* Math\.pow\(1 - .*0\.70, 1\.5\)\)/);
});

test('change-set constants: 80ms live, 24ms replay, poly 4, chord 3, heardAt stamp', () => {
  assert.match(engineSrc, /const BATCH_MS = 80/);
  assert.match(engineSrc, /const REPLAY_COHORT_MS = 24/);
  assert.match(html, /data-count-to="80"/);
  assert.match(html, /24 MS/);
  assert.equal(VOICE_MAX_POLYPHONY, 4);
  assert.equal(VOICE_MAX_CHORD, 3);
  assert.match(html, /data-count-to="4"/);
  assert.match(engineSrc, /ringEv\.heardAt = at/);
  assert.match(html, /heardAt/);
  assert.match(html, /\/api\/audio/);
  assert.match(engineSrc, /coalesceVoices/);
});

test('viz coalesce bursts agree with client-core coalesceVoices', () => {
  const twelve = Array.from({ length: 12 }, () => v({}));
  const a = coalesceVoices(twelve, { scale: [0, 4, 7, 12] });
  assert.equal(a.audible.length, VOICE_MAX_CHORD);
  assert.equal(a.ghosts.length, 12);
  assert.equal(a.audible[0].clusterN, 12);

  const snares = Array.from({ length: 8 }, () => v({ name: 'snare', sonic: { key: 'bash_git', fam: 'system' } }));
  const s = coalesceVoices(snares);
  assert.equal(s.audible.length, 1);
  assert.equal(s.audible[0].clusterN, 8);

  const under = [v({}), v({}), v({})];
  const u = coalesceVoices(under, { scale: [0, 4, 7] });
  assert.equal(u.audible.length, 3);
  assert.equal(u.ghosts.length, 0);
  assert.notEqual(+u.audible[1].hz.toFixed(1), +u.audible[0].hz.toFixed(1));
});

test('viz playEvent routes through brightness filter + stereo panner (engine signal chain)', () => {
  assert.match(html, /filt\.connect\(endpoint\)/);
  assert.match(html, /createStereoPanner/);
  assert.match(html, /\.connect\(out\)/);
  assert.doesNotMatch(html, /for preview we just play dry/);
});

test('viz priority table matches client-core VOICE_PRIORITY', () => {
  const seed = seedOf();
  assert.equal(seed.priority.write, 90);
  assert.equal(seed.priority.tool_error, 100);
  assert.equal(seed.priority.read, 30);
  assert.equal(voicePriority({ sonic: { key: 'write' } }), 90);
  assert.equal(voicePriority({ sonic: { key: 'tokens' } }), 12);
});

test('AUDIO_FAMILIES still omits human/meta — viz fam=null count matches engine', () => {
  const tables = parseEngine();
  const famIds = tables.families.map(f => f.id).sort();
  assert.deepEqual(famIds, ['ai', 'context', 'file', 'system']);
  const seed = seedOf();
  const unset = seed.events.filter(e => e.fam == null && !e.silent);
  assert.equal(unset.length, 11);
});
