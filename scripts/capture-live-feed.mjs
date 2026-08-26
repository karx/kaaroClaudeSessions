#!/usr/bin/env node
/**
 * Subscribe to GET /events, encode each pulse the way the live dispatcher
 * does, and write a JSON file for review.
 *
 * Usage:
 *   node scripts/capture-live-feed.mjs [--minutes=8] [--port=3333] [--out=FILE]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { resolveSonic, resolveHz } from '../experience/audio/audio-sim.mjs';
import { getPreset } from '../experience/audio/audio-presets.mjs';
import { pulseTickerEntry, LIVE_PLAYPULSE_EVENTS } from '../experience/client-core.mjs';

const __DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__DIR, '..');

const PLAYABLE = new Set([
  'harp', 'bass', 'bell', 'flute', 'bit', 'pling', 'snare', 'kick', 'hat', 'buzz', 'off',
]);

const LIFECYCLE = new Set(['status', 'updated', 'error', 'now']);

// 13-live-updates.js subscribers that call playPulse
const PLAYPULSE_EVENTS = new Set(LIVE_PLAYPULSE_EVENTS);

const args = process.argv.slice(2);
let minutes = 8;
let port = 3333;
let outFile = path.join(ROOT, 'live-feed-capture.json');
let presetSlug = 'cognitive-flow';

for (const arg of args) {
  if (arg.startsWith('--minutes=')) minutes = Number(arg.slice(10));
  else if (arg.startsWith('--port=')) port = Number(arg.slice(7));
  else if (arg.startsWith('--out=')) outFile = path.resolve(arg.slice(6));
  else if (arg.startsWith('--preset=')) presetSlug = arg.slice(9);
}

const durationMs = Math.round(minutes * 60 * 1000);
const preset = getPreset(presetSlug);
if (!preset) {
  console.error(`Unknown preset "${presetSlug}"`);
  process.exit(1);
}

const url = `http://127.0.0.1:${port}/events`;
const startedAt = new Date();
const seqState = { idx: 0 };
const events = [];
const byEvent = {};
const sinksHit = { ticker: 0, beat_ring: 0, audio: 0, wire_only: 0, lifecycle: 0 };

function slimData(event, data) {
  if (data == null) return data;
  if (typeof data !== 'object') return data;
  if (event === 'now') {
    return {
      generated_at: data.generated_at ?? null,
      sessions: Array.isArray(data.sessions) ? data.sessions.length : null,
      totals: data.totals ?? null,
    };
  }
  const keep = {};
  for (const k of [
    'session_id', 'slug', 'harness', 'project', 'ts',
    'tool', 'key', 'where', 'why', 'category',
    'preview', 'word_count', 'text', 'mode', 'message', 'code',
    'input', 'output', 'cache_create', 'cache_read', 'synthetic',
    'nr_kind', 'block_type', 'raw_type',
  ]) {
    if (data[k] != null) keep[k] = data[k];
  }
  if (typeof keep.preview === 'string') keep.preview = keep.preview.slice(0, 120);
  if (typeof keep.text === 'string') keep.text = keep.text.slice(0, 120);
  if (typeof keep.why === 'string') keep.why = keep.why.slice(0, 120);
  return keep;
}

function classify(event, data, sonic) {
  const lifecycle = LIFECYCLE.has(event);
  const subscribed = PLAYPULSE_EVENTS.has(event);
  let ticker = false;
  if (event === 'tool_call' || event === 'words') ticker = true;
  else if (pulseTickerEntry(event, data || {})) ticker = true;
  const beat_ring = subscribed;
  const audible = !!(sonic && sonic.instrument && sonic.instrument !== 'off');
  const audio = subscribed && audible;
  return { lifecycle, subscribed, ticker, beat_ring, audio, audible };
}

function transcriptLine(relMs, event, data, sonic, hz, sinks) {
  const t = 't+' + (relMs / 1000).toFixed(1) + 's';
  if (sinks.lifecycle) return `${t}  ${event}  [lifecycle]`;
  const detail = data?.tool || data?.preview || data?.text || data?.mode || data?.message || data?.key || '';
  const inst = sonic?.instrument || '—';
  const key = sonic?.key || event;
  const fam = sonic?.fam ? `[${String(sonic.fam).toUpperCase()}]` : '';
  const hzBit = hz != null ? `hz=${hz}` : '';
  const sink = !sinks.subscribed ? 'WIRE-ONLY'
    : (sinks.audio ? 'VIZ+AUDIO' : (sinks.beat_ring ? 'VIZ' : 'SUBSCRIBED'));
  return [t, event, String(detail).slice(0, 40), key, inst, hzBit, fam, sink]
    .filter(Boolean).join('  ');
}

function bump(event, sinks) {
  byEvent[event] = (byEvent[event] || 0) + 1;
  if (sinks.lifecycle) sinksHit.lifecycle++;
  else if (!sinks.subscribed) sinksHit.wire_only++;
  if (sinks.ticker) sinksHit.ticker++;
  if (sinks.beat_ring) sinksHit.beat_ring++;
  if (sinks.audio) sinksHit.audio++;
}

function payload(endedAt, reason) {
  const transcript = events.map(e => e.transcript);
  return {
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: endedAt - startedAt,
    duration_requested_ms: durationMs,
    stop_reason: reason,
    source: url,
    preset: preset.name,
    counts: {
      total: events.length,
      by_event: byEvent,
      sinks: sinksHit,
    },
    events,
    transcript,
  };
}

function flush(reason) {
  const body = JSON.stringify(payload(new Date(), reason), null, 2);
  fs.writeFileSync(outFile, body, 'utf8');
}

console.error(`Capturing live feed ${url} for ${minutes} min → ${outFile}`);
flush('started');

const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), durationMs);

let stopReason = 'duration';
try {
  const res = await fetch(url, {
    signal: ac.signal,
    headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
  if (!res.ok || !res.body) {
    console.error(`SSE connect failed: ${res.status}`);
    flush('connect-failed');
    process.exit(1);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err?.name === 'AbortError') break;
      throw err;
    }
    if (chunk.done) {
      stopReason = 'stream-ended';
      break;
    }
    buf += dec.decode(chunk.value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const block of parts) {
      const lines = block.split('\n');
      const event = lines.find(l => l.startsWith('event: '))?.slice(7)?.trim();
      const dataLine = lines.find(l => l.startsWith('data: '))?.slice(6);
      if (!event) continue;
      let data = null;
      if (dataLine && dataLine !== '[DONE]') {
        try { data = JSON.parse(dataLine); } catch { data = dataLine; }
      }
      const received = new Date();
      const relMs = received - startedAt;
      const slim = slimData(event, data);
      let sonic = null;
      let hz = null;
      if (!LIFECYCLE.has(event) && data && typeof data === 'object') {
        try {
          sonic = resolveSonic(event, data, preset.settings, { mappings: preset.mappings });
          if (sonic && sonic.instrument !== 'off') hz = resolveHz(data, sonic, 60, seqState);
        } catch { /* encode must not drop the row */ }
      }
      if (sonic) {
        sonic = {
          ...sonic,
          playable: PLAYABLE.has(sonic.instrument) ? sonic.instrument : 'harp-fallback',
        };
      }
      const sinks = classify(event, data && typeof data === 'object' ? data : {}, sonic);
      const line = transcriptLine(relMs, event, slim, sonic, hz, sinks);
      const row = {
        i: events.length,
        received_at: received.toISOString(),
        rel_ms: relMs,
        event,
        data: slim,
        sonic,
        hz,
        sinks: {
          lifecycle: sinks.lifecycle,
          sse_subscribed: sinks.subscribed,
          ticker: sinks.ticker,
          beat_ring: sinks.beat_ring,
          audio: sinks.audio,
        },
        transcript: line,
      };
      events.push(row);
      bump(event, sinks);
      console.log(line);
      if (events.length === 1 || events.length % 25 === 0) flush('partial');
    }
  }
} catch (err) {
  if (err?.name !== 'AbortError') {
    stopReason = 'error:' + (err.message || String(err));
    console.error(stopReason);
  }
} finally {
  clearTimeout(timer);
  flush(stopReason);
  console.error(`Wrote ${events.length} events → ${outFile}  (${stopReason})`);
}
