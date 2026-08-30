/**
 * test/mcp-sessions.test.mjs → surface/mcp-sessions.mjs
 *
 * discover/connect are injected fakes — no real process spawning here
 * (that's covered end-to-end by test/mcp-client.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMcpSessions } from '../surface/mcp-sessions.mjs';

function fakeConn(overrides = {}) {
  const calls = { callTool: [], disconnect: 0 };
  return {
    calls,
    conn: {
      serverInfo: { name: 'fake', version: '1' },
      async listTools() { return [{ name: 't1' }, { name: 't2' }]; },
      async callTool(name, args) { calls.callTool.push([name, args]); return { ok: true, name, args }; },
      disconnect() { calls.disconnect++; },
      ...overrides,
    },
  };
}

function makeDiscover(map) {
  return (harness) => map[harness] ?? [];
}

test('listConfigured: aggregates discover() across all registry harnesses', () => {
  const sessions = createMcpSessions({
    discover: makeDiscover({ 'claude-code': [{ name: 's1', command: 'x', args: [], env: {}, scope: 'user', type: 'stdio' }] }),
  });
  const configured = sessions.listConfigured();
  const cc = configured.find(c => c.harness === 'claude-code');
  assert.equal(cc.servers.length, 1);
  const codex = configured.find(c => c.harness === 'codex');
  assert.deepEqual(codex.servers, []);
});

test('connectServer: spawns via connect(), stores connection, returns tools', async () => {
  const fake = fakeConn();
  let connectCalls = 0;
  const sessions = createMcpSessions({
    discover: makeDiscover({ 'claude-code': [{ name: 's1', command: 'npx', args: ['-y', 'x'], env: {}, scope: 'user', type: 'stdio' }] }),
    connect: async (opts) => { connectCalls++; assert.equal(opts.command, 'npx'); return fake.conn; },
  });

  const result = await sessions.connectServer('claude-code', 's1');
  assert.equal(connectCalls, 1);
  assert.equal(result.reused, false);
  assert.equal(result.tools.length, 2);
  assert.ok(result.connectionId.startsWith('claude-code::s1::'));
});

test('connectServer: unknown server name rejects', async () => {
  const sessions = createMcpSessions({ discover: makeDiscover({}) });
  await assert.rejects(() => sessions.connectServer('claude-code', 'nope'), /No configured MCP server/);
});

test('connectServer: remote/non-stdio entries reject with a clear message', async () => {
  const sessions = createMcpSessions({
    discover: makeDiscover({ opencode: [{ name: 'r1', command: null, args: [], env: {}, scope: 'user', type: 'remote' }] }),
  });
  await assert.rejects(() => sessions.connectServer('opencode', 'r1'), /not a connectable stdio server/);
});

test('connectServer: reconnecting to an already-live server reuses it (no second connect() call)', async () => {
  const fake = fakeConn();
  let connectCalls = 0;
  const sessions = createMcpSessions({
    discover: makeDiscover({ 'claude-code': [{ name: 's1', command: 'npx', args: [], env: {}, scope: 'user', type: 'stdio' }] }),
    connect: async () => { connectCalls++; return fake.conn; },
  });
  const first = await sessions.connectServer('claude-code', 's1');
  const second = await sessions.connectServer('claude-code', 's1');
  assert.equal(connectCalls, 1);
  assert.equal(second.reused, true);
  assert.equal(second.connectionId, first.connectionId);
});

test('callTool: routes to the right connection and updates lastUsed', async () => {
  const fake = fakeConn();
  let t = 1000;
  const sessions = createMcpSessions({
    discover: makeDiscover({ 'claude-code': [{ name: 's1', command: 'npx', args: [], env: {}, scope: 'user', type: 'stdio' }] }),
    connect: async () => fake.conn,
    now: () => t,
  });
  const { connectionId } = await sessions.connectServer('claude-code', 's1');
  t = 2000;
  const result = await sessions.callTool(connectionId, 't1', { a: 1 });
  assert.deepEqual(result, { ok: true, name: 't1', args: { a: 1 } });
  assert.deepEqual(fake.calls.callTool, [['t1', { a: 1 }]]);
  const active = sessions.listActive();
  assert.equal(active[0].lastUsed, 2000);
});

test('callTool: unknown connectionId rejects', async () => {
  const sessions = createMcpSessions({ discover: makeDiscover({}) });
  await assert.rejects(() => sessions.callTool('bogus', 't1', {}), /Unknown MCP connection/);
});

test('disconnectConn: disconnects and removes the connection; second call returns false', async () => {
  const fake = fakeConn();
  const sessions = createMcpSessions({
    discover: makeDiscover({ 'claude-code': [{ name: 's1', command: 'npx', args: [], env: {}, scope: 'user', type: 'stdio' }] }),
    connect: async () => fake.conn,
  });
  const { connectionId } = await sessions.connectServer('claude-code', 's1');
  assert.equal(sessions.disconnectConn(connectionId), true);
  assert.equal(fake.calls.disconnect, 1);
  assert.equal(sessions.listActive().length, 0);
  assert.equal(sessions.disconnectConn(connectionId), false);
});

test('reapIdle: disconnects only connections idle past idleMs', async () => {
  const fakeA = fakeConn();
  const fakeB = fakeConn();
  let t = 0;
  const sessions2 = createMcpSessions({
    discover: makeDiscover({
      'claude-code': [
        { name: 'a', command: 'npx', args: ['a'], env: {}, scope: 'user', type: 'stdio' },
        { name: 'b', command: 'npx', args: ['b'], env: {}, scope: 'user', type: 'stdio' },
      ],
    }),
    connect: async (opts) => (opts.args?.includes?.('b') ? fakeB.conn : fakeA.conn),
    idleMs: 1000,
    now: () => t,
  });
  await sessions2.connectServer('claude-code', 'a');
  t = 500;
  await sessions2.connectServer('claude-code', 'b'); // touches nothing else's lastUsed
  t = 1600; // 'a' last used at t=0, now 1600 > idleMs(1000) past → reaped; 'b' last used at 500, 1100 gap also > 1000 → also reaped
  sessions2.reapIdle();
  assert.equal(sessions2.listActive().length, 0);
  assert.equal(fakeA.calls.disconnect, 1);
  assert.equal(fakeB.calls.disconnect, 1);
});

test('killAll: disconnects every live connection', async () => {
  const fakeA = fakeConn();
  const fakeB = fakeConn();
  const sessions = createMcpSessions({
    discover: makeDiscover({
      'claude-code': [
        { name: 'a', command: 'npx', args: ['a'], env: {}, scope: 'user', type: 'stdio' },
        { name: 'b', command: 'npx', args: ['b'], env: {}, scope: 'user', type: 'stdio' },
      ],
    }),
    connect: async (opts) => (opts.args?.includes?.('b') ? fakeB.conn : fakeA.conn),
  });
  await sessions.connectServer('claude-code', 'a');
  await sessions.connectServer('claude-code', 'b');
  sessions.killAll();
  assert.equal(sessions.listActive().length, 0);
  assert.equal(fakeA.calls.disconnect, 1);
  assert.equal(fakeB.calls.disconnect, 1);
});
