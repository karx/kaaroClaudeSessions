/**
 * lib/grok-helpers.mjs
 *
 * Pure helpers for Grok ACP session/update stream parsing.
 */

import { deriveAntigravityProjectId, deriveAntigravityLabel } from './antigravity-helpers.mjs';
import { isBashToolName } from '../action-keys.mjs';

export function decodeGrokCwd(encoded) {
  if (!encoded) return null;
  try { return decodeURIComponent(encoded); } catch { return encoded; }
}

export function deriveGrokProjectId(encodedCwd) {
  return deriveAntigravityProjectId(decodeGrokCwd(encodedCwd));
}

export function deriveGrokLabel(encodedCwd) {
  return deriveAntigravityLabel(decodeGrokCwd(encodedCwd));
}

export function grokRecordTs(record) {
  if (record?._meta?.agentTimestampMs)
    return new Date(record._meta.agentTimestampMs).toISOString();
  if (typeof record?.timestamp === 'number')
    return new Date(record.timestamp * 1000).toISOString();
  return null;
}

export function grokUpdate(record) {
  return record?.params?.update ?? null;
}

export function grokSessionUpdate(record) {
  return grokUpdate(record)?.sessionUpdate ?? null;
}

const FILE_READ_TOOLS  = new Set(['Read']);
const FILE_WRITE_TOOLS = new Set(['Write']);
const FILE_EDIT_TOOLS  = new Set(['StrReplace', 'EditNotebook']);

export function grokFileOp(tool) {
  if (FILE_READ_TOOLS.has(tool))  return 'read';
  if (FILE_WRITE_TOOLS.has(tool)) return 'write';
  if (FILE_EDIT_TOOLS.has(tool))  return 'edit';
  return null;
}

export function grokToolWhere(title, rawInput = {}) {
  const tool = title || 'unknown';

  // Explicit file path fields (many naming conventions across Grok tools)
  const fp = rawInput.file_path || rawInput.filePath || rawInput.target_file
          || rawInput.path;
  if (fp) return String(fp).replace(/\\/g, '/');

  // Directory listing
  if (rawInput.target_directory)
    return String(rawInput.target_directory).replace(/\\/g, '/');

  // Shell / bash
  if (isBashToolName(tool) && rawInput.command)
    return String(rawInput.command).slice(0, 80);

  // Search / grep
  const lc = tool.toLowerCase();
  if ((lc === 'grep' || lc === 'glob') && rawInput.pattern)
    return String(rawInput.pattern);
  if (lc === 'glob' && rawInput.glob_pattern)
    return String(rawInput.glob_pattern);

  // Web fetch — URL as the "where"
  if (rawInput.url) return String(rawInput.url);

  if (rawInput.working_directory)
    return String(rawInput.working_directory).replace(/\\/g, '/');
  return null;
}

export function grokToolWhy(rawInput = {}) {
  return rawInput.description || rawInput.command?.slice?.(0, 80) || null;
}

export function isGrokToolFailure(update) {
  const st = String(update?.status || '').toLowerCase();
  if (st !== 'completed') return false;
  const exit = update?.rawOutput?.exit_code;
  return exit != null && exit !== 0;
}