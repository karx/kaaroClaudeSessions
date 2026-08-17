/**
 * adapters/command-code.mjs
 *
 * Converts Command Code JSONL records → NormalizedRecord[].
 *
 * CC record structure:
 *   id, timestamp, sessionId, parentId, role (user|assistant|tool),
 *   content: [{ type: text|reasoning|tool-call|tool-result, ... }],
 *   gitBranch, metadata: { timestamp, source, version (or messageId for user) }
 *
 * CC has no usage/token data and no compact_boundary/permission-mode records.
 * Titles are stored in sibling .meta.json files (read by the analyzer).
 */

import { categorizeBash } from '../helpers/analyze-helpers.mjs';

const HARNESS = 'command-code';

function extractUserText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text').map(b => b.text || '').join(' ');
}

function stripFirstUserMessage(text) {
  return text
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * @param {object[]} records — raw CC JSONL records
 * @returns {object[]} NormalizedRecord[]
 */
export function recordsToNormalized(records) {
  const out = [];
  let firstUserSeen = false;
  let lastBranch = null;

  for (const rec of records) {
    const ts = rec.timestamp ?? null;

    // Track branch changes (gitBranch is on every record)
    if (rec.gitBranch && rec.gitBranch !== lastBranch) {
      if (lastBranch !== null) {
        out.push({ kind: 'branch_change', harness: HARNESS, ts, branch: rec.gitBranch });
      }
      lastBranch = rec.gitBranch;
    }

    if (rec.role === 'user' && rec.content) {
      const text = extractUserText(rec.content);
      let userText = null;
      if (!firstUserSeen) {
        const stripped = stripFirstUserMessage(text);
        if (stripped.length >= 8) {
          userText = stripped;
          firstUserSeen = true;
        }
      }

      // display_text from text blocks only (extractUserText); tool-result-only → null.
      // Hybrid user rows (human text + tool-result) still surface the human text.
      const displayText = text ? text.trim().slice(0, 500) || null : null;

      out.push({
        kind: 'user_turn', harness: HARNESS, ts, text: userText,
        display_text: displayText,
        branch: rec.gitBranch || null,
      });

      if (Array.isArray(rec.content)) {
        for (const block of rec.content) {
          if (block.type !== 'tool-result') continue;
          const nr = {
            kind: 'tool_result', harness: HARNESS, ts,
            error: block.output?.type === 'error-text',
            tool: block.toolName || 'unknown',
            tool_id: block.toolCallId || undefined,
          };
          if (nr.error) {
            nr.error_text = String(block.output?.value || '').trim().slice(0, 300) || undefined;
          }
          out.push(nr);
        }
      }
    }

    if (rec.role === 'assistant' && rec.content) {
      out.push({
        kind: 'assistant_turn', harness: HARNESS, ts,
        model: null, stop_reason: null,
      });

      for (const block of rec.content) {
        const bt = block.type || 'unknown';
        // reasoning → thinking so trace-tree counts has_thinking / thinking_count
        const blockType = bt === 'reasoning' ? 'thinking' : bt;
        const cbNR = { kind: 'content_block', harness: HARNESS, ts, block_type: blockType };
        if (bt === 'text') cbNR.text = block.text;
        if (bt === 'reasoning' && block.text) cbNR.text = block.text;
        out.push(cbNR);

        if (bt === 'tool-call') {
          const name = block.toolName || 'unknown';
          const isBash = ['bash', 'powershell', 'shell'].includes(name.toLowerCase());
          const category = isBash ? categorizeBash(block.input?.command) : null;
          out.push({
            kind: 'tool_use', harness: HARNESS, ts,
            tool: name, category,
            tool_id: block.toolCallId || undefined,
            input: block.input || {},
          });
        }
      }
    }

    if (rec.role === 'tool') {
      // Tool result records - these are the standalone tool result messages
      // (CC puts tool results in both user content blocks and standalone tool role messages)
      if (Array.isArray(rec.content)) {
        for (const block of rec.content) {
          if (block.type !== 'tool-result') continue;
          const nr = {
            kind: 'tool_result', harness: HARNESS, ts,
            error: block.output?.type === 'error-text',
            tool: block.toolName || 'unknown',
            tool_id: block.toolCallId || undefined,
          };
          if (nr.error) {
            nr.error_text = String(block.output?.value || '').trim().slice(0, 300) || undefined;
          }
          out.push(nr);
        }
      }
    }
  }

  return out;
}
