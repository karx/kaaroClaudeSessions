/**
 * adapters/grok.mjs
 *
 * Converts Grok updates.jsonl ACP records → NormalizedRecord[].
 */

import {
  grokRecordTs, grokSessionUpdate, isGrokToolFailure,
} from '../lib/grok-helpers.mjs';

const HARNESS = 'grok';
const ASSISTANT_CHUNKS = new Set(['agent_message_chunk', 'agent_thought_chunk']);
const COMPACT_EVENTS   = new Set(['auto_compact_completed', 'compaction_checkpoint']);

/**
 * @param {object[]} records — raw Grok updates.jsonl records
 * @returns {object[]} NormalizedRecord[]
 */
export function recordsToNormalized(records) {
  const out = [];
  const toolTitles = new Map();
  let emittedAssistantSinceLastUser = false;

  for (const rec of records) {
    const su  = grokSessionUpdate(rec);
    if (!su) continue;
    const ts  = grokRecordTs(rec);
    const upd = rec.params.update;

    if (su === 'user_message_chunk') {
      const text = upd.content?.text?.trim() || null;
      out.push({
        kind: 'user_turn', harness: HARNESS, ts,
        text: text?.length >= 8 ? text.slice(0, 200) : null,
      });
      const model = upd._meta?.modelId;
      if (model) out.push({ kind: 'session_meta', harness: HARNESS, ts, model, overwrite: true });
      emittedAssistantSinceLastUser = false;
    }

    if (ASSISTANT_CHUNKS.has(su)) {
      if (!emittedAssistantSinceLastUser) {
        emittedAssistantSinceLastUser = true;
        out.push({ kind: 'assistant_turn', harness: HARNESS, ts, content_block: su });
      }
      if (su === 'agent_message_chunk' && upd.content?.text) {
        out.push({ kind: 'content_block', harness: HARNESS, ts, block_type: 'text' });
      }
    }

    if (su === 'tool_call') {
      const title = upd.title || 'unknown';
      const raw   = upd.rawInput || {};
      toolTitles.set(upd.toolCallId, title);
      out.push({
        kind: 'tool_use', harness: HARNESS, ts,
        tool: title,
        input: {
          file_path: raw.path || raw.file_path,
          command:   raw.command,
          description: raw.description,
        },
      });
    }

    if (su === 'tool_call_update' && isGrokToolFailure(upd)) {
      const title = toolTitles.get(upd.toolCallId) || upd.title || 'unknown';
      out.push({ kind: 'tool_result', harness: HARNESS, ts, error: true, tool: title });
    }

    if (COMPACT_EVENTS.has(su)) {
      out.push({ kind: 'context_reset', harness: HARNESS, ts });
    }
  }

  return out;
}