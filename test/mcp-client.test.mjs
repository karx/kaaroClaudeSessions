/**
 * test/mcp-client.test.mjs → hooks/mcp-client.mjs
 *
 * Spawns the real test/fixtures/fake-mcp-server.mjs as a genuine child
 * process — this exercises the real stdio JSON-RPC framing, not a mock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { connectMcpServer } from '../hooks/mcp-client.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-server.mjs');

function connectFixture(opts = {}) {
  return connectMcpServer({ command: process.execPath, args: [FIXTURE], ...opts });
}

test('connectMcpServer: handshake + listTools', async () => {
  const conn = await connectFixture();
  try {
    assert.equal(conn.serverInfo.name, 'fake-mcp-server');
    const tools = await conn.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['boom', 'echo', 'slow']);
  } finally {
    conn.disconnect();
  }
});

test('connectMcpServer: callTool echo round-trips arguments', async () => {
  const conn = await connectFixture();
  try {
    const result = await conn.callTool('echo', { foo: 'bar', n: 1 });
    const text = result.content[0].text;
    assert.deepEqual(JSON.parse(text), { foo: 'bar', n: 1 });
  } finally {
    conn.disconnect();
  }
});

test('connectMcpServer: callTool rejects on a JSON-RPC error response', async () => {
  const conn = await connectFixture();
  try {
    await assert.rejects(() => conn.callTool('boom', {}), /boom failed/);
  } finally {
    conn.disconnect();
  }
});

test('connectMcpServer: per-call timeout rejects without killing the connection', async () => {
  // timeoutMs must comfortably cover the initialize handshake itself (which
  // on Windows goes through an extra cmd.exe shell hop — see winQuoteCommand)
  // while staying well under FAKE_MCP_SLOW_MS so the "slow" tool call times out.
  const conn = await connectFixture({
    timeoutMs: 800,
    env: { FAKE_MCP_SLOW_MS: '3000' },
  });
  try {
    await assert.rejects(() => conn.callTool('slow', {}), /timed out/);
    assert.equal(conn.isAlive, true);
    // connection still usable after a timed-out call
    const result = await conn.callTool('echo', { ok: true });
    assert.deepEqual(JSON.parse(result.content[0].text), { ok: true });
  } finally {
    conn.disconnect();
  }
});

test('connectMcpServer: disconnect marks the connection dead and rejects further calls', async () => {
  const conn = await connectFixture();
  conn.disconnect();
  assert.equal(conn.isAlive, false);
  await assert.rejects(() => conn.callTool('echo', {}), /closed/);
});

test('connectMcpServer: missing command rejects synchronously', async () => {
  await assert.rejects(() => connectMcpServer({}), /command is required/);
});

test('connectMcpServer: nonexistent binary rejects instead of hanging', async () => {
  await assert.rejects(
    () => connectMcpServer({ command: 'kaaro-definitely-not-a-real-binary-xyz', timeoutMs: 2000 }),
  );
});
