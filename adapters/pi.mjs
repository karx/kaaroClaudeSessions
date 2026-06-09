/**
 * adapters/pi.mjs
 *
 * Converts Pi JSONL records → NormalizedRecord[].
 */

import { categorizeBash } from '../lib/analyze-helpers.mjs';

const HARNESS = 'pi';

function extractUserText(content) {
  return (Array.isArray(content) ? content : [])
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {object[]} records — raw Pi JSONL records
 * @returns {object[]} NormalizedRecord[]
 */
export function recordsToNormalized(records) {
  const out = [];

  for (const rec of records) {
    const ts = rec.timestamp ?? null;
    let handled = false;

    if (rec.type === 'session') {
      handled = true;
      if (rec.cwd) {
        out.push({ kind: 'session_meta', harness: HARNESS, ts, cwd: rec.cwd });
      }
    }

    if (rec.type === 'model_change') {
      handled = true;
      const model = [rec.provider, rec.modelId].filter(Boolean).join('/') || null;
      if (model) out.push({ kind: 'session_meta', harness: HARNESS, ts, model, overwrite: true });
    }

    if (rec.type === 'message' && rec.message) {
      handled = true;
      const msg = rec.message;

      if (msg.role === 'user') {
        const text = extractUserText(msg.content);
        out.push({
          kind: 'user_turn', harness: HARNESS, ts,
          text: text.length >= 8 ? text.slice(0, 200) : null,
        });
      }

      if (msg.role === 'assistant') {
        const model = [msg.provider, msg.model].filter(Boolean).join('/') || null;
        out.push({
          kind: 'assistant_turn', harness: HARNESS, ts,
          model, stop_reason: msg.stopReason, overwrite: true,
        });

        if (msg.usage !== undefined) {
          const u = msg.usage || {};
          out.push({
            kind: 'tokens', harness: HARNESS, ts,
            tokens: {
              input:        u.input      || 0,
              output:       u.output     || 0,
              cache_create: u.cacheWrite || 0,
              cache_read:   u.cacheRead  || 0,
            },
          });
        }

        for (const block of (msg.content || [])) {
          if (block.type !== 'toolCall') continue;
          const name     = block.name || 'unknown';
          const args     = block.arguments || {};
          const isBash   = ['bash', 'shell', 'powershell'].includes(name.toLowerCase());
          const category = isBash ? categorizeBash(args.command) : null;
          out.push({
            kind: 'tool_use', harness: HARNESS, ts,
            tool: name, category,
            input: {
              file_path: args.path,
              path:      args.path,
              command:   args.command,
            },
          });
        }
      }
    }

    if (!handled) {
      out.push({ kind: 'unknown_record', harness: HARNESS, ts, raw_type: rec.type });
    }
  }

  return out;
}
