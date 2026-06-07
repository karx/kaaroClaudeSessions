/**
 * lib/antigravity-helpers.mjs
 *
 * Pure helpers for Antigravity transcript parsing.
 */

export function parseArgValue(val) {
  if (!val || typeof val !== 'string') return null;
  try { return JSON.parse(val); } catch { return val.trim(); }
}

export function deriveAntigravityProjectId(cwdRaw) {
  if (!cwdRaw) return 'antigravity-unknown';
  const norm = cwdRaw.replace(/\\/g, '/').replace(/\/$/, '');
  const driveMatch = norm.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase();
    const rest  = norm.slice(3).replace(/\//g, '-');
    return `${drive}--${rest}`;
  }
  return norm.replace(/^\//, '').replace(/\//g, '-') || 'antigravity-unknown';
}

export function deriveAntigravityLabel(cwdRaw) {
  if (!cwdRaw) return 'unknown';
  const norm = cwdRaw.replace(/\\/g, '/').replace(/\/$/, '');
  return norm.split('/').pop() || 'unknown';
}

function cwdFromToolCall(tc) {
  const name = tc.name || '';
  const args = tc.args || {};

  if (name === 'run_command') {
    return parseArgValue(args.Cwd) || null;
  }
  if (name === 'list_dir') {
    return parseArgValue(args.DirectoryPath) || null;
  }
  if (['view_file', 'write_to_file', 'replace_file_content',
       'multi_replace_file_content'].includes(name)) {
    const raw = parseArgValue(args.AbsolutePath || args.TargetFile);
    if (!raw) return null;
    const norm = raw.replace(/\\/g, '/');
    return norm.substring(0, norm.lastIndexOf('/')) || null;
  }
  return null;
}

export function detectWorkspace(records) {
  const counts = {};
  for (const rec of records) {
    if (rec.type !== 'PLANNER_RESPONSE') continue;
    for (const tc of (rec.tool_calls || [])) {
      const cwd = cwdFromToolCall(tc);
      if (cwd) counts[cwd] = (counts[cwd] || 0) + 1;
    }
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

export function extractModelChange(content) {
  if (!content || typeof content !== 'string') return null;
  const m = content.match(/changed setting `Model Selection` from .+? to (.+?)\.\s/);
  return m ? m[1].trim() : null;
}

export function extractUserMessage(content) {
  if (!content || typeof content !== 'string') return null;
  const reqMatch = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  const text = reqMatch ? reqMatch[1] : content;
  const stripped = text
    .replace(/<[A-Z_]+>[\s\S]*?<\/[A-Z_]+>/g, '')
    .replace(/<[A-Z_]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 8 ? stripped.slice(0, 200) : null;
}

export const REC_TYPE_TO_TOOL = {
  VIEW_FILE:      'view_file',
  LIST_DIRECTORY: 'list_dir',
  GREP_SEARCH:    'grep_search',
  RUN_COMMAND:    'run_command',
};