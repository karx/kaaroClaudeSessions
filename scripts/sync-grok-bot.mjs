#!/usr/bin/env node
// scripts/sync-grok-bot.mjs - sanitized Grok Bot agent-data mirror.
// Copies jsonl transcripts and profile.json only. Skips secrets/sqlite.
// Usage: node scripts/sync-grok-bot.mjs [--once|--watch] [--interval=5000] [--src=DIR] [--dest=DIR]
//          [--serve [-- --port=3333]]


import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__DIR, '..');

export const DEFAULT_SRC = '/home/box/agent-data';
export const DEFAULT_DEST = path.join(REPO, '.local', 'grok-bot-agent-data');
export const DEFAULT_INTERVAL_MS = 5000;
const SKIP_NAMES = new Set([
  'box-secrets.json', 'host-secrets.json', 'sand-secrets.json',
  'box-secrets-push-state.v1.json',
]);

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    watch: false, once: false, serve: false, junctions: true,
    interval: DEFAULT_INTERVAL_MS,
    src: process.env.GROK_BOT_AGENT_DATA_SRC || DEFAULT_SRC,
    dest: process.env.GROK_BOT_AGENT_DATA || DEFAULT_DEST,
    serveArgs: [],
    destSet: !!process.env.GROK_BOT_AGENT_DATA,
  };
  let serveTail = false;
  for (const a of argv) {
    if (serveTail) { opts.serveArgs.push(a); continue; }
    if (a === '--') { serveTail = true; continue; }
    if (a === '--watch') opts.watch = true;
    else if (a === '--once') opts.once = true;
    else if (a === '--serve') opts.serve = true;
    else if (a === '--no-junctions') opts.junctions = false;
    else if (a.startsWith('--interval=')) opts.interval = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--src=')) opts.src = a.slice('--src='.length);
    else if (a.startsWith('--dest=')) { opts.dest = a.slice('--dest='.length); opts.destSet = true; }
    else throw new Error('unknown arg: ' + a);
  }
  if (!opts.watch && !opts.once) opts.once = !opts.serve;
  return opts;
}

export function resolvePaths(input) {
  const src = input.src;
  const destSet = !!input.destSet;
  const srcExists = !!(src && fs.existsSync(src));
  if (!destSet && srcExists) return { src: src, dest: src, mode: 'direct' };
  const d = input.dest || DEFAULT_DEST;
  try {
    if (srcExists && fs.existsSync(d) && fs.realpathSync(src) === fs.realpathSync(d)) {
      return { src: src, dest: d, mode: 'direct' };
    }
  } catch (e) { /* fall through */ }
  if (path.resolve(src) === path.resolve(d)) return { src: src, dest: d, mode: 'direct' };
  return { src: src, dest: d, mode: 'copy' };
}
function shouldSkip(name) {
  if (SKIP_NAMES.has(name)) return true;
  if (name.endsWith('.journal-mode')) return true;
  if (name.endsWith('-wal') || name.endsWith('-shm')) return true;
  if (name.endsWith('.db') || name.endsWith('.db-wal') || name.endsWith('.db-shm')) return true;
  return false;
}

function listCopyJobs(src) {
  const jobs = [];
  const transcripts = path.join(src, 'agent-transcripts');
  if (fs.existsSync(transcripts)) {
    for (const dirent of fs.readdirSync(transcripts, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const dir = path.join(transcripts, dirent.name);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        if (shouldSkip(f)) continue;
        jobs.push({ rel: path.join('agent-transcripts', dirent.name, f), abs: path.join(dir, f) });
      }
    }
  }
  const agents = path.join(src, 'agents');
  if (fs.existsSync(agents)) {
    for (const dirent of fs.readdirSync(agents, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const profile = path.join(agents, dirent.name, 'profile.json');
      if (!fs.existsSync(profile)) continue;
      jobs.push({ rel: path.join('agents', dirent.name, 'profile.json'), abs: profile });
    }
  }
  return jobs;
}
function sameFile(srcPath, destPath) {
  try {
    return fs.statSync(srcPath).size === fs.statSync(destPath).size;
  } catch { return false; }
}

function copyAtomic(srcPath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = destPath + '.tmp';
  fs.copyFileSync(srcPath, tmp);
  try { const st = fs.statSync(srcPath); fs.utimesSync(tmp, st.atime, st.mtime); } catch { /* optional */ }
  fs.renameSync(tmp, destPath);
}

export function syncOnce(src, dest) {
  const resolved = resolvePaths({ src: src, dest: dest, destSet: true });
  if (resolved.mode === 'direct') return { copied: 0, skipped: 0, dest: dest, src: src, jobs: 0, mode: 'direct' };
  if (!src || !fs.existsSync(src)) {
    const err = new Error('Grok Bot agent-data not found: ' + src + '\nSet GROK_BOT_AGENT_DATA_SRC to a copied or mounted agent-data tree.');
    err.code = 'SRC_MISSING';
    throw err;
  }
  fs.mkdirSync(dest, { recursive: true });
  const jobs = listCopyJobs(src);
  let copied = 0, skipped = 0;
  for (const job of jobs) {
    const destPath = path.join(dest, job.rel);
    if (sameFile(job.abs, destPath)) { skipped++; continue; }
    copyAtomic(job.abs, destPath);
    copied++;
  }
  return { copied: copied, skipped: skipped, dest: dest, src: src, jobs: jobs.length, mode: 'copy' };
}
export function linkSubagents(dest) {
  const transcripts = path.join(dest, 'agent-transcripts');
  const localRoot = path.dirname(dest);
  const linked = [];
  if (!fs.existsSync(transcripts)) return linked;
  for (const dirent of fs.readdirSync(transcripts, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    if (!dirent.name.startsWith('sand-subagent-')) continue;
    const target = path.join(transcripts, dirent.name);
    const link = path.join(localRoot, dirent.name);
    try {
      const st = fs.lstatSync(link);
      if (st.isSymbolicLink() || st.isDirectory()) continue;
    } catch (e) { /* missing is fine */ }
    try { fs.symlinkSync(target, link, 'junction'); linked.push(dirent.name); }
    catch (e1) {
      try { fs.symlinkSync(target, link); linked.push(dirent.name); }
      catch (e2) { /* non-fatal */ }
    }
  }
  return linked;
}
function logCycle(stats) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log('[' + ts + '] grok-bot sync  copied=' + stats.copied + '  unchanged=' + stats.skipped + '  dest=' + stats.dest);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

export async function watchLoop(opts) {
  for (;;) {
    try {
      const stats = syncOnce(opts.src, opts.dest);
      if (opts.junctions) linkSubagents(opts.dest);
      logCycle(stats);
    } catch (e) { console.error(e.message || e); }
    await sleep(opts.interval);
  }
}

function spawnServe(dest, serveArgs) {
  const child = spawn(process.execPath, ['serve.mjs'].concat(serveArgs || []), {
    cwd: REPO,
    env: Object.assign({}, process.env, { GROK_BOT_AGENT_DATA: dest }),
    stdio: 'inherit',
  });
  child.on('exit', function (code) { process.exit(code || 0); });
  return child;
}

async function main() {
  const opts = parseArgs();
  const resolved = resolvePaths({ src: opts.src, dest: opts.dest, destSet: opts.destSet });
  opts.src = resolved.src;
  opts.dest = resolved.dest;
  if (resolved.mode === 'direct') {
    console.log('[grok-bot] direct watch  ' + resolved.dest + '  (no copy, fs.watch tails live jsonl)');
    if (opts.serve) spawnServe(resolved.dest, opts.serveArgs);
    else if (opts.watch) console.log('[grok-bot] --watch is a no-op in direct mode');
    return;
  }
  try {
    const stats = syncOnce(opts.src, opts.dest);
    if (opts.junctions) linkSubagents(opts.dest);
    logCycle(stats);
  } catch (e) {
    console.error(e.message || e);
    if (!opts.watch) process.exit(1);
  }
  if (opts.serve) spawnServe(opts.dest, opts.serveArgs);
  if (opts.watch) await watchLoop(opts);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
