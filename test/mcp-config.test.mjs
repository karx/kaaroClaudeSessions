/**
 * test/mcp-config.test.mjs → hooks/mcp-config.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  parseTomlMcpServers,
  discoverClaudeCodeMcpServers, discoverCodexMcpServers, discoverPiMcpServers,
  discoverAntigravityMcpServers, discoverGrokMcpServers, discoverOpencodeMcpServers,
  discoverCopilotMcpServers, discoverCommandCodeMcpServers, discoverMcpServers,
} from '../hooks/mcp-config.mjs';

function tmp() {
  return mkdtempSync(path.join(tmpdir(), 'kaaro-mcp-'));
}

// ── parseTomlMcpServers ───────────────────────────────────────────────────

test('parseTomlMcpServers: inline env table + args array', () => {
  const toml = `
model = "gpt-5"

[mcp_servers.chrome-devtools-mcp]
command = "npx"
args = ["-y", "chrome-devtools-mcp@latest"]
env = { FOO = "bar" }

[projects."C:\\Users\\x"]
trust_level = "trusted"
`;
  const servers = parseTomlMcpServers(toml);
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0], {
    name: 'chrome-devtools-mcp', command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'], env: { FOO: 'bar' },
  });
});

test('parseTomlMcpServers: nested [mcp_servers.NAME.env] table', () => {
  const toml = `
[mcp_servers.my-server]
command = "node"
args = ["server.js"]

[mcp_servers.my-server.env]
API_KEY = "secret"
DEBUG = "true"
`;
  const servers = parseTomlMcpServers(toml);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].env.API_KEY, 'secret');
  assert.equal(servers[0].env.DEBUG, 'true');
});

test('parseTomlMcpServers: no mcp_servers tables → []', () => {
  assert.deepEqual(parseTomlMcpServers('model = "gpt-5"\n[windows]\nsandbox = "elevated"\n'), []);
});

test('parseTomlMcpServers: server with no command is dropped', () => {
  assert.deepEqual(parseTomlMcpServers('[mcp_servers.broken]\nargs = ["x"]\n'), []);
});

test('parseTomlMcpServers: whole-line comments ignored', () => {
  const toml = `
# a leading comment
[mcp_servers.s]
# another comment, mid-table
command = "npx"
`;
  const servers = parseTomlMcpServers(toml);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].command, 'npx');
});

// ── claude-code ───────────────────────────────────────────────────────────

test('discoverClaudeCodeMcpServers: user-level + project-level + project .mcp.json', () => {
  const dir = tmp();
  const projectDir = path.join(dir, 'proj');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, '.mcp.json'), JSON.stringify({
    mcpServers: { 'committed-server': { command: 'foo', args: [] } },
  }));
  const configPath = path.join(dir, 'claude.json');
  writeFileSync(configPath, JSON.stringify({
    mcpServers: { 'user-server': { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: {} } },
    projects: { [projectDir]: { mcpServers: { 'proj-server': { command: 'bar' } } } },
  }));

  const servers = discoverClaudeCodeMcpServers({ configPath });
  const names = servers.map(s => s.name).sort();
  assert.deepEqual(names, ['committed-server', 'proj-server', 'user-server']);
  const user = servers.find(s => s.name === 'user-server');
  assert.equal(user.scope, 'user');
  assert.deepEqual(user.args, ['-y', 'x']);
  const proj = servers.find(s => s.name === 'proj-server');
  assert.equal(proj.scope, 'project');
  assert.equal(proj.project, projectDir);
  const committed = servers.find(s => s.name === 'committed-server');
  assert.equal(committed.scope, 'project-file');

  rmSync(dir, { recursive: true, force: true });
});

test('discoverClaudeCodeMcpServers: missing file → []', () => {
  assert.deepEqual(discoverClaudeCodeMcpServers({ configPath: 'Z:/does/not/exist.json' }), []);
});

test('discoverClaudeCodeMcpServers: malformed JSON → []', () => {
  const dir = tmp();
  const configPath = path.join(dir, 'claude.json');
  writeFileSync(configPath, '{ not json');
  assert.deepEqual(discoverClaudeCodeMcpServers({ configPath }), []);
  rmSync(dir, { recursive: true, force: true });
});

// ── codex / grok (TOML) ───────────────────────────────────────────────────

test('discoverCodexMcpServers reads a TOML config', () => {
  const dir = tmp();
  const configPath = path.join(dir, 'config.toml');
  writeFileSync(configPath, '[mcp_servers.s1]\ncommand = "npx"\nargs = ["-y", "p"]\n');
  const servers = discoverCodexMcpServers({ configPath });
  assert.equal(servers.length, 1);
  assert.equal(servers[0].harness, 'codex');
  assert.equal(servers[0].command, 'npx');
  rmSync(dir, { recursive: true, force: true });
});

test('discoverGrokMcpServers reads a TOML config; missing file → []', () => {
  assert.deepEqual(discoverGrokMcpServers({ configPath: 'Z:/nope.toml' }), []);
});

// ── antigravity / pi / opencode / command-code (JSON) ─────────────────────

test('discoverAntigravityMcpServers merges settings.json + mcp_config.json', () => {
  const dir = tmp();
  const settingsPath = path.join(dir, 'settings.json');
  const mcpConfigPath = path.join(dir, 'mcp_config.json');
  writeFileSync(settingsPath, JSON.stringify({ mcpServers: { a: { command: 'a-cmd' } } }));
  writeFileSync(mcpConfigPath, JSON.stringify({ b: { command: 'b-cmd' } }));
  const servers = discoverAntigravityMcpServers({ settingsPath, mcpConfigPath });
  assert.deepEqual(servers.map(s => s.name).sort(), ['a', 'b']);
  rmSync(dir, { recursive: true, force: true });
});

test('discoverAntigravityMcpServers: empty mcp_config.json file → []', () => {
  const dir = tmp();
  const mcpConfigPath = path.join(dir, 'mcp_config.json');
  writeFileSync(mcpConfigPath, '');
  const servers = discoverAntigravityMcpServers({ settingsPath: 'Z:/nope.json', mcpConfigPath });
  assert.deepEqual(servers, []);
  rmSync(dir, { recursive: true, force: true });
});

test('discoverPiMcpServers: missing settings → []', () => {
  assert.deepEqual(discoverPiMcpServers({ settingsPath: 'Z:/nope.json' }), []);
});

test('discoverOpencodeMcpServers: local + remote entries', () => {
  const dir = tmp();
  const configPath = path.join(dir, 'opencode.json');
  writeFileSync(configPath, JSON.stringify({
    mcp: {
      local1: { type: 'local', command: ['node', 'server.js'], environment: { X: '1' } },
      remote1: { type: 'remote', url: 'https://example.com/mcp' },
    },
  }));
  const servers = discoverOpencodeMcpServers({ configPath });
  const local = servers.find(s => s.name === 'local1');
  assert.equal(local.command, 'node');
  assert.deepEqual(local.args, ['server.js']);
  assert.equal(local.type, 'stdio');
  const remote = servers.find(s => s.name === 'remote1');
  assert.equal(remote.type, 'remote');
  assert.equal(remote.command, null);
  rmSync(dir, { recursive: true, force: true });
});

test('discoverCommandCodeMcpServers: no mcpServers key → []', () => {
  const dir = tmp();
  const configPath = path.join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ installed: true, provider: 'command-code' }));
  assert.deepEqual(discoverCommandCodeMcpServers({ configPath }), []);
  rmSync(dir, { recursive: true, force: true });
});

// ── copilot (workspace-scoped) ─────────────────────────────────────────────

test('discoverCopilotMcpServers: user mcp.json + per-workspace .vscode/mcp.json', () => {
  const dir = tmp();
  const userMcpPath = path.join(dir, 'user-mcp.json');
  writeFileSync(userMcpPath, JSON.stringify({ servers: { 'user-tool': { command: 'ut' } } }));

  const workspaceStorageRoot = path.join(dir, 'workspaceStorage');
  const hashDir = path.join(workspaceStorageRoot, 'abc123');
  const projectFolder = path.join(dir, 'my-project');
  mkdirSync(hashDir, { recursive: true });
  mkdirSync(path.join(projectFolder, '.vscode'), { recursive: true });
  writeFileSync(path.join(hashDir, 'workspace.json'), JSON.stringify({
    folder: `file:///${projectFolder.replace(/\\/g, '/')}`,
  }));
  writeFileSync(path.join(projectFolder, '.vscode', 'mcp.json'), JSON.stringify({
    servers: { 'proj-tool': { command: 'pt' } },
  }));

  const servers = discoverCopilotMcpServers({ workspaceStorageRoot, userMcpPath });
  assert.deepEqual(servers.map(s => s.name).sort(), ['proj-tool', 'user-tool']);
  const proj = servers.find(s => s.name === 'proj-tool');
  assert.equal(proj.scope, 'project');

  rmSync(dir, { recursive: true, force: true });
});

test('discoverCopilotMcpServers: no workspaceStorage dir → []', () => {
  assert.deepEqual(
    discoverCopilotMcpServers({ workspaceStorageRoot: 'Z:/nope', userMcpPath: 'Z:/nope.json' }),
    []
  );
});

// ── dispatch ────────────────────────────────────────────────────────────

test('discoverMcpServers: unknown harness id → []', () => {
  assert.deepEqual(discoverMcpServers('not-a-harness'), []);
});

test('discoverMcpServers: dispatches to the right discoverer', () => {
  const dir = tmp();
  const configPath = path.join(dir, 'claude.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: { s: { command: 'c' } } }));
  const servers = discoverMcpServers('claude-code', { configPath });
  assert.equal(servers.length, 1);
  rmSync(dir, { recursive: true, force: true });
});
