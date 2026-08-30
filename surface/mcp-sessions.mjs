/**
 * surface/mcp-sessions.mjs — live MCP connection manager.
 *
 * Bridges hooks/mcp-config.mjs (what's configured) and hooks/mcp-client.mjs
 * (how to talk to it): connectServer() looks a server up by (harness, name)
 * in the harness's own already-discovered config — the caller can never
 * supply an arbitrary command — spawns + handshakes it, and keeps the live
 * connection keyed by connectionId for subsequent tool calls.
 *
 * Stateful by nature (it owns spawned child processes), but `now` is still
 * injected rather than read via Date.now() internally, matching
 * surface/active-state.mjs's testability convention.
 */
import { discoverMcpServers } from '../hooks/mcp-config.mjs';
import { connectMcpServer } from '../hooks/mcp-client.mjs';
import { HARNESS_IDS } from '../hooks/registry.mjs';

const DEFAULT_IDLE_MS = 30 * 60_000;

function connectionKey(harness, name, scope) {
  return `${harness}::${name}::${scope}`;
}

/**
 * @param {object} [opts]
 * @param {(harnessId: string, opts?: object) => object[]} [opts.discover]
 * @param {Function} [opts.connect] — hooks/mcp-client.mjs connectMcpServer, injectable for tests
 * @param {number} [opts.idleMs]
 * @param {() => number} [opts.now]
 */
export function createMcpSessions({
  discover = discoverMcpServers,
  connect = connectMcpServer,
  idleMs = DEFAULT_IDLE_MS,
  now = () => Date.now(),
} = {}) {
  /** @type {Map<string, { harness: string, name: string, scope: string, conn: object, tools: object[], connectedAt: number, lastUsed: number }>} */
  const connections = new Map();

  function listConfigured() {
    return HARNESS_IDS.map(harness => ({ harness, servers: discover(harness) }));
  }

  async function connectServer(harness, name) {
    const servers = discover(harness);
    const entry = servers.find(s => s.name === name);
    if (!entry) throw new Error(`No configured MCP server "${name}" for harness "${harness}"`);
    if (entry.type !== 'stdio' || !entry.command) {
      throw new Error(`MCP server "${name}" (${harness}) is not a connectable stdio server (type=${entry.type || 'unknown'})`);
    }

    const id = connectionKey(harness, name, entry.scope);
    const existing = connections.get(id);
    if (existing) {
      existing.lastUsed = now();
      return { connectionId: id, tools: existing.tools, serverInfo: existing.conn.serverInfo, reused: true };
    }

    const conn = await connect({
      command: entry.command, args: entry.args, env: entry.env, cwd: entry.project ?? undefined,
    });
    const tools = await conn.listTools();
    const t = now();
    connections.set(id, { harness, name, scope: entry.scope, conn, tools, connectedAt: t, lastUsed: t });
    return { connectionId: id, tools, serverInfo: conn.serverInfo, reused: false };
  }

  async function callTool(connectionId, toolName, toolArgs) {
    const entry = connections.get(connectionId);
    if (!entry) throw new Error(`Unknown MCP connection "${connectionId}"`);
    entry.lastUsed = now();
    return entry.conn.callTool(toolName, toolArgs);
  }

  function disconnectConn(connectionId) {
    const entry = connections.get(connectionId);
    if (!entry) return false;
    connections.delete(connectionId);
    try { entry.conn.disconnect(); } catch { /* already gone */ }
    return true;
  }

  function listActive() {
    return [...connections.entries()].map(([connectionId, e]) => ({
      connectionId, harness: e.harness, name: e.name, scope: e.scope,
      toolCount: e.tools.length, connectedAt: e.connectedAt, lastUsed: e.lastUsed,
    }));
  }

  /** Disconnect connections idle past idleMs (relative to now()). */
  function reapIdle() {
    const cutoff = now() - idleMs;
    for (const [id, e] of connections) {
      if (e.lastUsed < cutoff) disconnectConn(id);
    }
  }

  /** Disconnect every live connection — call on process shutdown. */
  function killAll() {
    for (const id of [...connections.keys()]) disconnectConn(id);
  }

  return { listConfigured, connectServer, callTool, disconnectConn, listActive, reapIdle, killAll };
}
