/**
 * adapters/antigravity.mjs
 *
 * Converts Antigravity transcript records → NormalizedRecord[].
 */

import {
  parseArgValue,
  extractModelChange,
  extractUserMessage,
  REC_TYPE_TO_TOOL,
} from '../lib/antigravity-helpers.mjs';

const HARNESS = 'antigravity';

/**
 * @param {object[]} records — raw Antigravity JSONL records
 * @returns {object[]} NormalizedRecord[]
 */
export function recordsToNormalized(records) {
  const out = [];

  for (const rec of records) {
    const ts = rec.created_at ?? null;

    if (rec.type === 'USER_INPUT' && rec.source === 'USER_EXPLICIT') {
      const content = rec.content || '';
      const text = extractUserMessage(content);
      out.push({
        kind: 'user_turn', harness: HARNESS, ts,
        text,
      });

      const model = extractModelChange(content);
      if (model) out.push({ kind: 'session_meta', harness: HARNESS, ts, model, overwrite: true });
    }

    if (rec.type === 'PLANNER_RESPONSE' && rec.source === 'MODEL') {
      out.push({ kind: 'assistant_turn', harness: HARNESS, ts });

      for (const tc of (rec.tool_calls || [])) {
        const name = tc.name || 'unknown';
        const args = tc.args || {};
        out.push({
          kind: 'tool_use', harness: HARNESS, ts,
          tool: name,
          input: {
            file_path: parseArgValue(args.AbsolutePath || args.TargetFile),
            command:   parseArgValue(args.CommandLine),
            Cwd:       parseArgValue(args.Cwd),
            DirectoryPath: parseArgValue(args.DirectoryPath),
          },
        });
      }
    }

    if (rec.source === 'MODEL'
        && rec.type !== 'PLANNER_RESPONSE'
        && rec.status === 'ERROR') {
      out.push({
        kind: 'tool_result', harness: HARNESS, ts, error: true,
        tool: REC_TYPE_TO_TOOL[rec.type] || 'unknown',
      });
    }
  }

  return out;
}