#!/usr/bin/env node
/**
 * scripts/sim-audio.mjs — CLI audio transcript simulator + snapshot tool.
 *
 * Usage:
 *   node scripts/sim-audio.mjs [session] [options]
 *
 * Session arg (optional — omit to auto-pick most recent):
 *   path/to/file.jsonl        explicit CC session file
 *   path/to/updates.jsonl     explicit Grok session file
 *   277e6422                  CC session ID prefix (8+ chars)
 *   019eacc0                  Grok session ID prefix (8+ chars)
 *
 * Options:
 *   --preset=cognitive-flow|thrash-detector|session-arc  (default: cognitive-flow)
 *   --harness=cc|grok|all     restrict auto-search (default: all = most recent)
 *   --snap      Write snapshot to test/snapshots/<sid8>-<preset>.snap
 *   --diff      Compare against saved snapshot; exit 1 if different
 *   --summary   Print only the summary block, not individual events
 *   --silent    Show what the JSONL contains that produces no audio
 *   --out=FILE  Write transcript to FILE instead of stdout
 *
 * Examples:
 *   node scripts/sim-audio.mjs                              # most recent session, any harness
 *   node scripts/sim-audio.mjs --harness=grok               # most recent Grok session
 *   node scripts/sim-audio.mjs 277e6422                     # CC session by prefix
 *   node scripts/sim-audio.mjs 019eacc0 --preset=session-arc
 *   node scripts/sim-audio.mjs session.jsonl --snap         # save snapshot
 *   node scripts/sim-audio.mjs session.jsonl --diff         # compare to saved snapshot
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';

import { simulateSession, formatTranscript, formatSnapshotHeader } from '../lib/audio-sim.mjs';
import { getPreset, PRESET_SLUGS } from '../lib/audio-presets.mjs';

const __DIR   = path.dirname(fileURLToPath(import.meta.url));
const ROOT    = path.resolve(__DIR, '..');
const SNAP_DIR = path.join(ROOT, 'test', 'snapshots');

// ── Parse args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let   sessionArg  = null;   // raw positional arg (path OR session ID prefix)
let   presetSlug  = 'cognitive-flow';
let   harnessFilter = 'all'; // cc | grok | all
let   doSnap      = false;
let   doDiff      = false;
let   summaryOnly = false;
let   showSilent  = false;
let   outFile     = null;

for (const arg of args) {
  if      (arg.startsWith('--preset='))   presetSlug    = arg.slice(9);
  else if (arg.startsWith('--harness='))  harnessFilter = arg.slice(10);
  else if (arg === '--snap')              doSnap        = true;
  else if (arg === '--diff')              doDiff        = true;
  else if (arg === '--summary')           summaryOnly   = true;
  else if (arg === '--silent')            showSilent    = true;
  else if (arg.startsWith('--out='))      outFile       = arg.slice(6);
  else if (!arg.startsWith('--'))         sessionArg    = arg;
}

// ── Session discovery helpers ─────────────────────────────────────────────────

function ccSessions() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];
  const out = [];
  for (const proj of fs.readdirSync(claudeDir)) {
    const projPath = path.join(claudeDir, proj);
    if (!fs.statSync(projPath).isDirectory()) continue;
    const projLabel = proj.split('--').pop();
    for (const f of fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'))) {
      const fp    = path.join(projPath, f);
      const sid   = path.basename(f, '.jsonl');
      const mtime = fs.statSync(fp).mtimeMs;
      out.push({ path: fp, sessionId: sid, projSlug: proj, projLabel, mtime, harness: 'claude-code' });
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
      const mtime = fs.statSync(uf).mtimeMs;
      out.push({ path: uf, sessionId: sid, projSlug: proj, projLabel, mtime, harness: 'grok' });
    }
  }
  return out;
}

function allSessions(filter = 'all') {
  const pool = [
    ...(filter !== 'grok' ? ccSessions()   : []),
    ...(filter !== 'cc'   ? grokSessions() : []),
  ];
  return pool.sort((a, b) => b.mtime - a.mtime);
}

// ── Resolve session entry ─────────────────────────────────────────────────────

let entry = null;

if (sessionArg && (sessionArg.includes('/') || sessionArg.includes('\\'))) {
  // Explicit file path
  if (!fs.existsSync(sessionArg)) { console.error(`File not found: ${sessionArg}`); process.exit(1); }
  const isGrok = path.basename(sessionArg) === 'updates.jsonl';
  const sid    = isGrok ? path.basename(path.dirname(sessionArg)) : path.basename(sessionArg, '.jsonl');
  const proj   = isGrok ? path.basename(path.dirname(path.dirname(sessionArg))) : path.basename(path.dirname(sessionArg));
  const projLabel = isGrok
    ? decodeURIComponent(proj.replace(/%5C/gi, '/')).split(/[/\\]/).pop()
    : proj.split('--').pop();
  const harness = isGrok ? 'grok' : (sessionArg.includes('antigravity') ? 'antigravity' : 'claude-code');
  entry = { path: sessionArg, sessionId: sid, projSlug: proj, projLabel, harness };

} else if (sessionArg) {
  // Session ID prefix — search both harness pools
  const prefix = sessionArg.toLowerCase();
  const pool   = allSessions(harnessFilter);
  const match  = pool.find(s => s.sessionId.toLowerCase().startsWith(prefix));
  if (!match) {
    console.error(`No session found matching prefix "${sessionArg}" (harness: ${harnessFilter})`);
    console.error(`\nAvailable sessions (most recent first):`);
    pool.slice(0, 10).forEach(s => {
      const dt = new Date(s.mtime).toISOString().slice(0, 16).replace('T', ' ');
      console.error(`  ${dt}  [${s.harness.padEnd(11)}]  ${s.sessionId.slice(0, 8)}  [${s.projLabel}]`);
    });
    process.exit(1);
  }
  entry = match;

} else {
  // Auto-pick most recent
  const pool = allSessions(harnessFilter);
  if (!pool.length) { console.error('No session files found.'); process.exit(1); }
  entry = pool[0];
  console.error(`Auto-selected: [${entry.harness}]  ${entry.sessionId.slice(0, 8)}  [${entry.projLabel}]`);
}

// ── Load preset ───────────────────────────────────────────────────────────────
const preset = getPreset(presetSlug);
if (!preset) {
  console.error(`Unknown preset "${presetSlug}". Available: ${PRESET_SLUGS.join(', ')}`);
  process.exit(1);
}

// ── Load + parse JSONL ────────────────────────────────────────────────────────
const { path: jsonlPath, sessionId, projSlug, projLabel, harness } = entry;
const sid8 = sessionId.slice(0, 8);

const records = fs.readFileSync(jsonlPath, 'utf8')
  .split('\n')
  .filter(l => l.trim())
  .map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

// ── Run simulation ────────────────────────────────────────────────────────────
const ctx = { session_id: sessionId, slug: sid8, harness, project_id: projSlug, project_label: projLabel };
const { events, summary } = simulateSession(records, ctx, preset.settings, { mappings: preset.mappings });

// ── Build transcript ──────────────────────────────────────────────────────────
const header   = formatSnapshotHeader(sessionId, presetSlug, summary, preset.settings);
const lines    = formatTranscript(events);
const fullText = header + '\n' + lines.join('\n') + '\n';

// ── Output ────────────────────────────────────────────────────────────────────
function printSummary() {
  const harnessLabel = harness === 'grok' ? 'Grok' : harness === 'claude-code' ? 'Claude Code' : harness;
  console.log(`\n┌─ SESSION: ${sid8}  [${projLabel}]  (${harnessLabel})`);
  console.log(`│  PRESET: ${preset.name} — ${preset.tag}`);
  console.log(`│  scale=${preset.settings.scale}  noteMode=${preset.settings.noteMode}  bpm=${preset.settings.bpm}`);
  console.log(`├─ AUDIBLE EVENTS: ${summary.total}`);
  console.log(`│    tool_call: ${summary.tool_call}`);
  console.log(`│    tokens:    ${summary.tokens}`);
  console.log(`│    words:     ${summary.words}`);
  console.log(`└─ SILENT RECORDS: ${summary.silent}`);
  if (showSilent) {
    const silentTypes = {};
    for (const rec of records) {
      const t = rec.type || rec.method || '(unknown)';
      silentTypes[t] = (silentTypes[t] || 0) + 1;
    }
    console.log('\n  JSONL breakdown:');
    for (const [t, n] of Object.entries(silentTypes).sort((a, b) => b[1] - a[1])) {
      const audible = (t === 'assistant' || (harness === 'grok' && t === 'session/update'))
        ? ' (source of audio events)' : ' ← silent';
      console.log(`    ${t.padEnd(28)} ${n}${audible}`);
    }
  }
}

printSummary();

if (!summaryOnly) {
  if (outFile) {
    fs.writeFileSync(outFile, fullText, 'utf8');
    console.log(`\nTranscript written to ${outFile}`);
  } else {
    console.log('\n' + header);
    for (const line of lines) console.log(line);
  }
}

// ── Snapshot write ────────────────────────────────────────────────────────────
if (doSnap) {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const snapPath = path.join(SNAP_DIR, `${sid8}-${presetSlug}.snap`);
  fs.writeFileSync(snapPath, fullText, 'utf8');
  console.error(`\nSnapshot written: ${snapPath}`);
}

// ── Snapshot diff ─────────────────────────────────────────────────────────────
if (doDiff) {
  const snapPath = path.join(SNAP_DIR, `${sid8}-${presetSlug}.snap`);
  if (!fs.existsSync(snapPath)) {
    console.error(`\nNo snapshot to diff against: ${snapPath}`);
    console.error(`Run with --snap first to create it.`);
    process.exit(1);
  }

  const saved    = fs.readFileSync(snapPath, 'utf8');
  const savedLines = saved.split('\n').filter(l => !l.startsWith('#') && l.trim());
  const newLines   = fullText.split('\n').filter(l => !l.startsWith('#') && l.trim());

  if (savedLines.join('\n') === newLines.join('\n')) {
    console.error(`\n✓ Snapshot match (${newLines.length} events)`);
    process.exit(0);
  }

  const maxLen = Math.max(savedLines.length, newLines.length);
  let diffs = 0;
  console.error(`\n✗ Snapshot mismatch:`);
  for (let i = 0; i < maxLen; i++) {
    const s = savedLines[i] || '(missing)';
    const n = newLines[i]   || '(missing)';
    if (s !== n) {
      diffs++;
      if (diffs <= 20) {
        console.error(`  line ${i + 1}:`);
        console.error(`  - ${s}`);
        console.error(`  + ${n}`);
      }
    }
  }
  if (diffs > 20) console.error(`  ... and ${diffs - 20} more differences`);
  console.error(`  Total: ${diffs} line(s) changed`);
  process.exit(1);
}
