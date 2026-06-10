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
import { execFile, exec } from 'child_process';
import { fileURLToPath }  from 'url';

import { tailRead }             from './lib/jsonl-tail.mjs';
import { normRecordsToPulses } from './lib/pulse-transformer.mjs';
import { recordsToNormalized as ccNorm }   from './adapters/claude-code.mjs';
import { recordsToNormalized as piNorm }   from './adapters/pi.mjs';
import { recordsToNormalized as agNorm }   from './adapters/antigravity.mjs';
import { recordsToNormalized as grokNorm } from './adapters/grok.mjs';
import { reconstructTraceTree } from './lib/context-tree.mjs';
import { readGrokSession } from './analyze-grok.mjs';
import { getEnabledHarnesses, getHarness } from './lib/harness-registry.mjs';
import { processWatchFilename } from './lib/watch-handlers.mjs';
import { resolveSessionFile, invalidateSessionResolveCache } from './lib/session-resolver.mjs';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const PORT           = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '3333');
const NO_OPEN        = process.argv.includes('--no-open');
const HTML_PATH      = path.join(__dirname, 'graph.html');
const DATA_PATH      = path.join(__dirname, 'graph-data.json');
const ANALYZE_SCRIPT = path.join(__dirname, 'analyze.mjs');
const BUILD_SCRIPT   = path.join(__dirname, 'build.mjs');

// ── SSE clients ───────────────────────────────────────────────────────────────

const clients   = new Set();
const offsetMap = new Map(); // filePath → last-read byte offset

// ── Pulse helpers ─────────────────────────────────────────────────────────────

const NR_ADAPTERS_SERVE = {
  'claude-code': ccNorm,
  'pi':          piNorm,
  'antigravity': agNorm,
  'grok':        grokNorm,
};

const HARNESS_CAPS_SERVE = {
  'claude-code': { tokens: true  },
  'pi':          { tokens: true  },
  'antigravity': { tokens: false },
  'grok':        { tokens: false },
};

function tailAndPulse(filePath, ctx) {
  const offset = offsetMap.get(filePath) ?? 0;
  try {
    const { records, newOffset } = tailRead(filePath, offset);
    offsetMap.set(filePath, newOffset);
    if (!records.length) return;
    const harness = ctx.harness || 'claude-code';
    const adaptFn = NR_ADAPTERS_SERVE[harness] ?? ccNorm;
    const caps    = HARNESS_CAPS_SERVE[harness] ?? { tokens: true };
    const nrs     = adaptFn(records);
    for (const pulse of normRecordsToPulses(nrs, ctx, caps))
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

async function rebuild(target = null) {
  if (rebuilding) {
    pendingRebuild = true;
    return;
  }
  rebuilding = true;
  const t0 = Date.now();
  console.log(`\n[${new Date().toLocaleTimeString()}] Rebuilding…`);
  notify('status', 'rebuilding');

  try {
    // Use targeted arg (e.g. --session=...) when provided by watch handler.
    // analyze.mjs will take the fast path (parseSessionFlag + mergeSessionIntoData)
    // for supported cases instead of a full multi-harness scan.
    const analyzeArgs = target?.rebuildArg ? [target.rebuildArg] : ['--all-harnesses'];
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
      pendingRebuild = false;
      rebuild();
    }
  }
}

function scheduleRebuild(target = null) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => rebuild(target), 1500);
}

// ── File watcher (registry-driven) ────────────────────────────────────────────

function handleWatchEvent(harnessId, rootDir, filename) {
  const event = processWatchFilename(harnessId, filename, rootDir);
  if (!event) return;
  console.log(`  changed: [${harnessId}] ${event.relPath}`);
  tailAndPulse(event.absPath, event.ctx);

  // Surgical cache invalidation: only evict the session whose file just changed.
  // Other cached resolutions remain valid and fast.
  invalidateSessionResolveCache(event.ctx.session_id);

  // Prefer targeted rebuild when the harness provides a rebuildArg (e.g. --session=...).
  // This enables the fast incremental path in analyze for supported harnesses (CC today)
  // instead of always doing a full --all-harnesses scan on every keystroke.
  if (event.rebuildArg) {
    scheduleRebuild({ rebuildArg: event.rebuildArg });
  } else {
    scheduleRebuild();
  }
}

let watchCount = 0;
for (const harness of getEnabledHarnesses()) {
  const root = harness.roots[0];
  if (!root) continue;
  try {
    if (!fs.existsSync(root)) {
      console.warn(`[${harness.id}] root not found — skipped: ${root}`);
      continue;
    }
    fs.watch(root, { recursive: true }, (_, filename) => {
      handleWatchEvent(harness.id, root, filename);
    });
    console.log(`Watching [${harness.id}]: ${root}`);
    watchCount++;
  } catch (e) {
    console.warn(`[${harness.id}] watch unavailable: ${e.message}`);
  }
}

if (!watchCount) {
  console.warn('No harness directories found — live watch disabled');
}

// ── /api/trace cache + resolver ───────────────────────────────────────────────

const traceCache = new Map(); // filePath → { mtime, tree }

function buildTrace(filePath, projectId, sessionId, harness = 'claude-code') {
  try {
    const mtime = fs.statSync(filePath).mtimeMs;
    const cached = traceCache.get(filePath);
    if (cached && cached.mtime === mtime) return cached.tree;

    let records;
    let traceOpts = {};
    if (harness === 'grok') {
      const grok = readGrokSession(path.dirname(filePath));
      records = grok.records;
      traceOpts = {
        ai_title:    grok.summary?.generated_title || grok.summary?.session_summary || null,
        git_branch:  grok.summary?.head_branch || null,
      };
    } else {
      ({ records } = tailRead(filePath, 0));
    }

    const tree = {
      session_id: sessionId,
      project_id: projectId,
      ...reconstructTraceTree(records, harness, traceOpts),
    };
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
    const harness = getHarness(found.harness);
    if (!harness?.capabilities?.trace) {
      res.writeHead(404); res.end('trace not supported for this harness'); return;
    }
    const tree = buildTrace(found.filePath, found.projectId, sessionId, found.harness);
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

  // ── Dedicated Live Pulse DAW Builder (pure event stream, no graph) ─────────
  if (req.url === '/daw' || req.url === '/daw-builder' || req.url === '/audio' || req.url === '/builder') {
    const dawPath = path.join(__dirname, 'daw-builder.html');
    if (!fs.existsSync(dawPath)) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font:14px monospace;padding:40px;background:#080810;color:#9aa0b8"><h2>DAW Builder not built yet</h2><p>Run <code>node build.mjs</code> (or the serve will trigger a build on next request in future).</p><p><a href="/" style="color:#4455cc">Back to main graph</a></p></body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(dawPath));
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
