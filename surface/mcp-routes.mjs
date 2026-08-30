/**
 * surface/mcp-routes.mjs — /api/mcp/* + /api/skills/* route handler.
 *
 * The Tools page's HTTP surface: composed into surface/http-routes.mjs the
 * same way sse-hub/pulse-emitter/rebuild-orchestrator are, keeping
 * http-routes.mjs itself thin. This is the app's first set of POST routes
 * (connect/call/disconnect a spawned MCP server) — the request body only
 * ever selects a (harness, name) pair already present in that harness's own
 * discovered config (surface/mcp-sessions.mjs enforces the lookup); it can
 * never supply a command/args itself.
 *
 * createToolsRouter() returns an async `(req, res) => Promise<boolean>` —
 * true means the request was handled, false means "not one of mine,"
 * matching the boolean-dispatch convention http-routes.mjs composes it with.
 */
import { discoverSkills, readSkillFile, readSkillAsset } from '../hooks/skills-registry.mjs';
import { HARNESS_IDS } from '../hooks/registry.mjs';

const MAX_BODY_BYTES = 1_000_000;
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };

function sendJson(res, status, payload) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); resolve(null); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('./mcp-sessions.mjs').createMcpSessions>} deps.sessions
 * @param {typeof discoverSkills} [deps.discoverSkillsFn]
 * @param {typeof readSkillFile} [deps.readSkillFileFn]
 * @param {typeof readSkillAsset} [deps.readSkillAssetFn]
 */
export function createToolsRouter({
  sessions,
  discoverSkillsFn = discoverSkills,
  readSkillFileFn = readSkillFile,
  readSkillAssetFn = readSkillAsset,
} = {}) {
  return async function handleToolsRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const method = req.method;

    if (p === '/api/mcp/servers' && method === 'GET') {
      sendJson(res, 200, { harnesses: sessions.listConfigured() });
      return true;
    }

    if (p === '/api/mcp/status' && method === 'GET') {
      sendJson(res, 200, { connections: sessions.listActive() });
      return true;
    }

    if (p === '/api/mcp/connect' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body?.harness || !body?.name) { sendJson(res, 400, { error: 'harness and name are required' }); return true; }
      try {
        sendJson(res, 200, await sessions.connectServer(body.harness, body.name));
      } catch (err) {
        sendJson(res, 502, { error: err.message });
      }
      return true;
    }

    if (p === '/api/mcp/call' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body?.connectionId || !body?.tool) { sendJson(res, 400, { error: 'connectionId and tool are required' }); return true; }
      try {
        sendJson(res, 200, { result: await sessions.callTool(body.connectionId, body.tool, body.arguments ?? {}) });
      } catch (err) {
        sendJson(res, 502, { error: err.message });
      }
      return true;
    }

    if (p === '/api/mcp/disconnect' && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { disconnected: body?.connectionId ? sessions.disconnectConn(body.connectionId) : false });
      return true;
    }

    if (p === '/api/skills' && method === 'GET') {
      sendJson(res, 200, { harnesses: HARNESS_IDS.map(h => ({ harness: h, skills: discoverSkillsFn(h) })) });
      return true;
    }

    const assetMatch = p.match(/^\/api\/skills\/([^/]+)\/([^/]+)\/file\/(.+)$/);
    if (assetMatch && method === 'GET') {
      const [harness, name, filename] = assetMatch.slice(1).map(decodeURIComponent);
      const content = readSkillAssetFn(harness, name, filename);
      if (content === null) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return true; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(content);
      return true;
    }

    const skillMatch = p.match(/^\/api\/skills\/([^/]+)\/([^/]+)$/);
    if (skillMatch && method === 'GET') {
      const [harness, name] = skillMatch.slice(1).map(decodeURIComponent);
      const skill = readSkillFileFn(harness, name);
      if (!skill) { sendJson(res, 404, { error: 'skill not found' }); return true; }
      sendJson(res, 200, skill);
      return true;
    }

    return false;
  };
}
