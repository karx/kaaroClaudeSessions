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

import { getEnabledHarnesses } from './hooks/registry.mjs';
import { processWatchFilename } from './surface/watch-handlers.mjs';
import { resolveSessionFile, invalidateSessionResolveCache } from './surface/session-resolver.mjs';
import { createActiveState } from './surface/active-state.mjs';
import { createHub } from './surface/sse-hub.mjs';
import { createPulseEmitter } from './surface/pulse-emitter.mjs';
import { createRebuilder } from './surface/rebuild-orchestrator.mjs';
import { createRequestHandler } from './surface/http-routes.mjs';
import { createTraceService } from './surface/trace-service.mjs';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const PORT           = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '3333');
const NO_OPEN        = process.argv.includes('--no-open');
const HTML_PATH      = path.join(__dirname, 'graph.html');
const DATA_PATH      = path.join(__dirname, 'graph-data.json');
const ANALYZE_SCRIPT = path.join(__dirname, 'analyze.mjs');
const BUILD_SCRIPT   = path.join(__dirname, 'build.mjs');

// ── SSE clients ───────────────────────────────────────────────────────────────

const hub = createHub();

// ── Pulse path (Stream) ───────────────────────────────────────────────────────
// Mission Control active-session state (/api/active + SSE `now`) + pulses.

const activeState = createActiveState();
const { tailAndPulse } = createPulseEmitter({ hub, activeState });

// ── Rebuild pipeline ──────────────────────────────────────────────────────────

function run(script, extraArgs = []) {
  return new Promise((resolve, reject) => {
    // --disable-warning: node:sqlite (copilot index) emits an ExperimentalWarning per process
    execFile(process.execPath, ['--disable-warning=ExperimentalWarning', script, ...extraArgs], { cwd: __dirname }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (err) reject(err); else resolve();
    });
  });
}

const rebuilder = createRebuilder({
  hub, runScript: run, analyzeScript: ANALYZE_SCRIPT, buildScript: BUILD_SCRIPT,
});
const { rebuild, scheduleRebuild } = rebuilder;

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

// ── /api/trace (registry-driven; see surface/trace-service.mjs) ──────────────

const { buildTrace } = createTraceService();

// ── HTTP server (routes live in surface/http-routes.mjs) ─────────────────────

const server = http.createServer(createRequestHandler({
  hub,
  activeState,
  getStatus: () => ({ ...rebuilder.state, clients: hub.size, port: PORT }),
  paths: {
    root: __dirname,
    html: HTML_PATH,
    data: DATA_PATH,
    daw:  path.join(__dirname, 'daw-builder.html'),
    now:  path.join(__dirname, 'now.html'), // built artifact (token-substituted)
  },
  resolveSessionFile,
  buildTrace,
}));

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
