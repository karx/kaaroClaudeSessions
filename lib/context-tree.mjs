/**
 * lib/context-tree.mjs
 *
 * Pure reconstruction of a session's context tree from raw JSONL records.
 * No file I/O — takes the already-parsed records array and returns a
 * ContextTree object describing segments and turns.
 *
 * Phase 1: segment-level aggregates (tool_summary, tokens, counts, branches).
 * Phase 2: per-turn detail — user text, assistant tool calls with sanitised
 *   inputs, tool-result error status, turn duration, thinking flag.
 */

// ── Input sanitisation ────────────────────────────────────────────────────────
// Keeps the fields a human wants to read; strips large content blobs.
// Called for every tool_use block before it goes into turn.tool_calls.

function _sanitizeInput(name, input) {
  if (!input || typeof input !== 'object') return {};
  const n = (name || '').toLowerCase();

  if (n === 'bash' || n === 'powershell')
    return { command: String(input.command || input.cmd || '') };

  if (n === 'read')
    return { file_path: input.file_path || '' };

  if (n === 'write')
    // deliberately omit content — can be megabytes
    return { file_path: input.file_path || '' };

  if (n === 'edit' || n === 'multiedit') {
    const r = { file_path: input.file_path || '' };
    if (typeof input.old_string === 'string')
      r.old_string = input.old_string.slice(0, 160);
    if (typeof input.new_string === 'string')
      r.new_string = input.new_string.slice(0, 160);
    return r;
  }

  if (n === 'grep')
    return { pattern: input.pattern || '', path: input.path || input.glob || '' };

  if (n === 'glob')
    return { pattern: input.pattern || '' };

  if (n === 'agent') {
    const desc = input.description || input.prompt || '';
    return { description: typeof desc === 'string' ? desc.slice(0, 400) : '' };
  }

  if (n === 'websearch' || n === 'toolsearch')
    return { query: input.query || '' };

  if (n === 'webfetch')
    return { url: input.url || '' };

  // Unknown tool: pass through scalar fields, truncate long strings.
  const safe = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string')       safe[k] = v.length > 300 ? v.slice(0, 300) + '…' : v;
    else if (typeof v !== 'object')  safe[k] = v;
    // skip nested objects / large arrays
  }
  return safe;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _extractText(content) {
  // content may be a string (test fixtures) or an array of content blocks
  if (!content) return null;
  if (typeof content === 'string') return content.slice(0, 500) || null;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('\n')
    .trim();
  return text.slice(0, 500) || null;
}

function _newSegment(index) {
  return {
    index,
    ts_start:         null,
    ts_end:           null,
    user_turns:       0,
    assistant_turns:  0,
    tool_calls:       0,
    subagent_count:   0,
    thinking_count:   0,
    permission_modes: [],
    branches:         [],
    tool_summary:     {},
    tokens:           { output: 0, cache_read: 0 },
    compact_trigger:  null,
    turns:            [],   // Phase 2: per-turn detail
  };
}

// ── Main reconstruction ───────────────────────────────────────────────────────

/**
 * Reconstruct a ContextTree from a flat array of parsed JSONL records.
 * Pure function — no side effects, no I/O.
 *
 * @param {object[]} records — parsed JSONL records in chronological order
 * @returns {{ ai_title: string|null, segments: Segment[] }}
 */
export function reconstructContextTree(records) {
  if (!records || records.length === 0) return { ai_title: null, segments: [] };

  let aiTitle   = null;
  const segments = [];
  let seg        = _newSegment(0);
  let hasContent = false;

  // pendingAsst holds the most-recent assistant turn until the next user record
  // arrives and we can attach tool-result outcomes (is_error flags) to its calls.
  let pendingAsst = null;

  // ── Helpers to flush pendingAsst into the segment ──────────────────────────
  function _flushPending() {
    if (!pendingAsst) return;
    seg.turns.push(pendingAsst);
    pendingAsst = null;
  }

  for (const rec of records) {

    // ── Timestamps (segment-level) ──────────────────────────────────────────
    if (rec.timestamp) {
      if (!seg.ts_start) seg.ts_start = rec.timestamp;
      seg.ts_end = rec.timestamp;
    }

    // ── ai-title ────────────────────────────────────────────────────────────
    if (rec.type === 'ai-title' && !aiTitle)
      aiTitle = rec.aiTitle || rec.title || null;

    // ── Permission mode ─────────────────────────────────────────────────────
    if (rec.type === 'permission-mode' && rec.permissionMode) {
      if (!seg.permission_modes.includes(rec.permissionMode))
        seg.permission_modes.push(rec.permissionMode);
    }

    // ── Turn duration — attaches to the pending assistant turn ──────────────
    if (rec.type === 'system' && rec.subtype === 'turn_duration') {
      if (pendingAsst && rec.durationMs != null)
        pendingAsst.duration_ms = rec.durationMs;
    }

    // ── User record ─────────────────────────────────────────────────────────
    if (rec.type === 'user') {
      seg.user_turns++;
      hasContent = true;
      if (rec.gitBranch && !seg.branches.includes(rec.gitBranch))
        seg.branches.push(rec.gitBranch);

      // Attach tool-result outcomes to the still-open assistant turn, then flush
      if (pendingAsst && pendingAsst.tool_calls.length) {
        const byId = new Map(pendingAsst.tool_calls.map(tc => [tc.id, tc]));
        for (const block of (rec.message?.content || [])) {
          if (block.type !== 'tool_result') continue;
          const tc = byId.get(block.tool_use_id);
          if (!tc) continue;
          tc.is_error = block.is_error || false;
          if (block.is_error) {
            const raw = Array.isArray(block.content)
              ? block.content.map(b => b.text || '').join(' ')
              : String(block.content || '');
            tc.error_text = raw.trim().slice(0, 300) || null;
          }
        }
      }
      _flushPending();

      // Emit a user turn only when there is actual human-typed text.
      // Tool-result-only records are bookkeeping, not conversation.
      const text = _extractText(rec.message?.content ?? rec.message);
      const hasToolResults = Array.isArray(rec.message?.content)
        && rec.message.content.some(b => b.type === 'tool_result');
      if (text && !(hasToolResults && !text.replace(/\s/g, ''))) {
        seg.turns.push({
          role:        'user',
          ts:          rec.timestamp || null,
          text,
          tool_calls:  [],
          has_thinking: false,
          usage:        null,
          duration_ms:  null,
          stop_reason:  null,
        });
      }
    }

    // ── Assistant record ────────────────────────────────────────────────────
    if (rec.type === 'assistant' && rec.message) {
      seg.assistant_turns++;
      hasContent = true;
      const u = rec.message.usage || {};
      seg.tokens.output     += u.output_tokens             || 0;
      seg.tokens.cache_read += u.cache_read_input_tokens   || 0;

      let hasThinking = false;
      const toolCalls = [];
      const textParts = [];

      for (const block of (rec.message.content || [])) {
        if (block.type === 'thinking') {
          seg.thinking_count++;
          hasThinking = true;
        }
        if (block.type === 'text')
          textParts.push(block.text || '');
        if (block.type === 'tool_use') {
          const name = block.name || 'unknown';
          seg.tool_summary[name] = (seg.tool_summary[name] || 0) + 1;
          seg.tool_calls++;
          if (name === 'Agent') seg.subagent_count++;

          toolCalls.push({
            id:         block.id || null,
            name,
            input:      _sanitizeInput(name, block.input),
            is_error:   null,   // filled in when the next user record arrives
            error_text: null,
          });
        }
      }

      // Flush any previous pending (shouldn't normally happen, but be safe)
      _flushPending();

      pendingAsst = {
        role:        'assistant',
        ts:          rec.timestamp || null,
        text:        textParts.join('\n').trim().slice(0, 500) || null,
        tool_calls:  toolCalls,
        has_thinking: hasThinking,
        usage: {
          output:     u.output_tokens           || 0,
          cache_read: u.cache_read_input_tokens || 0,
        },
        duration_ms:  null,
        stop_reason:  rec.message.stop_reason || null,
      };
    }

    // ── Compact boundary — close segment ────────────────────────────────────
    if (rec.type === 'system' && rec.subtype === 'compact_boundary') {
      _flushPending();
      seg.compact_trigger = 'auto';
      segments.push(seg);
      seg        = _newSegment(segments.length);
      hasContent = false;
    }
  }

  // Final open segment
  _flushPending();
  if (hasContent) {
    seg.compact_trigger = null;
    segments.push(seg);
  }

  return { ai_title: aiTitle, segments };
}
