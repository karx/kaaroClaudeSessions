/**
 * adapters/grok-bot.mjs
 *
 * Converts Grok Bot agent-transcript JSONL records → NormalizedRecord[].
 *
 * This is NOT the Grok CLI / Grok Build harness (`grok`, ~/.grok/sessions).
 * Live layout (Linux box / GROK_BOT_AGENT_DATA):
 *   <agent-data>/agent-transcripts/<uuid>/<uuid>.jsonl
 *
 * Product mapping:
 *   - role user text → user_turn. `[SAND_HIDDEN_PROMPT]` stays a turn but
 *     display_text / first-user text skip the hidden preamble.
 *   - assistant text is a private scratchpad → content_block thinking
 *     (not the user-visible reply).
 *   - send_message is the user-visible reply → assistant_turn (once per
 *     burst) + content_block text. Not counted as a tool_use.
 *   - communicate_update is a progress ping → skipped as noise.
 *   - other tool_use / tool_result map normally. FILE_OP_TOOLS covers `read`.
 */

import { categorizeBash } from '../helpers/analyze-helpers.mjs';

const HARNESS = 'grok-bot';
const DISPLAY_TOOLS = new Set(['send_message']);
const NOISE_TOOLS = new Set(['communicate_update']);

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
}

function isHiddenPrompt(text) {
  return typeof text === 'string' && text.startsWith('[SAND_HIDDEN_PROMPT]');
}

function sendMessageText(input) {
  const c = input?.text?.content;
  if (typeof c === 'string') return c;
  if (typeof input?.text === 'string') return input.text;
  if (typeof input?.content === 'string') return input.content;
  return '';
}

function parseEpochMs(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toISOString();
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? raw : d.toISOString();
  }
  return typeof raw === 'string' ? raw : null;
}

function resultTimestamp(result) {
  return parseEpochMs(result?.success?.timestamp);
}

function toolResultError(result) {
  if (!result || typeof result !== 'object') return { error: false };
  if (result.error) {
    const msg = result.error.errorMessage || result.error.message || result.error;
    return { error: true, error_text: String(msg || '').trim().slice(0, 300) || undefined };
  }
  if (Object.prototype.hasOwnProperty.call(result, 'rejected')) {
    const rej = result.rejected;
    const msg = (rej && typeof rej === 'object')
      ? (rej.reason || rej.errorMessage || rej.message || 'rejected')
      : (rej == null || rej === true ? 'rejected' : String(rej));
    return { error: true, error_text: String(msg).trim().slice(0, 300) || 'rejected' };
  }
  return { error: false };
}

function blocksOf(rec) {
  const c = rec?.message?.content;
  return Array.isArray(c) ? c : [];
}

/**
 * @param {object[]} records — raw Grok Bot JSONL records
 * @returns {object[]} NormalizedRecord[]
 */
export function recordsToNormalized(records) {
  const out = [];
  let emittedAssistantSinceLastUser = false;
  let lastTs = null;

  function tsFor(candidate) {
    if (candidate) lastTs = candidate;
    return lastTs;
  }

  function ensureAssistantTurn(ts) {
    if (emittedAssistantSinceLastUser) return;
    emittedAssistantSinceLastUser = true;
    out.push({
      kind: 'assistant_turn', harness: HARNESS, ts,
      model: null, stop_reason: null,
    });
  }

  for (const rec of records) {
    const blocks = blocksOf(rec);

    if (rec.role === 'user') {
      const text = extractText(rec.message?.content ?? rec.content);
      const hidden = isHiddenPrompt(text);
      const trimmed = text.trim();
      const display = hidden ? null : (trimmed.slice(0, 500) || null);
      const first = (!hidden && trimmed.length >= 8) ? trimmed.slice(0, 200) : null;
      emittedAssistantSinceLastUser = false;
      out.push({
        kind: 'user_turn', harness: HARNESS, ts: tsFor(null),
        text: first,
        display_text: display,
      });
      continue;
    }

    if (rec.role === 'assistant') {
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          const ts = tsFor(null);
          ensureAssistantTurn(ts);
          out.push({
            kind: 'content_block', harness: HARNESS, ts,
            block_type: 'thinking', text: block.text,
          });
          continue;
        }
        if (block.type !== 'tool_use') continue;
        const name = block.name || 'unknown';
        const input = block.input || {};

        if (NOISE_TOOLS.has(name)) continue;

        if (DISPLAY_TOOLS.has(name)) {
          const visible = sendMessageText(input);
          const ts = tsFor(null);
          ensureAssistantTurn(ts);
          if (visible) {
            out.push({
              kind: 'content_block', harness: HARNESS, ts,
              block_type: 'text', text: visible,
            });
          }
          continue;
        }

        const ts = tsFor(null);
        ensureAssistantTurn(ts);
        const isBash = ['shell', 'bash', 'powershell'].includes(name.toLowerCase());
        const category = isBash ? categorizeBash(input.command) : null;
        out.push({
          kind: 'tool_use', harness: HARNESS, ts,
          tool: name, category,
          input: { ...input, file_path: input.path || input.file_path },
        });
      }
      continue;
    }

    if (rec.role === 'tool') {
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue;
        const name = block.name || 'unknown';
        const result = block.result || {};
        const ts = tsFor(resultTimestamp(result));
        if (NOISE_TOOLS.has(name) || DISPLAY_TOOLS.has(name)) continue;
        const { error, error_text } = toolResultError(result);
        const nr = {
          kind: 'tool_result', harness: HARNESS, ts,
          tool: name, error,
        };
        if (error_text) nr.error_text = error_text;
        out.push(nr);
      }
      continue;
    }

    if (rec.role) {
      out.push({
        kind: 'unknown_record', harness: HARNESS, ts: tsFor(null),
        raw_type: rec.role,
      });
    }
  }

  return out;
}