#!/usr/bin/env node
/**
 * scripts/dump-pulses.mjs — NDJSON dump of every pulse in a session.
 *
 * Outputs one JSON object per line covering ALL pulses (audible and silenced),
 * with NR metadata attached. Designed for debugging and sonic refinement.
 *
 * Usage:
 *   node scripts/dump-pulses.mjs [session] [options]
 *
 * Session arg (optional — omit to auto-pick most recent):
 *   path/to/file.jsonl        explicit file
 *   5a54108b                  CC session ID prefix (8+ chars)
 *
 * Options:
 *   --preset=cognitive-flow|thrash-detector|session-arc  (default: cognitive-flow)
 *   --harness=cc|grok|antigravity|all    (default: all = most recent)
 *   --out=FILE    write NDJSON to FILE instead of stdout
 *   --filter=EVENT  only emit rows where event === EVENT  (e.g. --filter=unknown)
 *   --audible     only emit rows where audible === true
 *   --silent      only emit rows where audible === false
 *   --group       print summary counts grouped by nr_kind instead of raw rows
 *
 * Examples:
 *   node scripts/dump-pulses.mjs --group
 *   node scripts/dump-pulses.mjs --filter=unknown --group
 *   node scripts/dump-pulses.mjs 5a54108b --out=/tmp/pulses.ndjson
 *   node scripts/dump-pulses.mjs --harness=antigravity --group
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';

import { dumpSession }            from '../experience/audio/audio-sim.mjs';
import { getPreset, PRESET_SLUGS } from '../experience/audio/audio-presets.mjs';

const __DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT  = path.resolve(__DIR, '..');

// ── Parse args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let sessionArg    = null;
let presetSlug    = 'cognitive-flow';
let harnessFilter = 'all';
let outFile       = null;
let filterEvent   = null;
let onlyAudible   = false;
let onlySilent    = false;
let groupMode     = false;

for (const arg of args) {
  if      (arg.startsWith('--preset='))   presetSlug    = arg.slice(9);
  else if (arg.startsWith('--harness='))  harnessFilter = arg.slice(10);
  else if (arg.startsWith('--out='))      outFile       = arg.slice(6);
  else if (arg.startsWith('--filter='))   filterEvent   = arg.slice(9);
  else if (arg === '--audible')           onlyAudible   = true;
  else if (arg === '--silent')            onlySilent    = true;
  else if (arg === '--group')             groupMode     = true;
  else if (!arg.startsWith('--'))        sessionArg    = arg;
}

// ── Session discovery (shared logic with sim-audio.mjs) ───────────────────────

function ccSessions() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];
  const out = [];
  for (const proj of fs.readdirSync(claudeDir)) {
    const projPath = path.join(claudeDir, proj);
    if (!fs.statSync(projPath).isDirectory()) continue;
    const projLabel = proj.split('--').pop();
    for (const f of fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'))) {
      const fp = path.join(projPath, f);
      const sid = path.basename(f, '.jsonl');
      out.push({ path: fp, sessionId: sid, projSlug: proj, projLabel, mtime: fs.statSync(fp).mtimeMs, harness: 'claude-code' });
    }
  }
  return out;
}

function grokSessions() {
  const grokBase = path.join(os.homedir(), '.grok', 'sessions');
  if (!fs.existsSync(grokBase)) return [];
  const out = [];
  for (const proj of fs.readdirSync(grokBase)) {
    const projPath = path.join(grokBase, proj);
    if (!fs.statSync(projPath).isDirectory()) continue;
    const projLabel = decodeURIComponent(proj.replace(/%5C/gi, '/')).split(/[/\\]/).pop();
    for (const sid of fs.readdirSync(projPath)) {
      const uf = path.join(projPath, sid, 'updates.jsonl');
      if (!fs.existsSync(uf)) continue;
      out.push({ path: uf, sessionId: sid, projSlug: proj, projLabel, mtime: fs.statSync(uf).mtimeMs, harness: 'grok' });
    }
  }
  return out;
}

function antigravitySessions() {
  const agBase = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  if (!fs.existsSync(agBase)) return [];
  const out = [];
  for (const sid of fs.readdirSync(agBase)) {
    const tl = path.join(agBase, sid, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(tl)) continue;
    out.push({ path: tl, sessionId: sid, projSlug: 'antigravity', projLabel: 'antigravity', mtime: fs.statSync(tl).mtimeMs, harness: 'antigravity' });
  }
  return out;
}

function allSessions(filter = 'all') {
  const pool = [
    ...(filter !== 'grok' && filter !== 'antigravity' ? ccSessions()          : []),
    ...(filter !== 'cc'   && filter !== 'antigravity' ? grokSessions()        : []),
    ...(filter !== 'cc'   && filter !== 'grok'        ? antigravitySessions() : []),
  ];
  return pool.sort((a, b) => b.mtime - a.mtime);
}

// ── Resolve session ───────────────────────────────────────────────────────────
let entry = null;

if (sessionArg && (sessionArg.includes('/') || sessionArg.includes('\\'))) {
  if (!fs.existsSync(sessionArg)) { console.error(`File not found: ${sessionArg}`); process.exit(1); }
  const isGrok = path.basename(sessionArg) === 'updates.jsonl';
  const sid    = isGrok ? path.basename(path.dirname(sessionArg)) : path.basename(sessionArg, '.jsonl');
  const proj   = isGrok ? path.basename(path.dirname(path.dirname(sessionArg))) : path.basename(path.dirname(sessionArg));
  const harness = isGrok ? 'grok'
    : (sessionArg.replace(/\\/g, '/').includes('.gemini/antigravity') ? 'antigravity' : 'claude-code');
  entry = { path: sessionArg, sessionId: sid, projSlug: proj, projLabel: proj.split('--').pop(), harness };
} else if (sessionArg) {
  const prefix = sessionArg.toLowerCase();
  const match  = allSessions(harnessFilter).find(s => s.sessionId.toLowerCase().startsWith(prefix));
  if (!match) { console.error(`No session matching "${sessionArg}"`); process.exit(1); }
  entry = match;
} else {
  const pool = allSessions(harnessFilter);
  if (!pool.length) { console.error('No session files found.'); process.exit(1); }
  entry = pool[0];
  console.error(`Auto-selected: [${entry.harness}]  ${entry.sessionId.slice(0, 8)}  [${entry.projLabel}]`);
}

// ── Load preset ───────────────────────────────────────────────────────────────
const preset = getPreset(presetSlug);
if (!preset) { console.error(`Unknown preset "${presetSlug}". Available: ${PRESET_SLUGS.join(', ')}`); process.exit(1); }

// ── Load JSONL ────────────────────────────────────────────────────────────────
const { path: jsonlPath, sessionId, projSlug, projLabel, harness } = entry;
const sid8 = sessionId.slice(0, 8);

const records = fs.readFileSync(jsonlPath, 'utf8')
  .split('\n').filter(l => l.trim())
  .map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

// ── Run dump ──────────────────────────────────────────────────────────────────
const ctx = { session_id: sessionId, slug: sid8, harness, project_id: projSlug, project_label: projLabel };
let rows = dumpSession(records, ctx, preset.settings, { mappings: preset.mappings });

// ── Apply filters ─────────────────────────────────────────────────────────────
if (filterEvent)  rows = rows.filter(r => r.event === filterEvent);
if (onlyAudible)  rows = rows.filter(r => r.audible);
if (onlySilent)   rows = rows.filter(r => !r.audible);

// ── Output ────────────────────────────────────────────────────────────────────
if (groupMode) {
  // Count by nr_kind within each event type
  const groups = {};
  for (const r of rows) {
    const gKey = `${r.event}  [${r.nr_kind}]`;
    groups[gKey] = (groups[gKey] || 0) + 1;
  }
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  console.error(`\n┌─ SESSION: ${sid8}  [${projLabel}]  (${harness})`);
  console.error(`│  PRESET: ${preset.name}  |  total rows: ${rows.length}`);
  if (filterEvent)  console.error(`│  --filter=${filterEvent}`);
  if (onlyAudible)  console.error(`│  --audible`);
  if (onlySilent)   console.error(`│  --silent`);
  console.error(`└─ BREAKDOWN:`);
  for (const [k, n] of sorted) {
    console.log(`${String(n).padStart(6)}  ${k}`);
  }
} else {
  const lines = rows.map(r => JSON.stringify(r));
  if (outFile) {
    fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
    console.error(`\nDump written to ${outFile}  (${rows.length} rows)`);
  } else {
    for (const l of lines) console.log(l);
  }
}
