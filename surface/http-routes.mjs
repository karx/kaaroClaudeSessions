/**
 * surface/http-routes.mjs — the Snapshot read surface (HTTP routes).
 *
 * All routes moved verbatim from serve.mjs; serve composes the deps.
 * The experience layer consumes ONLY these endpoints + the SSE Stream —
 * /api/harnesses exposes the registry (id, label, capabilities) so the UI
 * can be capability-driven without reaching into harness specifics.
 */
import fs   from 'fs';
import path from 'path';

import { HARNESS_REGISTRY, getHarness } from '../hooks/registry.mjs';
import { snapshotActive } from './active-state.mjs';

const JSON_HEADERS = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-cache',
  'Access-Control-Allow-Origin': '*',
};

/**
 * @param {object} deps
 * @param {{ addClient: Function, notify: Function, size: number }} deps.hub
 * @param {object} deps.activeState
 * @param {() => { rebuilding: boolean, lastBuilt: any, clients: number, port: number }} deps.getStatus
 * @param {{ root: string, html: string, data: string, daw: string, now: string }} deps.paths
 * @param {(sessionId: string) => object|null} deps.resolveSessionFile
 * @param {(filePath: string, projectId: string|null, sessionId: string, harness: string) => object|null} deps.buildTrace
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => void}
 */
export function createRequestHandler({ hub, activeState, getStatus, paths, resolveSessionFile, buildTrace }) {
  return (req, res) => {
    if (req.url === '/events') {
      hub.addClient(res, req);
      return;
    }

    if (req.url.startsWith('/graph-data.json')) {
      if (!fs.existsSync(paths.data)) { res.writeHead(503); res.end('{}'); return; }
      try {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(fs.readFileSync(paths.data));
      } catch (e) { res.writeHead(500); res.end(e.message); }
      return;
    }

    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getStatus()));
      return;
    }

    if (req.url === '/api/active') {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify(snapshotActive(activeState, Date.now())));
      return;
    }

    // Registry as the experience layer's source of truth: id, label,
    // capabilities only (watch config / adapters are backend-internal).
    if (req.url === '/api/harnesses') {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({
        harnesses: HARNESS_REGISTRY.map(h => ({
          id: h.id, label: h.label, capabilities: h.capabilities,
        })),
      }));
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
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify(tree));
      return;
    }

    if (req.url === '/' || req.url === '/graph' || req.url === '/graph.html' || req.url === '/home') {
      // / is the landing page; /graph (+ old /graph.html bookmarks) is the
      // history view. While home.html is not built yet, / falls back to the graph.
      if ((req.url === '/' || req.url === '/home') && paths.home && fs.existsSync(paths.home)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(fs.readFileSync(paths.home));
        return;
      }
      if (!fs.existsSync(paths.html)) {
        res.writeHead(503, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font:14px monospace;padding:40px;background:#111;color:#ccc"><h2>Building…</h2><p>Refresh in a few seconds.</p><script>setTimeout(()=>location.reload(),3000)</script></body></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(paths.html));
      return;
    }

    // ── Dedicated Live Pulse DAW Builder (pure event stream, no graph) ─────────
    if (req.url === '/daw' || req.url === '/daw-builder' || req.url === '/audio' || req.url === '/builder') {
      if (!fs.existsSync(paths.daw)) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font:14px monospace;padding:40px;background:#080810;color:#9aa0b8"><h2>DAW Builder not built yet</h2><p>Run <code>node build.mjs</code> (or the serve will trigger a build on next request in future).</p><p><a href="/graph" style="color:#ff6600">Back to the graph</a></p></body></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(paths.daw));
      return;
    }

    // ── Mission Control (/now): live active-session board ──────────────────────
    if (req.url === '/now' || req.url === '/mission' || req.url === '/active') {
      if (!fs.existsSync(paths.now)) { res.writeHead(404); res.end('now.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(paths.now));
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
      '/src/og-image.svg':     'experience/pages/og-image.svg', // legacy URL kept for OG meta consumers
    };
    const staticRel = STATIC_MAP[req.url.split('?')[0]];
    if (staticRel) {
      const fp = path.join(paths.root, staticRel);
      if (fs.existsSync(fp)) {
        const ext = path.extname(fp).slice(1).toLowerCase();
        res.writeHead(200, { 'Content-Type': STATIC_MIME[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(fp));
        return;
      }
    }

    res.writeHead(404); res.end('Not found');
  };
}
