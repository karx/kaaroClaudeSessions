#!/usr/bin/env node
/**
 * test/fixtures/fake-mcp-server.mjs — minimal fake MCP stdio server used by
 * test/mcp-client.test.mjs. Implements just enough of the protocol to
 * exercise the real client against a real spawned process: initialize,
 * tools/list (3 fixed tools), tools/call (echo / slow / boom).
 *
 * FAKE_MCP_SLOW_MS env var controls the "slow" tool's response delay
 * (default 400ms) so tests can exercise the client's per-call timeout.
 */
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const TOOLS = [
  { name: 'echo', description: 'echoes arguments back', inputSchema: { type: 'object' } },
  { name: 'slow', description: 'delays before responding', inputSchema: { type: 'object' } },
  { name: 'boom', description: 'always errors', inputSchema: { type: 'object' } },
];

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'fake-mcp-server', version: '0.0.1' },
      },
    });
    return;
  }

  if (msg.method === 'notifications/initialized') return; // no response for notifications

  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    return;
  }

  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    if (name === 'echo') {
      send({
        jsonrpc: '2.0', id: msg.id,
        result: { content: [{ type: 'text', text: JSON.stringify(msg.params?.arguments ?? {}) }] },
      });
    } else if (name === 'slow') {
      const delay = Number(process.env.FAKE_MCP_SLOW_MS || 400);
      setTimeout(() => {
        send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'done' }] } });
      }, delay);
    } else if (name === 'boom') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'boom failed' } });
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown tool ${name}` } });
    }
    return;
  }

  if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
  }
});
