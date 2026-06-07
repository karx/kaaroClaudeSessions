/**
 * lib/context-tree.mjs
 *
 * Pure reconstruction of a session's context tree from raw JSONL records.
 * No file I/O — takes the already-parsed records array and returns a
 * structured ContextTree object describing segments, tool usage, and metadata.
 *
 * Phase 1 (no subagent recursion): each segment summarises turns between
 * compact_boundary events with per-tool counts, branch/permission tracking,
 * and token accumulation.
 */

/**
 * @typedef {Object} Segment
 * @property {number}   index             — zero-based segment index
 * @property {string|null} ts_start       — ISO timestamp of first record in segment
 * @property {string|null} ts_end         — ISO timestamp of last record (incl. compact)
 * @property {number}   user_turns
 * @property {number}   assistant_turns
 * @property {number}   tool_calls        — total tool_use blocks in this segment
 * @property {number}   subagent_count    — Agent tool_use count
 * @property {number}   thinking_count    — thinking content blocks
 * @property {string[]} permission_modes  — unique modes seen in this segment
 * @property {string[]} branches          — unique git branches seen
 * @property {Object}   tool_summary      — { [toolName]: count }
 * @property {{ output: number, cache_read: number }} tokens
 * @property {string|null} compact_trigger — 'auto' | null (last segment)
 */

/**
 * @typedef {Object} ContextTree
 * @property {string|null}  ai_title
 * @property {Segment[]}    segments
 */

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
  };
}

/**
 * Reconstruct a ContextTree from a flat array of parsed JSONL records.
 * Pure function — no side effects, no I/O.
 *
 * @param {object[]} records — parsed JSONL records in chronological order
 * @returns {ContextTree}
 */
export function reconstructContextTree(records) {
  if (!records || records.length === 0) return { ai_title: null, segments: [] };

  let aiTitle = null;
  const segments = [];
  let seg = _newSegment(0);
  let hasContent = false;

  for (const rec of records) {
    if (rec.timestamp) {
      if (!seg.ts_start) seg.ts_start = rec.timestamp;
      seg.ts_end = rec.timestamp;
    }

    if (rec.type === 'ai-title' && !aiTitle)
      aiTitle = rec.aiTitle || rec.title || null;

    if (rec.type === 'permission-mode' && rec.permissionMode) {
      if (!seg.permission_modes.includes(rec.permissionMode))
        seg.permission_modes.push(rec.permissionMode);
    }

    if (rec.type === 'user') {
      seg.user_turns++;
      hasContent = true;
      if (rec.gitBranch && !seg.branches.includes(rec.gitBranch))
        seg.branches.push(rec.gitBranch);
    }

    if (rec.type === 'assistant' && rec.message) {
      seg.assistant_turns++;
      hasContent = true;
      const u = rec.message.usage || {};
      seg.tokens.output    += u.output_tokens             || 0;
      seg.tokens.cache_read += u.cache_read_input_tokens  || 0;

      for (const block of (rec.message.content || [])) {
        if (block.type === 'thinking') seg.thinking_count++;
        if (block.type === 'tool_use') {
          const name = block.name || 'unknown';
          seg.tool_summary[name] = (seg.tool_summary[name] || 0) + 1;
          seg.tool_calls++;
          if (name === 'Agent') seg.subagent_count++;
        }
      }
    }

    if (rec.type === 'system' && rec.subtype === 'compact_boundary') {
      seg.compact_trigger = 'auto';
      segments.push(seg);
      seg = _newSegment(segments.length);
      hasContent = false;
    }
  }

  // Only push the final open segment if it contains real content
  if (hasContent) {
    seg.compact_trigger = null;
    segments.push(seg);
  }

  return { ai_title: aiTitle, segments };
}
