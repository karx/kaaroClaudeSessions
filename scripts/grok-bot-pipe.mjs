#!/usr/bin/env node
// scripts/grok-bot-pipe.mjs - PIPE: box packer + pc lander for Grok Bot agent-data.
// Sanitize-copy jsonl + profile.json onto a staging dest. Never rewrite agent-data.
// Usage: node scripts/grok-bot-pipe.mjs [init|box|pc] [--watch] [--once] [--interval=5000]
//          [--src=DIR] [--dest=DIR] [--serve [-- --port=3333]]

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import {
  DEFAULT_SRC,
  DEFAULT_DEST,
  DEFAULT_INTERVAL_MS,
  syncOnce,
  resolvePaths,
} from "./sync-grok-bot.mjs";

const __DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__DIR, "..");

export const DEFAULT_BOX_STAGING = process.env.KAARO_GROK_BOT_PIPE_STAGING || "/workspace/kaaro-grok-bot-pipe";

export function detectSide({ agentData, existsFn } = {}) {
  const p = agentData || DEFAULT_SRC;
  const exists = typeof existsFn === "function" ? existsFn(p) : fs.existsSync(p);
  return exists ? "box" : "pc";
}

export function parsePipeArgs(argv = process.argv.slice(2)) {
  const opts = {
    cmd: "init",
    watch: false,
    once: false,
    serve: false,
    interval: DEFAULT_INTERVAL_MS,
    src: process.env.GROK_BOT_AGENT_DATA_SRC || DEFAULT_SRC,
    dest: undefined,
    destSet: false,
    serveArgs: [],
  };
  let serveTail = false;
  for (const a of argv) {
    if (serveTail) { opts.serveArgs.push(a); continue; }
    if (a === "--") { serveTail = true; continue; }
    if (a === "init" || a === "box" || a === "pc") opts.cmd = a;
    else if (a === "--watch") opts.watch = true;
    else if (a === "--once") opts.once = true;
    else if (a === "--serve") opts.serve = true;
    else if (a.startsWith("--interval=")) opts.interval = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--src=")) opts.src = a.slice("--src=".length);
    else if (a.startsWith("--dest=")) { opts.dest = a.slice("--dest=".length); opts.destSet = true; }
    else throw new Error("unknown arg: " + a);
  }
  return opts;
}

export function initPlan({ existsFn, agentData, repo } = {}) {
  const src = agentData || DEFAULT_SRC;
  const side = detectSide({ agentData: src, existsFn });
  const pcDest = repo ? path.join(repo, ".local", "grok-bot-agent-data") : DEFAULT_DEST;
  if (side === "box") {
    return {
      side: "box",
      next: "box",
      src: src,
      dest: DEFAULT_BOX_STAGING,
      mode: "copy",
      thisCommand: "node scripts/grok-bot-pipe.mjs box --watch",
      otherCommand: "node scripts/grok-bot-pipe.mjs pc --serve -- --port=3333",
    };
  }
  return {
    side: "pc",
    next: "pc",
    src: src,
    dest: pcDest,
    mode: "copy",
    thisCommand: "node scripts/grok-bot-pipe.mjs pc --serve -- --port=3333",
    otherCommand: "node scripts/grok-bot-pipe.mjs box --watch",
  };
}

function listPackedFiles(dest) {
  const files = [];
  if (!dest || !fs.existsSync(dest)) return files;
  const transcripts = path.join(dest, "agent-transcripts");
  if (fs.existsSync(transcripts)) {
    for (const dirent of fs.readdirSync(transcripts, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const dir = path.join(transcripts, dirent.name);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        const abs = path.join(dir, f);
        files.push({ rel: path.join("agent-transcripts", dirent.name, f), size: fs.statSync(abs).size });
      }
    }
  }
  const agents = path.join(dest, "agents");
  if (fs.existsSync(agents)) {
    for (const dirent of fs.readdirSync(agents, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const abs = path.join(agents, dirent.name, "profile.json");
      if (!fs.existsSync(abs)) continue;
      files.push({ rel: path.join("agents", dirent.name, "profile.json"), size: fs.statSync(abs).size });
    }
  }
  return files;
}

export function writeStatus(dest, stats) {
  const files = stats.files || listPackedFiles(dest);
  const status = {
    side: "box",
    copied: stats.copied || 0,
    skipped: stats.skipped || 0,
    jobs: stats.jobs || 0,
    src: stats.src,
    dest: dest,
    ts: new Date().toISOString(),
    files: files,
  };
  fs.mkdirSync(dest, { recursive: true });
  const statusPath = path.join(dest, "pipe-status.json");
  const tmp = statusPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2));
  fs.renameSync(tmp, statusPath);
  return statusPath;
}

export function boxPack(src, dest) {
  const resolved = resolvePaths({ src: src, dest: dest, destSet: true });
  if (resolved.mode === "direct") {
    return { ok: false, mode: "direct", error: "box packer must copy onto a staging dest, not src" };
  }
  const stats = syncOnce(src, dest);
  const files = listPackedFiles(dest);
  const statusPath = writeStatus(dest, Object.assign({}, stats, { files: files }));
  return Object.assign({ ok: true }, stats, { files: files, statusPath: statusPath });
}

function logPack(stats) {
  const ts = new Date().toISOString().slice(11, 19);
  if (stats && stats.ok === false) {
    console.error("[" + ts + "] grok-bot pipe  " + (stats.error || stats.mode));
    return;
  }
  console.log("[" + ts + "] grok-bot pipe  copied=" + stats.copied + "  unchanged=" + stats.skipped + "  dest=" + stats.dest);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function packWatchLoop(src, dest, interval) {
  for (;;) {
    try {
      const stats = boxPack(src, dest);
      logPack(stats);
    } catch (e) { console.error(e.message || e); }
    await sleep(interval);
  }
}

function spawnServe(dest, serveArgs) {
  const child = spawn(process.execPath, ["serve.mjs"].concat(serveArgs || []), {
    cwd: REPO,
    env: Object.assign({}, process.env, { GROK_BOT_AGENT_DATA: dest }),
    stdio: "inherit",
  });
  child.on("exit", function (code) { process.exit(code || 0); });
  return child;
}

function printInit(plan) {
  console.log('Grok Bot PIPE');
  console.log('  side:  ' + plan.side);
  console.log('  src:   ' + plan.src);
  console.log('  dest:  ' + plan.dest);
  console.log('  mode:  ' + plan.mode);
  console.log('');
  console.log('  this machine:  ' + plan.thisCommand);
  console.log('                 (or npm run grok-bot:' + plan.next + ')');
  console.log('  other machine: ' + plan.otherCommand);
  console.log('');
  if (plan.side === "box") {
    console.log('  Packer copies jsonl + profile.json onto staging. Secrets never cross.');
    console.log('  Transport: CopyFromBox staging -> PC .local/grok-bot-agent-data');
  } else {
    console.log('  PC lands sanitized files in .local/grok-bot-agent-data; serve.mjs watches them.');
    console.log('  Do not copy from /home/box/agent-data on this machine - it will not exist.');
  }
}

async function runPc(opts, dest) {
  fs.mkdirSync(dest, { recursive: true });
  process.env.GROK_BOT_AGENT_DATA = dest;
  const srcExists = !!(opts.src && fs.existsSync(opts.src));
  if (srcExists) {
    const resolved = resolvePaths({ src: opts.src, dest: dest, destSet: true });
    if (resolved.mode === 'direct') {
      console.log('[grok-bot pipe] direct watch  ' + dest + '  (src exists on this machine, no copy)');
    } else {
      try {
        const stats = syncOnce(opts.src, dest);
        logPack(Object.assign({ ok: true }, stats));
      } catch (e) {
        console.error(e.message || e);
        if (!opts.watch && !opts.serve) process.exit(1);
      }
    }
  } else if (opts.watch) {
    console.log('[grok-bot pipe] PC watches .local via serve; not copying from ' + opts.src + ' (not on this machine)');
  } else {
    console.log('[grok-bot pipe] dest=' + dest + '  GROK_BOT_AGENT_DATA set');
    console.log('[grok-bot pipe] land sanitized files here (CopyFromBox staging, then move into this dest)');
  }
  if (opts.serve) spawnServe(dest, opts.serveArgs);
  if (opts.watch && srcExists) {
    for (;;) {
      try {
        const stats = syncOnce(opts.src, dest);
        logPack(Object.assign({ ok: true }, stats));
      } catch (e) { console.error(e.message || e); }
      await sleep(opts.interval);
    }
  }
}

async function main() {
  const opts = parsePipeArgs();
  const cmd = opts.cmd;

  if (cmd === 'init') {
    const plan = initPlan({ agentData: opts.src, repo: REPO });
    if (opts.destSet) plan.dest = opts.dest;
    printInit(plan);
    if (plan.side === 'pc') {
      fs.mkdirSync(plan.dest, { recursive: true });
      console.log('  mkdir ' + plan.dest);
    }
    if (opts.watch || opts.serve) {
      if (plan.next === 'box') {
        const dest = opts.destSet ? opts.dest : DEFAULT_BOX_STAGING;
        const packed = boxPack(opts.src, dest);
        logPack(packed);
        if (opts.watch) await packWatchLoop(opts.src, dest, opts.interval);
      } else {
        await runPc(opts, plan.dest);
      }
    }
    return;
  }

  if (cmd === 'box') {
    const dest = opts.destSet ? opts.dest : DEFAULT_BOX_STAGING;
    const packed = boxPack(opts.src, dest);
    logPack(packed);
    if (packed.ok === false && !opts.watch) process.exit(1);
    if (opts.watch) await packWatchLoop(opts.src, dest, opts.interval);
    return;
  }

  if (cmd === 'pc') {
    await runPc(opts, opts.destSet ? opts.dest : DEFAULT_DEST);
    return;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
