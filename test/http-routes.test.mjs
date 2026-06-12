/**
 * test/http-routes.test.mjs → surface/http-routes.mjs
 *
 * The Snapshot read surface: routes served over a real http.Server on an
 * ephemeral port with injected deps (no child processes, no real harness
 * dirs). /events handshake uses the real sse-hub.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequestHandler } from '../surface/http-routes.mjs';
import { createHub } from '../surface/sse-hub.mjs';
import { createActiveState, applyPulse } from '../surface/active-state.mjs';

function makeDeps(over = {}) {
  const hub = createHub();
  const activeState = createActiveState();
  return {
    hub,
    activeState,
    getStatus: () => ({ rebuilding: false, lastBuilt: '2026-06-12T00:00:00.000Z', clients: hub.size, port: 0 }),
    paths: {
      root: 'Z:/nope',
      html: 'Z:/nope/graph.html',
      data: 'Z:/nope/graph-data.json',
      daw:  'Z:/nope/daw-builder.html',
      now:  'Z:/nope/now.html',
    },
    resolveSessionFile: () => null,
    buildTrace: () => null,
    ...over,
  };
}

async function withServer(deps, fn) {
  const server = http.createServer(createRequestHandler(deps));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { server.close(); }
}

test('GET /status — JSON shape from getStatus', async () => {
  await withServer(makeDeps(), async (base) => {
    const r = await fetch(`${base}/status`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.rebuilding, false);
    assert.equal(body.lastBuilt, '2026-06-12T00:00:00.000Z');
    assert.equal(typeof body.clients, 'number');
  });
});

test('GET /api/active — snapshot of the live active-state', async () => {
  const deps = makeDeps();
  applyPulse(deps.activeState, {
    event: 'tool_call',
    data: { session_id: 's1-full', slug: 's1slug', harness: 'claude-code', project: 'p', tool: 'Read', ts: 't' },
  }, Date.now());
  await withServer(deps, async (base) => {
    const body = await (await fetch(`${base}/api/active`)).json();
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].slug, 's1slug');
    assert.ok(body.by_harness);
  });
});

test('GET /api/harnesses — registry descriptors as the UI source of truth', async () => {
  await withServer(makeDeps(), async (base) => {
    const r = await fetch(`${base}/api/harnesses`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.harnesses.length, 6);
    const cc = body.harnesses.find(h => h.id === 'claude-code');
    assert.equal(cc.label, 'Claude Code');
    assert.equal(typeof cc.capabilities.tokens, 'boolean');
    assert.equal(typeof cc.capabilities.trace, 'boolean');
    // functions must not leak into the JSON surface
    assert.equal(cc.adapter, undefined);
    assert.equal(cc.watch, undefined);
  });
});

test('GET /graph-data.json — 503 when snapshot missing, 200 when present', async () => {
  await withServer(makeDeps(), async (base) => {
    assert.equal((await fetch(`${base}/graph-data.json`)).status, 503);
  });

  const dir = join(tmpdir(), 'kaaro-http-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const dataPath = join(dir, 'graph-data.json');
  writeFileSync(dataPath, '{"nodes":[]}', 'utf8');
  try {
    const deps = makeDeps();
    deps.paths.data = dataPath;
    await withServer(deps, async (base) => {
      const r = await fetch(`${base}/graph-data.json`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { nodes: [] });
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GET / — 503 building page when graph.html missing', async () => {
  await withServer(makeDeps(), async (base) => {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 503);
    assert.ok((await r.text()).includes('Building'));
  });
});

test('GET /api/trace/:id — 400 empty, 404 unresolved, 404 trace-incapable, 200 tree', async () => {
  await withServer(makeDeps(), async (base) => {
    assert.equal((await fetch(`${base}/api/trace/`)).status, 400);
    assert.equal((await fetch(`${base}/api/trace/unknown-id`)).status, 404);
  });

  // trace-incapable harness (antigravity: degenerate turns) → 404 + explanation
  const incapable = makeDeps({
    resolveSessionFile: () => ({ filePath: 'f', projectId: 'p', sessionId: 's', harness: 'antigravity' }),
  });
  await withServer(incapable, async (base) => {
    const r = await fetch(`${base}/api/trace/s`);
    assert.equal(r.status, 404);
    assert.ok((await r.text()).includes('not supported'));
  });

  const capable = makeDeps({
    resolveSessionFile: () => ({ filePath: 'f', projectId: 'p', sessionId: 's', harness: 'claude-code' }),
    buildTrace: () => ({ session_id: 's', ai_title: 'T', segments: [] }),
  });
  await withServer(capable, async (base) => {
    const r = await fetch(`${base}/api/trace/s`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ai_title, 'T');
  });
});

test('GET /events — SSE handshake delivers connected event', async () => {
  await withServer(makeDeps(), async (base) => {
    const ac = new AbortController();
    const r = await fetch(`${base}/events`, { signal: ac.signal });
    assert.equal(r.headers.get('content-type'), 'text/event-stream');
    const reader = r.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('event: connected'), text);
    ac.abort();
  });
});

test('unknown route → 404', async () => {
  await withServer(makeDeps(), async (base) => {
    assert.equal((await fetch(`${base}/definitely-not-a-route`)).status, 404);
  });
});
