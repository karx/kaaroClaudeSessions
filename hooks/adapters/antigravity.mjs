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
} from '../helpers/antigravity-helpers.mjs';
import { categorizeBash } from '../helpers/analyze-helpers.mjs';

const HARNESS = 'antigravity';

/**
 * @param {object[]} records — raw Antigravity JSONL records
 * @returns {object[]} NormalizedRecord[]
 */
export function recordsToNormalized(records) {
  const out = [];

  for (const rec of records) {
    const ts = rec.created_at ?? null;
    let handled = false;

    if (rec.type === 'USER_INPUT' && rec.source === 'USER_EXPLICIT') {
      handled = true;
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
      handled = true;
      out.push({ kind: 'assistant_turn', harness: HARNESS, ts });

      if (rec.content && typeof rec.content === 'string' && rec.content.trim()) {
        out.push({
          kind: 'content_block', harness: HARNESS, ts,
          block_type: 'text', text: rec.content.trim(),
        });
      }

      for (const tc of (rec.tool_calls || [])) {
        const name = tc.name || 'unknown';
        const args = tc.args || {};
        const command = parseArgValue(args.CommandLine);
        const isBash = ['run_command', 'bash', 'shell'].includes(name.toLowerCase());
        const category = isBash ? categorizeBash(command) : null;
        out.push({
          kind: 'tool_use', harness: HARNESS, ts,
          tool: name, category,
          input: {
            file_path:     parseArgValue(args.AbsolutePath || args.TargetFile),
            command,
            Cwd:           parseArgValue(args.Cwd),
            DirectoryPath: parseArgValue(args.DirectoryPath),
          },
        });
      }
    }


    if (rec.type === 'EPHEMERAL_MESSAGE') {
      handled = true;
      out.push({
        kind: 'scaffold', harness: HARNESS, ts,
        content_preview: (rec.content || '').slice(0, 80),
      });
    }

    if (rec.type === 'SYSTEM_MESSAGE') {
      handled = true;
      out.push({
        kind: 'scaffold', harness: HARNESS, ts,
        content_preview: (rec.content || '').slice(0, 80),
      });
    }

    if (rec.type === 'CONVERSATION_HISTORY') {
      handled = true;
      out.push({ kind: 'context_reset', harness: HARNESS, ts });
    }


    if (rec.type === 'ERROR_MESSAGE') {
      handled = true;
      out.push({ kind: 'tool_result', harness: HARNESS, ts, error: true, tool: 'unknown' });
    }

    if (!handled
        && rec.source === 'MODEL'
        && rec.type !== 'PLANNER_RESPONSE'
        && rec.status === 'DONE'
        && REC_TYPE_TO_TOOL[rec.type]) {
      handled = true;
      out.push({
        kind: 'tool_result', harness: HARNESS, ts, error: false,
        tool: REC_TYPE_TO_TOOL[rec.type],
      });
    }

    if (!handled
        && rec.source === 'MODEL'
        && rec.type !== 'PLANNER_RESPONSE'
        && rec.status === 'ERROR') {
      handled = true;
      out.push({
        kind: 'tool_result', harness: HARNESS, ts, error: true,
        tool: REC_TYPE_TO_TOOL[rec.type] || 'unknown',
      });
    }

    if (!handled) {
      out.push({ kind: 'unknown_record', harness: HARNESS, ts, raw_type: rec.type });
    }
  }

  return out;
}
