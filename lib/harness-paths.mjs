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