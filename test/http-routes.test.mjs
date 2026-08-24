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

test('GET /api/signals — serves signals-data.json when present', async () => {
  const dir = join(tmpdir(), `kaaro-signals-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const payload = {
    generated_at: '2026-07-19T12:00:00.000Z', total_signals: 1,
    by_level: { WARN: 1 }, by_rule: { r1: 1 },
    signals: [{ rule_id: 'r1', signal: 'WARN', session_id: 's1' }],
  };
  writeFileSync(join(dir, 'signals-data.json'), JSON.stringify(payload), 'utf8');
  const deps = makeDeps();
  deps.paths.signals = join(dir, 'signals-data.json');
  try {
    await withServer(deps, async (base) => {
      const r = await fetch(`${base}/api/signals`);
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.total_signals, 1);
      assert.deepEqual(body.by_level, { WARN: 1 });
      assert.equal(body.signals[0].rule_id, 'r1');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/signals — empty payload (200) when file absent', async () => {
  const deps = makeDeps();
  deps.paths.signals = 'Z:/nope/signals-data.json';
  await withServer(deps, async (base) => {
    const r = await fetch(`${base}/api/signals`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.total_signals, 0);
    assert.deepEqual(body.signals, []);
  });
});

test('GET /api/harnesses — registry descriptors as the UI source of truth', async () => {
  await withServer(makeDeps(), async (base) => {
    const r = await fetch(`${base}/api/harnesses`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.harnesses.length, 7);
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

test('GET /api/trace/:id — passes the resolved full session id (not the URL slug) to buildTrace', async () => {
  // Regression: a caller pasting the 8-char slug shown by the graph/Mission
  // Control must reconstruct the trace for the *resolved* session, not the slug.
  let receivedSessionId = null;
  const deps = makeDeps({
    resolveSessionFile: (id) => ({ filePath: 'f', projectId: 'p', sessionId: 'full-session-id-0123456789', harness: 'claude-code' }),
    buildTrace: (filePath, projectId, sessionId) => {
      receivedSessionId = sessionId;
      return { session_id: sessionId, ai_title: 'T', segments: [] };
    },
  });
  await withServer(deps, async (base) => {
    const r = await fetch(`${base}/api/trace/01a03426`);
    assert.equal(r.status, 200);
    assert.equal(receivedSessionId, 'full-session-id-0123456789');
    assert.equal((await r.json()).session_id, 'full-session-id-0123456789');
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

// ── E6: home landing page routing ─────────────────────────────────────────────

test('GET / — serves home artifact; /graph keeps serving the graph', async () => {
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = join(tmpdir(), 'kaaro-home-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'home.html'), '<html>KAARO HOME</html>', 'utf8');
  writeFileSync(join(dir, 'graph.html'), '<html>GRAPH PAGE</html>', 'utf8');
  try {
    const deps = makeDeps();
    deps.paths.home = join(dir, 'home.html');
    deps.paths.html = join(dir, 'graph.html');
    await withServer(deps, async (base) => {
      assert.ok((await (await fetch(`${base}/`)).text()).includes('KAARO HOME'));
      assert.ok((await (await fetch(`${base}/graph`)).text()).includes('GRAPH PAGE'));
      assert.ok((await (await fetch(`${base}/graph.html`)).text()).includes('GRAPH PAGE'),
        'old bookmarks keep working');
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GET / — falls back to the graph while home is not built yet', async () => {
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = join(tmpdir(), 'kaaro-home2-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'graph.html'), '<html>GRAPH PAGE</html>', 'utf8');
  try {
    const deps = makeDeps();
    deps.paths.home = join(dir, 'missing-home.html');
    deps.paths.html = join(dir, 'graph.html');
    await withServer(deps, async (base) => {
      assert.ok((await (await fetch(`${base}/`)).text()).includes('GRAPH PAGE'));
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GET /daw — serves DAW page; query string does not 404', async () => {
  const dir = join(tmpdir(), 'kaaro-daw-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'daw-builder.html'), '<html>DAW PAGE</html>', 'utf8');
  try {
    const deps = makeDeps();
    deps.paths.daw = join(dir, 'daw-builder.html');
    await withServer(deps, async (base) => {
      assert.ok((await (await fetch(`${base}/daw`)).text()).includes('DAW PAGE'));
      assert.ok((await (await fetch(`${base}/daw?x=1`)).text()).includes('DAW PAGE'));
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
