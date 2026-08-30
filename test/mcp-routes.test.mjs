/**
 * test/mcp-routes.test.mjs → surface/mcp-routes.mjs
 *
 * `sessions` and the skills functions are injected fakes — real spawning is
 * covered by test/mcp-client.test.mjs, real config discovery by
 * test/mcp-config.test.mjs / test/skills-registry.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createToolsRouter } from '../surface/mcp-routes.mjs';

function fakeSessions(overrides = {}) {
  return {
    listConfigured: () => [{ harness: 'claude-code', servers: [] }],
    listActive: () => [],
    connectServer: async () => ({ connectionId: 'claude-code::s1::user', tools: [{ name: 't1' }], serverInfo: {}, reused: false }),
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    disconnectConn: () => true,
    ...overrides,
  };
}

async function withServer(deps, fn) {
  const router = createToolsRouter(deps);
  const server = http.createServer(async (req, res) => {
    const handled = await router(req, res);
    if (!handled) { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { server.close(); }
}

function postJson(base, path, body) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('GET /api/mcp/servers', async () => {
  await withServer({ sessions: fakeSessions() }, async (base) => {
    const r = await fetch(`${base}/api/mcp/servers`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.harnesses[0].harness, 'claude-code');
  });
});

test('GET /api/mcp/status', async () => {
  await withServer({ sessions: fakeSessions({ listActive: () => [{ connectionId: 'x' }] }) }, async (base) => {
    const r = await fetch(`${base}/api/mcp/status`);
    const body = await r.json();
    assert.deepEqual(body.connections, [{ connectionId: 'x' }]);
  });
});

test('POST /api/mcp/connect: missing fields → 400', async () => {
  await withServer({ sessions: fakeSessions() }, async (base) => {
    const r = await postJson(base, '/api/mcp/connect', { harness: 'claude-code' });
    assert.equal(r.status, 400);
  });
});

test('POST /api/mcp/connect: success → 200 with connectionId + tools', async () => {
  await withServer({ sessions: fakeSessions() }, async (base) => {
    const r = await postJson(base, '/api/mcp/connect', { harness: 'claude-code', name: 's1' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.connectionId, 'claude-code::s1::user');
    assert.equal(body.tools.length, 1);
  });
});

test('POST /api/mcp/connect: sessions.connectServer throws → 502 with message', async () => {
  const sessions = fakeSessions({ connectServer: async () => { throw new Error('spawn failed'); } });
  await withServer({ sessions }, async (base) => {
    const r = await postJson(base, '/api/mcp/connect', { harness: 'claude-code', name: 's1' });
    assert.equal(r.status, 502);
    const body = await r.json();
    assert.equal(body.error, 'spawn failed');
  });
});

test('POST /api/mcp/call: missing fields → 400', async () => {
  await withServer({ sessions: fakeSessions() }, async (base) => {
    const r = await postJson(base, '/api/mcp/call', { connectionId: 'x' });
    assert.equal(r.status, 400);
  });
});

test('POST /api/mcp/call: success → 200 wrapping the tool result', async () => {
  await withServer({ sessions: fakeSessions() }, async (base) => {
    const r = await postJson(base, '/api/mcp/call', { connectionId: 'x', tool: 't1', arguments: { a: 1 } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.result, { content: [{ type: 'text', text: 'ok' }] });
  });
});

test('POST /api/mcp/call: sessions.callTool throws → 502', async () => {
  const sessions = fakeSessions({ callTool: async () => { throw new Error('bad args'); } });
  await withServer({ sessions }, async (base) => {
    const r = await postJson(base, '/api/mcp/call', { connectionId: 'x', tool: 't1' });
    assert.equal(r.status, 502);
  });
});

test('POST /api/mcp/disconnect: reports the manager result', async () => {
  await withServer({ sessions: fakeSessions({ disconnectConn: () => false }) }, async (base) => {
    const r = await postJson(base, '/api/mcp/disconnect', { connectionId: 'x' });
    const body = await r.json();
    assert.equal(body.disconnected, false);
  });
});

test('GET /api/skills: aggregates discoverSkillsFn across registry harnesses', async () => {
  const discoverSkillsFn = (harness) => (harness === 'claude-code' ? [{ name: 'agent-log' }] : []);
  await withServer({ sessions: fakeSessions(), discoverSkillsFn }, async (base) => {
    const r = await fetch(`${base}/api/skills`);
    const body = await r.json();
    const cc = body.harnesses.find(h => h.harness === 'claude-code');
    assert.deepEqual(cc.skills, [{ name: 'agent-log' }]);
    const codex = body.harnesses.find(h => h.harness === 'codex');
    assert.deepEqual(codex.skills, []);
  });
});

test('GET /api/skills/:harness/:name: found → 200 with skill content', async () => {
  const readSkillFileFn = (harness, name) => (harness === 'claude-code' && name === 'agent-log' ? { name, body: 'skill body' } : null);
  await withServer({ sessions: fakeSessions(), readSkillFileFn }, async (base) => {
    const r = await fetch(`${base}/api/skills/claude-code/agent-log`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.body, 'skill body');
  });
});

test('GET /api/skills/:harness/:name: not found → 404', async () => {
  await withServer({ sessions: fakeSessions(), readSkillFileFn: () => null }, async (base) => {
    const r = await fetch(`${base}/api/skills/claude-code/nope`);
    assert.equal(r.status, 404);
  });
});

test('GET /api/skills/:harness/:name/file/:filename: found → 200 raw text', async () => {
  const readSkillAssetFn = (harness, name, filename) => (filename === 'reference.md' ? 'raw content' : null);
  await withServer({ sessions: fakeSessions(), readSkillAssetFn }, async (base) => {
    const r = await fetch(`${base}/api/skills/claude-code/agent-log/file/reference.md`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await r.text(), 'raw content');
  });
});

test('GET /api/skills/:harness/:name/file/:filename: missing → 404', async () => {
  await withServer({ sessions: fakeSessions(), readSkillAssetFn: () => null }, async (base) => {
    const r = await fetch(`${base}/api/skills/claude-code/agent-log/file/nope.md`);
    assert.equal(r.status, 404);
  });
});

test('unmatched route: router returns false, falls through to caller 404', async () => {
  await withServer({ sessions: fakeSessions() }, async (base) => {
    const r = await fetch(`${base}/api/mcp/nonsense`);
    assert.equal(r.status, 404);
  });
});
