/**
 * hooks/mcp-client.mjs — minimal MCP stdio JSON-RPC 2.0 client (zero deps).
 *
 * Frames one JSON-RPC message per newline over a spawned child process's
 * stdin/stdout (the MCP stdio transport). Not a general JSON-RPC library —
 * scoped to exactly what the Tools page needs: initialize handshake,
 * tools/list, tools/call, and a clean disconnect.
 *
 * connectMcpServer() only ever spawns a {command, args, env} the caller
 * already trusts (hooks/mcp-config.mjs discovered it from a harness's own
 * config file) — this module has no opinion on where that command came from.
 */
import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15000;
const STDERR_TAIL_CAP = 2000;

/**
 * @param {object} opts
 * @param {string} opts.command
 * @param {string[]} [opts.args]
 * @param {Record<string,string>} [opts.env]
 * @param {string} [opts.cwd]
 * @param {number} [opts.timeoutMs] — per-call timeout
 * @param {Function} [opts.spawnFn] — test seam, defaults to node:child_process spawn
 */
export async function connectMcpServer({
  command, args = [], env = {}, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, spawnFn = spawn,
} = {}) {
  if (!command) throw new Error('connectMcpServer: command is required');

  const child = spawnFn(command, args, {
    cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
  });

  let dead = false;
  let nextId = 1;
  const pendingMap = new Map();
  let stderrTail = '';

  function killAllPending(err) {
    if (dead) return;
    dead = true;
    for (const [, p] of pendingMap) { clearTimeout(p.timer); p.reject(err); }
    pendingMap.clear();
  }

  child.on('error', (err) => killAllPending(err));
  child.on('exit', (code, signal) => {
    killAllPending(new Error(
      `MCP server "${command}" exited (code=${code}, signal=${signal})` +
      (stderrTail ? `: ${stderrTail.trim().slice(-500)}` : '')
    ));
  });
  child.stderr?.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_CAP);
  });

  let buf = '';
  child.stdout?.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) handleLine(line);
    }
  });

  function handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; } // stray non-protocol stdout output — ignore
    if (msg.id === undefined || msg.id === null) return; // server notification/log — not handled (MVP)
    const pending = pendingMap.get(msg.id);
    if (!pending) return;
    pendingMap.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(Object.assign(new Error(msg.error.message || 'MCP error'), {
        code: msg.error.code, data: msg.error.data,
      }));
    } else {
      pending.resolve(msg.result);
    }
  }

  function callRaw(method, params) {
    return new Promise((resolve, reject) => {
      if (dead) { reject(new Error('MCP connection closed')); return; }
      const id = nextId++;
      const timer = setTimeout(() => {
        pendingMap.delete(id);
        reject(new Error(`MCP call "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pendingMap.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (err) {
        pendingMap.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  function notify(method, params) {
    try { child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
    catch { /* connection already gone */ }
  }

  function disconnect() {
    killAllPending(new Error('MCP connection disconnected'));
    try { child.kill(); } catch { /* already gone */ }
  }

  let initResult;
  try {
    initResult = await callRaw('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'kaaro-sessions', version: '1.0.0' },
    });
  } catch (err) {
    disconnect();
    throw err;
  }
  notify('notifications/initialized', {});

  return {
    serverInfo: initResult?.serverInfo ?? null,
    pid: child.pid,
    async listTools() {
      const result = await callRaw('tools/list', {});
      return result?.tools ?? [];
    },
    async callTool(name, toolArgs) {
      return callRaw('tools/call', { name, arguments: toolArgs ?? {} });
    },
    disconnect,
    get isAlive() { return !dead; },
  };
}
