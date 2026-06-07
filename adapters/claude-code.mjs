/**
 * adapters/claude-code.mjs
 *
 * Converts Claude Code JSONL records → NormalizedRecord[].
 */

import { extractTextFromContent, extractSkills } from '../lib/analyze-helpers.mjs';

const HARNESS = 'claude-code';

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

    if (rec.type === 'permission-mode') {
      out.push({ kind: 'permission_mode', harness: HARNESS, ts, mode: rec.permissionMode });
    }

    if (rec.type === 'system' && rec.subtype === 'compact_boundary') {
      out.push({ kind: 'context_reset', harness: HARNESS, ts });
    }

    if (rec.type === 'ai-title') {
      out.push({
        kind: 'session_meta', harness: HARNESS, ts,
        ai_title: rec.aiTitle || rec.title || null,
      });
    }

    if (rec.type === 'system' && rec.subtype === 'turn_duration') {
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
        out.push({ kind: 'assistant_turn', harness: HARNESS, ts, content_block: bt });
        if (bt === 'tool_use') {
          out.push({
            kind: 'tool_use', harness: HARNESS, ts,
            tool: block.name || 'unknown',
            input: block.input || {},
          });
        }
      }
    }
  }

  return out;
}

