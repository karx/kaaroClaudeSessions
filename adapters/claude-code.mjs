/**
 * adapters/claude-code.mjs
 *
 * Converts Claude Code JSONL records → NormalizedRecord[].
 */

import { extractTextFromContent, extractSkills, categorizeBash } from '../lib/analyze-helpers.mjs';

const HARNESS = 'claude-code';

const KNOWN_TYPES = new Set([
  'permission-mode', 'system', 'ai-title', 'user', 'assistant',
]);

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

  for (const rec of records) {
    const ts = rec.timestamp ?? null;
    let handled = false;

    if (rec.type === 'permission-mode') {
      handled = true;
      out.push({ kind: 'permission_mode', harness: HARNESS, ts, mode: rec.permissionMode });
    }

    if (rec.type === 'system' && rec.subtype === 'compact_boundary') {
      handled = true;
      out.push({ kind: 'context_reset', harness: HARNESS, ts });
    }

    if (rec.type === 'ai-title') {
      handled = true;
      out.push({
        kind: 'session_meta', harness: HARNESS, ts,
        ai_title: rec.aiTitle || rec.title || null,
      });
    }

    if (rec.type === 'system' && rec.subtype === 'turn_duration') {
      handled = true;
      out.push({
        kind: 'session_meta', harness: HARNESS, ts,
        slug:         rec.slug,
        duration_ms:  rec.durationMs,
        message_count: rec.messageCount,
        version:      rec.version,
        entrypoint:   rec.entrypoint,
        cwd:          rec.cwd,
        branch:       rec.gitBranch,
      });
      if (rec.gitBranch)
        out.push({ kind: 'branch_change', harness: HARNESS, ts, branch: rec.gitBranch });
    }

    if (rec.type === 'user' && rec.message) {
      handled = true;
      const text = extractTextFromContent(rec.message.content);
      let userText = null;
      if (!firstUserSeen) {
        const stripped = stripFirstUserMessage(text);
        if (stripped.length >= 8
            && !stripped.startsWith('Base directory for this skill')
            && !stripped.startsWith('Caveat:')) {
          userText = stripped;
          firstUserSeen = true;
        }
      }

      out.push({
        kind: 'user_turn', harness: HARNESS, ts, text: userText,
        version: rec.version, entrypoint: rec.entrypoint,
        cwd: rec.cwd, branch: rec.gitBranch,
      });

      if (rec.gitBranch)
        out.push({ kind: 'branch_change', harness: HARNESS, ts, branch: rec.gitBranch });

      for (const s of extractSkills(text)) {
        out.push({ kind: 'skill_invoke', harness: HARNESS, ts, skill: s });
      }

      if (Array.isArray(rec.message.content)) {
        for (const block of rec.message.content) {
          if (block.type === 'tool_result' && block.is_error) {
            out.push({
              kind: 'tool_result', harness: HARNESS, ts, error: true,
              tool: block.tool_name || 'unknown',
            });
          }
        }
      }
    }

    if (rec.type === 'assistant' && rec.message) {
      handled = true;
      const msg = rec.message;
      out.push({
        kind: 'assistant_turn', harness: HARNESS, ts,
        model: msg.model, stop_reason: msg.stop_reason,
      });

      if (msg.usage !== undefined) {
        const u = msg.usage || {};
        out.push({
          kind: 'tokens', harness: HARNESS, ts,
          tokens: {
            input:        u.input_tokens                || 0,
            output:       u.output_tokens               || 0,
            cache_create: u.cache_creation_input_tokens || 0,
            cache_read:   u.cache_read_input_tokens     || 0,
          },
        });
      }

      for (const block of (msg.content || [])) {
        const bt = block.type || 'unknown';
        const cbNR = { kind: 'content_block', harness: HARNESS, ts, block_type: bt };
        if (bt === 'text') cbNR.text = block.text;
        out.push(cbNR);
        if (bt === 'tool_use') {
          const name = block.name || 'unknown';
          const isBash = ['bash', 'powershell', 'shell', 'run_command'].includes(name.toLowerCase());
          const category = isBash ? categorizeBash(block.input?.command) : null;
          out.push({
            kind: 'tool_use', harness: HARNESS, ts,
            tool: name, category,
            input: block.input || {},
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
