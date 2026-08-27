/**
 * lib/harness-paths.mjs — session root directories per harness (no adapter imports).
 */

import path from 'path';
import os   from 'os';

export const CLAUDE_PROJECTS_ROOT  = path.join(os.homedir(), '.claude', 'projects');
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

// Grok Bot (Cursor/SpaceXAI desktop assistant) transcripts live on the Linux
// box at /home/box/agent-data — NOT Windows AppData. Honor GROK_BOT_AGENT_DATA
// so Windows kaaroSessions can point at a mounted or copied tree.
export const GROK_BOT_AGENT_DATA = process.env.GROK_BOT_AGENT_DATA || '/home/box/agent-data';
