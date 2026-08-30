/**
 * lib/harness-paths.mjs — session root directories per harness (no adapter imports).
 */

import path from 'path';
import os   from 'os';

export const CLAUDE_PROJECTS_ROOT  = path.join(os.homedir(), '.claude', 'projects');
export const CODEX_HOME_ROOT       = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const PI_SESSIONS_ROOT      = path.join(os.homedir(), '.pi', 'agent', 'sessions');
export const ANTIGRAVITY_BRAIN_ROOT = path.join(
  os.homedir(), '.gemini', 'antigravity', 'brain'
);
export const GROK_SESSIONS_ROOT = path.join(os.homedir(), '.grok', 'sessions');
export const OPENCODE_STORAGE_ROOT = path.join(
  os.homedir(), '.local', 'share', 'opencode', 'storage'
);

// VS Code user-data dir is platform-specific; Copilot chat sessions live in
// workspaceStorage/<hash>/chatSessions inside it.
function vscodeUserDir() {
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Code', 'User');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User');
  return path.join(os.homedir(), '.config', 'Code', 'User');
}
export const COPILOT_WORKSPACE_STORAGE_ROOT = path.join(vscodeUserDir(), 'workspaceStorage');
export const COMMANDCODE_PROJECTS_ROOT = path.join(os.homedir(), '.commandcode', 'projects');

// ── MCP / skills config locations (hooks/mcp-config.mjs, hooks/skills-registry.mjs) ──
// Separate from the session roots above: these are the harnesses' own
// user-config files, not transcript storage. Paths below unconfirmed
// (marked) are best-effort per publicly documented conventions and are
// read fail-soft — an absent/wrong path just yields an empty result.
export const CLAUDE_USER_CONFIG_PATH = path.join(os.homedir(), '.claude.json');
export const CLAUDE_SKILLS_ROOT      = path.join(os.homedir(), '.claude', 'skills');

export const CODEX_CONFIG_PATH = path.join(CODEX_HOME_ROOT, 'config.toml');
export const CODEX_SKILLS_ROOT = path.join(CODEX_HOME_ROOT, 'skills'); // unconfirmed

export const PI_SETTINGS_PATH = path.join(os.homedir(), '.pi', 'agent', 'settings.json'); // mcp key unconfirmed
export const PI_SKILLS_ROOT   = path.join(os.homedir(), '.pi', 'agent', 'skills'); // unconfirmed

export const ANTIGRAVITY_GEMINI_SETTINGS_PATH = path.join(os.homedir(), '.gemini', 'settings.json');
export const ANTIGRAVITY_MCP_CONFIG_PATH      = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
export const ANTIGRAVITY_SKILLS_ROOT          = path.join(os.homedir(), '.gemini', 'skills'); // unconfirmed

export const GROK_CONFIG_PATH = path.join(os.homedir(), '.grok', 'config.toml');
export const GROK_SKILLS_ROOT = path.join(os.homedir(), '.grok', 'skills');

// opencode reads project-local opencode.json first; this is the user/global
// fallback location per its docs (unconfirmed on this machine).
export const OPENCODE_GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
export const OPENCODE_SKILLS_ROOT        = path.join(os.homedir(), '.config', 'opencode', 'skills'); // unconfirmed

export const COPILOT_USER_MCP_PATH = path.join(vscodeUserDir(), 'mcp.json');

export const COMMANDCODE_CONFIG_PATH = path.join(os.homedir(), '.commandcode', 'config.json');
export const COMMANDCODE_SKILLS_ROOT = path.join(os.homedir(), '.commandcode', 'skills'); // unconfirmed
