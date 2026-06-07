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

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const PORT           = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '3333');
const NO_OPEN        = process.argv.includes('--no-open');
const HARNESS        = process.argv.find(a => a.startsWith('--harness='))?.split('=')[1] ?? 'claude';
const IS_ANTIGRAVITY = HARNESS === 'antigravity';
const PROJECTS_DIR   = IS_ANTIGRAVITY
  ? path.join(os.homedir(), '.gemini', 'antigravity', 'brain')
  : path.join(os.homedir(), '.claude', 'projects');
const HTML_PATH      = path.join(__dirname, 'graph.html');
const DATA_PATH      = path.join(__dirname, 'graph-data.json');
const ANALYZE_SCRIPT = IS_ANTIGRAVITY
  ? path.join(__dirname, 'analyze-antigravity.mjs')
  : path.join(__dirname, 'analyze.mjs');
const BUILD_SCRIPT   = path.join(__dirname, 'build.mjs');

// ── SSE clients ───────────────────────────────────────────────────────────────

const clients = new Set();

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
  const label = IS_ANTIGRAVITY ? 'Antigravity brain directory' : 'Claude projects directory';
  const hint  = IS_ANTIGRAVITY ? 'Is the Antigravity agent installed?' : 'Is Claude Code installed?';
  console.error(`${label} not found: ${PROJECTS_DIR}`);
  console.error(hint);
  process.exit(1);
}

try {
  fs.watch(PROJECTS_DIR, { recursive: true }, (_, filename) => {
    if (!filename) return;
    const isLog = IS_ANTIGRAVITY
      ? (filename.endsWith('transcript.jsonl') || filename.endsWith('overview.txt'))
      : filename.endsWith('.jsonl');
    if (isLog) {
      console.log(`  changed: ${filename}`);
      const parts = filename.replace(/\\/g, '/').split('/');
      const sessionArg = (!IS_ANTIGRAVITY && parts.length === 2)
        ? `--session=${parts[0]}/${parts[1]}`
        : null;
      scheduleRebuild(sessionArg);
    }
  });
  console.log(`Watching: ${PROJECTS_DIR}`);
} catch (e) {
  console.warn(`Watch unavailable: ${e.message}`);
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
  console.log(`\n  kaaro-sessions [${HARNESS}] → ${url}\n`);

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
