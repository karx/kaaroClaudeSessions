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
const PROJECTS_DIR   = path.join(os.homedir(), '.claude', 'projects');
const HTML_PATH      = path.join(__dirname, 'graph.html');
const DATA_PATH      = path.join(__dirname, 'graph-data.json');
const ANALYZE_SCRIPT = path.join(__dirname, 'analyze.mjs');
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

function run(script) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script], { cwd: __dirname }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (err) reject(err); else resolve();
    });
  });
}

async function rebuild() {
  if (rebuilding) { pendingRebuild = true; return; }
  rebuilding = true;
  const t0 = Date.now();
  console.log(`\n[${new Date().toLocaleTimeString()}] Rebuilding…`);
  notify('status', 'rebuilding');

  try {
    await run(ANALYZE_SCRIPT);
    await run(BUILD_SCRIPT);
    lastBuilt = new Date();
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${clients.size} client(s) connected`);
    notify('updated', lastBuilt.toISOString());
  } catch (e) {
    console.error('Rebuild failed:', e.message);
    notify('error', e.message.slice(0, 200));
  } finally {
    rebuilding = false;
    if (pendingRebuild) { pendingRebuild = false; rebuild(); }
  }
}

function scheduleRebuild() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(rebuild, 1500);
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
      scheduleRebuild();
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
