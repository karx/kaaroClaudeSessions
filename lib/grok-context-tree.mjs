/**
 * lib/grok-context-tree.mjs
 *
 * Reconstructs a ContextTree from Grok updates.jsonl ACP records.
 * Output shape matches lib/context-tree.mjs for thread/trace UI.
 */

import {
  grokRecordTs, grokSessionUpdate, isGrokToolFailure,
} from './grok-helpers.mjs';

const COMPACT_EVENTS = new Set(['auto_compact_completed', 'compaction_checkpoint']);
const THOUGHT = 'agent_thought_chunk';
const MESSAGE = 'agent_message_chunk';

function _sanitizeGrokInput(title, raw = {}) {
  const t = title || 'unknown';
  if (t === 'Shell')
    return { command: String(raw.command || '').slice(0, 300) };
  if (t === 'Read' || t === 'Write')
    return { file_path: String(raw.path || raw.file_path || '').replace(/\\/g, '/') };
  if (t === 'StrReplace' || t === 'EditNotebook') {
    const r = { file_path: String(raw.path || '').replace(/\\/g, '/') };
    if (typeof raw.old_string === 'string') r.old_string = raw.old_string.slice(0, 160);
    if (typeof raw.new_string === 'string') r.new_string = raw.new_string.slice(0, 160);
    return r;
  }
  if (t === 'Grep')
    return { pattern: raw.pattern || '', path: raw.path || '' };
  if (t === 'Glob')
    return { pattern: raw.glob_pattern || '' };
  if (t === 'Task')
    return { description: String(raw.description || '').slice(0, 400) };

  const safe = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') safe[k] = v.length > 300 ? v.slice(0, 300) + '…' : v;
    else if (typeof v !== 'object') safe[k] = v;
  }
  return safe;
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
    turns:            [],
  };
}

function _newPending(turnStartMs, ts) {
  return {
    turnStartMs,
    ts,
    textParts:    [],
    tool_calls:   [],
    has_thinking: false,
    byToolId:     new Map(),
  };
}

/**
 * @param {object[]} records — parsed updates.jsonl
 * @param {{ ai_title?: string|null, git_branch?: string|null }} [opts]
 */
export function reconstructGrokContextTree(records, opts = {}) {
  if (!records?.length) {
    return { ai_title: opts.ai_title ?? null, segments: [] };
  }

  let aiTitle   = opts.ai_title ?? null;
  const segments = [];
  let seg        = _newSegment(0);
  let hasContent = false;
  let pending    = null;

  function _trackTs(ts) {
    if (!ts) return;
    if (!seg.ts_start) seg.ts_start = ts;
    seg.ts_end = ts;
  }

  function _flushPending() {
    if (!pending) return;
    const text = pending.textParts.join('').trim().slice(0, 500) || null;
    const hasTools = pending.tool_calls.length > 0;
    if (text || hasTools) {
      seg.assistant_turns++;
      hasContent = true;
      seg.turns.push({
        role:         'assistant',
        ts:           pending.ts,
        text,
        tool_calls:   pending.tool_calls,
        has_thinking: pending.has_thinking,
        usage:        null,
        duration_ms:  null,
        stop_reason:  null,
      });
    }
    pending = null;
  }

  function _ensurePending(turnStartMs, ts) {
    const key = turnStartMs ?? '__none__';
    if (pending && pending.turnStartMs !== key) _flushPending();
    if (!pending) pending = _newPending(key, ts);
    else if (ts && !pending.ts) pending.ts = ts;
  }

  for (const rec of records) {
    const su  = grokSessionUpdate(rec);
    if (!su) continue;
    const ts  = grokRecordTs(rec);
    const upd = rec.params?.update || {};
    _trackTs(ts);

    if (opts.git_branch && !seg.branches.includes(opts.git_branch))
      seg.branches.push(opts.git_branch);

    if (su === 'user_message_chunk') {
      _flushPending();
      const text = upd.content?.text?.trim() || '';
      if (text) {
        seg.user_turns++;
        hasContent = true;
        seg.turns.push({
          role: 'user', ts,
          text: text.slice(0, 500),
          tool_calls: [], has_thinking: false,
          usage: null, duration_ms: null, stop_reason: null,
        });
      }
      continue;
    }

    if (COMPACT_EVENTS.has(su)) {
      _flushPending();
      seg.compact_trigger = 'auto';
      segments.push(seg);
      seg = _newSegment(segments.length);
      hasContent = false;
      continue;
    }

    const turnStartMs = rec._meta?.turnStartMs ?? null;

    if (su === THOUGHT) {
      _ensurePending(turnStartMs, ts);
      pending.has_thinking = true;
      seg.thinking_count++;
      hasContent = true;
      continue;
    }

    if (su === MESSAGE) {
      const chunk = upd.content?.text || '';
      if (chunk) {
        _ensurePending(turnStartMs, ts);
        pending.textParts.push(chunk);
        hasContent = true;
      }
      continue;
    }

    if (su === 'tool_call') {
      const title = upd.title || 'unknown';
      const raw   = upd.rawInput || {};
      _ensurePending(turnStartMs, ts);

      const tc = {
        id:         upd.toolCallId || null,
        name:       title,
        input:      _sanitizeGrokInput(title, raw),
        is_error:   null,
        error_text: null,
      };
      pending.tool_calls.push(tc);
      if (tc.id) pending.byToolId.set(tc.id, tc);

      seg.tool_summary[title] = (seg.tool_summary[title] || 0) + 1;
      seg.tool_calls++;
      if (title === 'Task') seg.subagent_count++;
      hasContent = true;
      continue;
    }

    if (su === 'tool_call_update' && isGrokToolFailure(upd)) {
      const tc = pending?.byToolId.get(upd.toolCallId);
      if (tc) {
        tc.is_error = true;
        const stderr = upd.rawOutput?.stderr || upd.rawOutput?.stdout || '';
        tc.error_text = String(stderr).trim().slice(0, 300) || 'non-zero exit';
      }
    }
  }

  _flushPending();
  if (hasContent) {
    seg.compact_trigger = null;
    segments.push(seg);
  }

  return { ai_title: aiTitle, segments };
}