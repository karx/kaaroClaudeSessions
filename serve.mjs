#!/usr/bin/env node
/**
 * serve.mjs — kaaro-sessions
 *
 * Single entry point: analyzes ~/.claude/projects/, builds the graph,
 * starts a live HTTP server, and opens the browser.
 * Watches for JSONL changes and pushes incremental updates via SSE.
 *
 * Usage:  node serve.mjs [--port=3333] [--no-open]
 *
 * Part of kaaro-sessions — a kaaroViewer companion tool.
 * https://github.com/kaaro/kaaroViewer
 */

import http         from 'http';
import fs           from 'fs';
import path         from 'path';
import os           from 'os';
import { execFile, exec } from 'child_process';
import { fileURLToPath }  from 'url';

import { tailRead }     from './lib/jsonl-tail.mjs';
import { parsePulse }   from './lib/pulse-parser.mjs';
import { deriveLabel }  from './analyze.mjs';
import { derivePiLabel, PI_SESSIONS_ROOT } from './analyze-pi.mjs';
import { reconstructContextTree } from './lib/context-tree.mjs';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const PORT           = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '3333');
const NO_OPEN        = process.argv.includes('--no-open');
const PROJECTS_DIR   = path.join(os.homedir(), '.claude', 'projects');
const HTML_PATH      = path.join(__dirname, 'graph.html');
const DATA_PATH      = path.join(__dirname, 'graph-data.json');
const ANALYZE_SCRIPT = path.join(__dirname, 'analyze.mjs');
const BUILD_SCRIPT   = path.join(__dirname, 'build.mjs');

// ── SSE clients ───────────────────────────────────────────────────────────────

const clients   = new Set();
const offsetMap = new Map(); // filePath → last-read byte offset

// ── Pulse helpers ─────────────────────────────────────────────────────────────

function ctxFromCcPath(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/');
  if (parts.length < 2) return null;
  const project_id = parts[0];
  const session_id = parts[1].replace(/\.jsonl$/, '');
  return { session_id, slug: session_id.slice(0, 8), project_id, project_label: deriveLabel(project_id) };
}

function ctxFromPiPath(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/');
  if (parts.length < 2) return null;
  const project_id = parts[0];
  const base       = parts[1].replace(/\.jsonl$/, '');
  const session_id = base.includes('_') ? base.slice(base.indexOf('_') + 1) : base;
  return { session_id, slug: session_id.slice(0, 8), project_id, project_label: derivePiLabel(project_id) };
}

function tailAndPulse(filePath, ctx) {
  const offset = offsetMap.get(filePath) ?? 0;
  try {
    const { records, newOffset } = tailRead(filePath, offset);
    offsetMap.set(filePath, newOffset);
    for (const rec of records)
      for (const pulse of parsePulse(rec, ctx))
        notify(pulse.event, JSON.stringify(pulse.data));
  } catch { /* tail errors must not affect the main rebuild flow */ }
}

function notify(event, data = '') {
  const payload = `event: ${event}\ndata: ${data}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// ── Rebuild pipeline ──────────────────────────────────────────────────────────

let rebuilding     = false;
let pendingRebuild = false;
let debounceTimer  = null;
let lastBuilt      = null;

function run(script, extraArgs = []) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, ...extraArgs], { cwd: __dirname }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (err) reject(err); else resolve();
    });
  });
}

let pendingSessionArg = null;

async function rebuild(sessionArg = null) {
  if (rebuilding) {
    pendingRebuild = true;
    // If any queued change needs a full scan (null) or two different sessions changed → full scan
    pendingSessionArg = (sessionArg === null || pendingSessionArg === null || pendingSessionArg !== sessionArg)
      ? null : sessionArg;
    return;
  }
  rebuilding = true;
  const t0 = Date.now();
  console.log(`\n[${new Date().toLocaleTimeString()}] Rebuilding…`);
  notify('status', 'rebuilding');

  try {
    const analyzeArgs = sessionArg ? [sessionArg] : [];
    await run(ANALYZE_SCRIPT, analyzeArgs);
    await run(BUILD_SCRIPT);
    lastBuilt = new Date();
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${clients.size} client(s) connected`);
    notify('updated', lastBuilt.toISOString());
  } catch (e) {
    console.error('Rebuild failed:', e.message);
    notify('error', e.message.slice(0, 200));
  } finally {
    rebuilding = false;
    if (pendingRebuild) {
      const arg = pendingSessionArg;
      pendingRebuild = false; pendingSessionArg = null;
      rebuild(arg);
    }
  }
}

function scheduleRebuild(sessionArg = null) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => rebuild(sessionArg), 1500);
}

// ── File watcher ──────────────────────────────────────────────────────────────

if (!fs.existsSync(PROJECTS_DIR)) {
  console.error(`Claude projects directory not found: ${PROJECTS_DIR}`);
  console.error('Is Claude Code installed?');
  process.exit(1);
}

try {
  fs.watch(PROJECTS_DIR, { recursive: true }, (_, filename) => {
    if (filename?.endsWith('.jsonl')) {
      console.log(`  changed: ${filename}`);
      const ctx = ctxFromCcPath(filename);
      if (ctx) tailAndPulse(path.join(PROJECTS_DIR, filename), ctx);
      const parts = filename.replace(/\\/g, '/').split('/');
      const sessionArg = parts.length === 2
        ? `--session=${parts[0]}/${parts[1]}`
        : null;
      scheduleRebuild(sessionArg);
    }
  });
  console.log(`Watching: ${PROJECTS_DIR}`);
} catch (e) {
  console.warn(`Watch unavailable: ${e.message}`);
}

// Optional Pi watcher — only if ~/.pi/agent/sessions/ exists
try {
  if (fs.existsSync(PI_SESSIONS_ROOT)) {
    fs.watch(PI_SESSIONS_ROOT, { recursive: true }, (_, filename) => {
      if (filename?.endsWith('.jsonl')) {
        const ctx = ctxFromPiPath(filename);
        if (ctx) tailAndPulse(path.join(PI_SESSIONS_ROOT, filename), ctx);
      }
    });
    console.log(`Watching Pi: ${PI_SESSIONS_ROOT}`);
  }
} catch (e) {
  console.warn(`Pi watch unavailable: ${e.message}`);
}

// ── /api/trace cache + resolver ───────────────────────────────────────────────

const traceCache = new Map(); // filePath → { mtime, tree }

function resolveSessionFile(sessionId) {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  for (const proj of fs.readdirSync(PROJECTS_DIR)) {
    const projPath = path.join(PROJECTS_DIR, proj);
    try {
      if (!fs.statSync(projPath).isDirectory()) continue;
    } catch { continue; }
    const candidate = path.join(projPath, sessionId + '.jsonl');
    if (fs.existsSync(candidate)) return { filePath: candidate, projectId: proj };
    // also check subagents/ subdir
    const subCandidate = path.join(projPath, 'subagents', sessionId + '.jsonl');
    if (fs.existsSync(subCandidate)) return { filePath: subCandidate, projectId: proj };
  }
  return null;
}

function buildTrace(filePath, projectId, sessionId) {
  try {
    const mtime = fs.statSync(filePath).mtimeMs;
    const cached = traceCache.get(filePath);
    if (cached && cached.mtime === mtime) return cached.tree;

    const { records } = tailRead(filePath, 0);
    const tree = { session_id: sessionId, project_id: projectId, ...reconstructContextTree(records) };
    traceCache.set(filePath, { mtime, tree });
    return tree;
  } catch (e) {
    return null;
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(':\n\n');
    res.write('event: connected\ndata: ok\n\n');
    clients.add(res);
    const hb = setInterval(() => {
      try { res.write(':\n\n'); } catch { clearInterval(hb); clients.delete(res); }
    }, 25_000);
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
    return;
  }

  if (req.url.startsWith('/graph-data.json')) {
    if (!fs.existsSync(DATA_PATH)) { res.writeHead(503); res.end('{}'); return; }
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(DATA_PATH));
    } catch (e) { res.writeHead(500); res.end(e.message); }
    return;
  }

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rebuilding, lastBuilt, clients: clients.size, port: PORT }));
    return;
  }

  if (req.url.startsWith('/api/trace/')) {
    const sessionId = decodeURIComponent(req.url.slice('/api/trace/'.length)).replace(/\.jsonl$/, '');
    if (!sessionId) { res.writeHead(400); res.end('missing session_id'); return; }
    const found = resolveSessionFile(sessionId);
    if (!found) { res.writeHead(404); res.end('session not found'); return; }
    const tree = buildTrace(found.filePath, found.projectId, sessionId);
    if (!tree) { res.writeHead(500); res.end('reconstruction failed'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(tree));
    return;
  }

  if (req.url === '/' || req.url === '/graph.html') {
    if (!fs.existsSync(HTML_PATH)) {
      res.writeHead(503, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font:14px monospace;padding:40px;background:#111;color:#ccc"><h2>Building…</h2><p>Refresh in a few seconds.</p><script>setTimeout(()=>location.reload(),3000)</script></body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(HTML_PATH));
    return;
  }

  // ── Static assets (favicon, manifest, og-image, robots, generate helper) ────
  const STATIC_MIME = {
    svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json',
    txt: 'text/plain', html: 'text/html; charset=utf-8',
  };
  const STATIC_MAP = {
    '/favicon.svg':          'favicon.svg',
    '/og-image.png':         'og-image.png',
    '/site.webmanifest':     'site.webmanifest',
    '/robots.txt':           'robots.txt',
    '/generate-og-png.html': 'generate-og-png.html',
    '/src/og-image.svg':     'src/og-image.svg',
  };
  const staticRel = STATIC_MAP[req.url.split('?')[0]];
  if (staticRel) {
    const fp = path.join(__dirname, staticRel);
    if (fs.existsSync(fp)) {
      const ext = path.extname(fp).slice(1).toLowerCase();
      res.writeHead(200, { 'Content-Type': STATIC_MIME[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(fp));
      return;
    }
  }

  res.writeHead(404); res.end('Not found');
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  kaaro-sessions → ${url}\n`);

  if (!NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start ${url}`
              : process.platform === 'darwin' ? `open ${url}`
              : `xdg-open ${url}`;
    exec(cmd);
  }

  rebuild();
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} in use. Try --port=3334`);
    process.exit(1);
  }
  throw e;
});
