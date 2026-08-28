/**
 * adapters/grok.mjs
 *
 * Converts Grok updates.jsonl ACP records → NormalizedRecord[].
 */

import {
  grokRecordTs, grokSessionUpdate, isGrokToolFailure,
} from '../helpers/grok-helpers.mjs';
import { categorizeBash } from '../helpers/analyze-helpers.mjs';
import { isBashToolName } from '../action-keys.mjs';

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
  // Temporal turn grouping: a new assistant_turn opens whenever the ACP
  // turnStartMs changes (grok runs several internal turns between user
  // messages — each is a real turn for trace/thread views).
  let currentTurnKey = null;

  function ensureAssistantTurn(rec, ts) {
    const key = rec._meta?.turnStartMs ?? '__none__';
    if (currentTurnKey === key) return;
    currentTurnKey = key;
    out.push({ kind: 'assistant_turn', harness: HARNESS, ts });
  }

  for (const rec of records) {
    const su  = grokSessionUpdate(rec);
    if (!su) continue;
    const ts  = grokRecordTs(rec);
    const upd = rec.params.update;
    let handled = false;

    if (su === 'user_message_chunk') {
      handled = true;
      const text = upd.content?.text?.trim() || null;
      out.push({
        kind: 'user_turn', harness: HARNESS, ts,
        text: text?.length >= 8 ? text.slice(0, 200) : null,
        display_text: text ? text.slice(0, 500) : null,
      });
      const model = upd._meta?.modelId;
      if (model) out.push({ kind: 'session_meta', harness: HARNESS, ts, model, overwrite: true });
      currentTurnKey = null;
    }

    if (ASSISTANT_CHUNKS.has(su)) {
      handled = true;
      ensureAssistantTurn(rec, ts);
      if (su === 'agent_message_chunk' && upd.content?.text) {
        // chunk: streamed fragments concatenate without separators in trace text
        out.push({ kind: 'content_block', harness: HARNESS, ts, block_type: 'text', text: upd.content.text, chunk: true });
      }
      if (su === 'agent_thought_chunk') {
        out.push({ kind: 'content_block', harness: HARNESS, ts, block_type: 'thinking' });
      }
    }

    if (su === 'tool_call') {
      handled = true;
      const title   = upd.title || 'unknown';
      const raw     = upd.rawInput || {};
      const isBash  = isBashToolName(title);
      const category = isBash ? categorizeBash(raw.command) : null;
      toolTitles.set(upd.toolCallId, title);
      ensureAssistantTurn(rec, ts);
      out.push({
        kind: 'tool_use', harness: HARNESS, ts,
        tool: title, category,
        tool_id: upd.toolCallId || undefined,
        // raw keys pass through (pattern, glob_pattern, old/new_string…) so the
        // trace sanitiser sees everything; file_path is the normalised alias.
        input: { ...raw, file_path: raw.path || raw.file_path },
      });
    }

    if (su === 'tool_call_update') {
      handled = true;
      if (isGrokToolFailure(upd)) {
        const title = toolTitles.get(upd.toolCallId) || upd.title || 'unknown';
        const stderr = upd.rawOutput?.stderr || upd.rawOutput?.stdout || '';
        out.push({
          kind: 'tool_result', harness: HARNESS, ts, error: true, tool: title,
          tool_id: upd.toolCallId || undefined,
          error_text: String(stderr).trim().slice(0, 300) || 'non-zero exit',
        });
      }
    }

    if (COMPACT_EVENTS.has(su)) {
      handled = true;
      out.push({ kind: 'context_reset', harness: HARNESS, ts });
      currentTurnKey = null;
    }

    if (!handled) {
      out.push({ kind: 'unknown_record', harness: HARNESS, ts, raw_type: su });
    }
  }

  return out;
}
