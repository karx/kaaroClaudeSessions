/**
 * hooks/mcp-config.mjs — per-harness MCP server config discovery.
 *
 * Sibling concern to session normalization, not part of the "adding a
 * harness" contract in hooks/registry.mjs — this reads each harness's own
 * *user config* (not transcript storage) to find MCP servers it already has
 * configured. Every discoverer fails soft: a missing file, malformed JSON,
 * or unrecognized shape yields [] rather than throwing (same convention as
 * cluster-overrides.json / kind-map).
 *
 * Every entry normalizes to:
 *   { harness, name, command, args, env, scope, source, project, type }
 * `type` is 'stdio' unless the harness config marks a server 'remote' (http/sse) —
 * hooks/mcp-client.mjs only speaks stdio, so callers should treat non-stdio
 * entries as listable-but-not-connectable.
 */
import fs   from 'node:fs';
import path from 'node:path';

import {
  CLAUDE_USER_CONFIG_PATH, CODEX_CONFIG_PATH, PI_SETTINGS_PATH,
  ANTIGRAVITY_GEMINI_SETTINGS_PATH, ANTIGRAVITY_MCP_CONFIG_PATH, GROK_CONFIG_PATH,
  OPENCODE_GLOBAL_CONFIG_PATH, COPILOT_WORKSPACE_STORAGE_ROOT, COPILOT_USER_MCP_PATH,
  COMMANDCODE_CONFIG_PATH,
} from './harness-paths.mjs';
import { workspaceFolderPath } from './helpers/copilot-helpers.mjs';

function safeReadText(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch { return null; }
}

function safeReadJson(filePath) {
  const text = safeReadText(filePath);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function normalizeEntry(harness, name, entry, scope, source, project = null) {
  return {
    harness, name,
    command: typeof entry?.command === 'string' ? entry.command : null,
    args: Array.isArray(entry?.args) ? entry.args.map(String) : [],
    env: entry?.env && typeof entry.env === 'object' ? entry.env : {},
    scope, source, project,
    type: entry?.type === 'remote' ? 'remote' : 'stdio',
  };
}

// ── Scoped TOML reader — [mcp_servers.NAME] / [mcp_servers.NAME.env] tables only.
// Not a general TOML parser: no multi-line strings, no dotted inline keys
// beyond one level, trailing inline comments are not stripped (only
// whole-line `# …` comments are).

function splitTopLevel(s, sep) {
  const out = [];
  let cur = '';
  let inQuote = null;
  for (const ch of s) {
    if (inQuote) {
      cur += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch; cur += ch;
    } else if (ch === sep) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function stripQuotes(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner;
  }
  return t;
}

function parseTomlValue(raw) {
  const t = raw.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    return splitTopLevel(t.slice(1, -1), ',').map(v => parseTomlValue(v)).filter(v => v !== '');
  }
  if (t.startsWith('{') && t.endsWith('}')) {
    const obj = {};
    for (const pair of splitTopLevel(t.slice(1, -1), ',')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      obj[stripQuotes(pair.slice(0, eq))] = parseTomlValue(pair.slice(eq + 1));
    }
    return obj;
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return stripQuotes(t);
}

/** Parse `[mcp_servers.NAME]` / `[mcp_servers.NAME.env]` tables out of a TOML doc. */
export function parseTomlMcpServers(text) {
  const servers = {};
  let target = null; // { server, envMode }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const segs = splitTopLevel(header[1], '.').map(stripQuotes);
      if (segs[0] === 'mcp_servers' && segs.length === 2) {
        target = { server: segs[1], envMode: false };
      } else if (segs[0] === 'mcp_servers' && segs.length === 3 && segs[2] === 'env') {
        target = { server: segs[1], envMode: true };
      } else {
        target = null;
      }
      if (target && !servers[target.server]) {
        servers[target.server] = { name: target.server, command: null, args: [], env: {} };
      }
      continue;
    }

    if (!target) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = parseTomlValue(line.slice(eq + 1));
    const server = servers[target.server];

    if (target.envMode) { server.env[key] = String(value); continue; }
    if (key === 'command') server.command = String(value);
    else if (key === 'args') server.args = Array.isArray(value) ? value.map(String) : [];
    else if (key === 'env' && value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) server.env[k] = String(v);
    }
  }

  return Object.values(servers).filter(s => s.command);
}

// ── Per-harness discoverers ───────────────────────────────────────────────

export function discoverClaudeCodeMcpServers({ configPath = CLAUDE_USER_CONFIG_PATH } = {}) {
  const cfg = safeReadJson(configPath);
  if (!cfg) return [];
  const out = [];
  for (const [name, entry] of Object.entries(cfg.mcpServers || {})) {
    out.push(normalizeEntry('claude-code', name, entry, 'user', configPath));
  }
  for (const [projectPath, proj] of Object.entries(cfg.projects || {})) {
    for (const [name, entry] of Object.entries(proj?.mcpServers || {})) {
      out.push(normalizeEntry('claude-code', name, entry, 'project', configPath, projectPath));
    }
    const mcpJsonPath = path.join(projectPath, '.mcp.json');
    const mcpJson = safeReadJson(mcpJsonPath);
    for (const [name, entry] of Object.entries(mcpJson?.mcpServers || {})) {
      out.push(normalizeEntry('claude-code', name, entry, 'project-file', mcpJsonPath, projectPath));
    }
  }
  return out;
}

export function discoverCodexMcpServers({ configPath = CODEX_CONFIG_PATH } = {}) {
  const text = safeReadText(configPath);
  if (!text) return [];
  return parseTomlMcpServers(text).map(s => ({
    harness: 'codex', name: s.name, command: s.command, args: s.args, env: s.env,
    scope: 'user', source: configPath, project: null, type: 'stdio',
  }));
}

export function discoverPiMcpServers({ settingsPath = PI_SETTINGS_PATH } = {}) {
  const settings = safeReadJson(settingsPath);
  const map = settings?.mcpServers || settings?.mcp || {};
  return Object.entries(map).map(([name, entry]) => normalizeEntry('pi', name, entry, 'user', settingsPath));
}

export function discoverAntigravityMcpServers({
  settingsPath = ANTIGRAVITY_GEMINI_SETTINGS_PATH, mcpConfigPath = ANTIGRAVITY_MCP_CONFIG_PATH,
} = {}) {
  const out = [];
  const settings = safeReadJson(settingsPath);
  for (const [name, entry] of Object.entries(settings?.mcpServers || {})) {
    out.push(normalizeEntry('antigravity', name, entry, 'user', settingsPath));
  }
  const mcpConfig = safeReadJson(mcpConfigPath);
  const map = mcpConfig?.mcpServers && typeof mcpConfig.mcpServers === 'object'
    ? mcpConfig.mcpServers
    : (mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig) ? mcpConfig : {});
  for (const [name, entry] of Object.entries(map)) {
    out.push(normalizeEntry('antigravity', name, entry, 'user', mcpConfigPath));
  }
  return out;
}

export function discoverGrokMcpServers({ configPath = GROK_CONFIG_PATH } = {}) {
  const text = safeReadText(configPath);
  if (!text) return [];
  return parseTomlMcpServers(text).map(s => ({
    harness: 'grok', name: s.name, command: s.command, args: s.args, env: s.env,
    scope: 'user', source: configPath, project: null, type: 'stdio',
  }));
}

export function discoverOpencodeMcpServers({ configPath = OPENCODE_GLOBAL_CONFIG_PATH } = {}) {
  const cfg = safeReadJson(configPath);
  const map = cfg?.mcp || {};
  const out = [];
  for (const [name, entry] of Object.entries(map)) {
    if (entry?.type === 'remote') {
      out.push({
        harness: 'opencode', name, command: null, args: [],
        env: entry.environment && typeof entry.environment === 'object' ? entry.environment : {},
        scope: 'user', source: configPath, project: null, type: 'remote',
      });
      continue;
    }
    const cmdArr = Array.isArray(entry?.command) ? entry.command.map(String)
      : typeof entry?.command === 'string' ? [entry.command] : [];
    out.push({
      harness: 'opencode', name,
      command: cmdArr[0] ?? null, args: cmdArr.slice(1),
      env: entry?.environment && typeof entry.environment === 'object' ? entry.environment : {},
      scope: 'user', source: configPath, project: null, type: 'stdio',
    });
  }
  return out;
}

export function discoverCopilotMcpServers({
  workspaceStorageRoot = COPILOT_WORKSPACE_STORAGE_ROOT, userMcpPath = COPILOT_USER_MCP_PATH,
} = {}) {
  const out = [];
  const userCfg = safeReadJson(userMcpPath);
  for (const [name, entry] of Object.entries(userCfg?.servers || {})) {
    out.push(normalizeEntry('copilot', name, entry, 'user', userMcpPath));
  }

  let hashDirs = [];
  try {
    hashDirs = fs.readdirSync(workspaceStorageRoot, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
  } catch { hashDirs = []; }

  for (const hash of hashDirs) {
    const wsJsonPath = path.join(workspaceStorageRoot, hash, 'workspace.json');
    const folder = workspaceFolderPath(safeReadJson(wsJsonPath));
    if (!folder) continue;
    const mcpPath = path.join(folder, '.vscode', 'mcp.json');
    const mcpCfg = safeReadJson(mcpPath);
    for (const [name, entry] of Object.entries(mcpCfg?.servers || {})) {
      out.push(normalizeEntry('copilot', name, entry, 'project', mcpPath, folder));
    }
  }
  return out;
}

export function discoverCommandCodeMcpServers({ configPath = COMMANDCODE_CONFIG_PATH } = {}) {
  const cfg = safeReadJson(configPath);
  const map = cfg?.mcpServers || {};
  return Object.entries(map).map(([name, entry]) => normalizeEntry('command-code', name, entry, 'user', configPath));
}

const DISCOVERERS = {
  'claude-code': discoverClaudeCodeMcpServers,
  codex: discoverCodexMcpServers,
  pi: discoverPiMcpServers,
  antigravity: discoverAntigravityMcpServers,
  grok: discoverGrokMcpServers,
  opencode: discoverOpencodeMcpServers,
  copilot: discoverCopilotMcpServers,
  'command-code': discoverCommandCodeMcpServers,
};

/** Discover configured MCP servers for one harness id. Unknown id / any internal error → []. */
export function discoverMcpServers(harnessId, opts) {
  const fn = DISCOVERERS[harnessId];
  if (!fn) return [];
  try { return fn(opts); } catch { return []; }
}
