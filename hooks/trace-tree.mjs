/**
 * hooks/trace-tree.mjs — unified ContextTree reconstruction from
 * NormalizedRecords. Replaces the per-harness context-tree.mjs (raw CC
 * records) and grok-context-tree.mjs (raw ACP records): every harness's
 * adapter now feeds one reconstruction.
 *
 * Output shape (consumed by trace-panel / thread-view / /api/trace):
 *   { ai_title, segments[] } — segments delimited by context_reset NRs;
 *   each segment carries aggregates + per-turn detail (turns[]).
 *
 * Pure function — no I/O. Reading records + adapter dispatch live in
 * surface/trace-service.mjs.
 */

// ── Input sanitisation ────────────────────────────────────────────────────────
// Keeps the fields a human wants to read; strips large content blobs.
// Tool-name aliases across harnesses (Bash/Shell, Edit/StrReplace, …) are
// handled here — adapters pass raw input with a normalised file_path alias.

function _sanitizeInput(name, input) {
  if (!input || typeof input !== 'object') return {};
  const n = (name || '').toLowerCase();

  if (['bash', 'powershell', 'shell', 'run_command'].includes(n))
    return { command: String(input.command || input.cmd || '').slice(0, 300) };

  if (['read', 'view_file', 'read_file'].includes(n))
    return { file_path: String(input.file_path || '').replace(/\\/g, '/') };

  if (['write', 'write_to_file'].includes(n))
    // deliberately omit content — can be megabytes
    return { file_path: String(input.file_path || '').replace(/\\/g, '/') };

  if (['edit', 'multiedit', 'strreplace', 'editnotebook',
       'replace_file_content', 'search_replace'].includes(n)) {
    const r = { file_path: String(input.file_path || '').replace(/\\/g, '/') };
    if (typeof input.old_string === 'string') r.old_string = input.old_string.slice(0, 160);
    if (typeof input.new_string === 'string') r.new_string = input.new_string.slice(0, 160);
    return r;
  }

  if (['grep', 'grep_search'].includes(n))
    return { pattern: input.pattern || '', path: input.path || input.glob || '' };

  if (n === 'glob')
    return { pattern: input.pattern || input.glob_pattern || '' };

  if (['agent', 'task'].includes(n)) {
    const desc = input.description || input.prompt || '';
    return { description: typeof desc === 'string' ? desc.slice(0, 400) : '' };
  }

  if (['websearch', 'toolsearch'].includes(n))
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

/** Shared turn-text cap for thr-turn-text (user + assistant). */
const TURN_TEXT_CAP = 500;

function _capTurnText(s) {
  if (s == null) return null;
  const t = String(s).slice(0, TURN_TEXT_CAP);
  return t || null;
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

/**
 * @param {object[]} nrs — NormalizedRecord[] in chronological order
 * @param {{
 *   ai_title?: string|null,
 *   git_branch?: string|null,
 *   spawns?: object[],
 *   childTrees?: Record<string, object>,
 * }} [opts] —
 *   side-channel metadata for harnesses that store it outside the transcript
 *   (grok summary.json). Optional spawns / childTrees attach SubagentRefs
 *   without I/O in this module.
 * @returns {{ ai_title: string|null, segments: object[], subagents?: object[] }}
 */
export function reconstructTraceFromNRs(nrs, opts = {}) {
  if (!nrs || nrs.length === 0) {
    const empty = { ai_title: opts.ai_title ?? null, segments: [] };
    if (opts.spawns) empty.subagents = _materializeSpawns(opts.spawns, opts.childTrees);
    return empty;
  }

  let aiTitle    = opts.ai_title ?? null;
  const segments = [];
  let seg        = _newSegment(0);
  let hasContent = false;
  let pending    = null;            // open assistant turn
  let toolById   = new Map();       // tool_id → tool-call object (per segment)
  const spawnByToolId = _indexSpawns(opts.spawns);

  function _addBranch(branch) {
    if (branch && !seg.branches.includes(branch)) seg.branches.push(branch);
  }

  function _assembleText(parts) {
    let buf = '';
    for (const p of parts) {
      if (!p.text) continue;
      buf += (p.chunk || buf === '') ? p.text : '\n' + p.text;
    }
    return _capTurnText(buf.trim());
  }

  function _flushPending() {
    if (!pending) return;
    const turn = {
      role:         'assistant',
      ts:           pending.ts,
      text:         _assembleText(pending.parts),
      tool_calls:   pending.tool_calls,
      has_thinking: pending.has_thinking,
      usage:        pending.usage,
      duration_ms:  pending.duration_ms,
      stop_reason:  pending.stop_reason,
    };
    if (spawnByToolId.size) {
      const spawned = [];
      for (const tc of pending.tool_calls) {
        if (tc.name !== 'Agent' && tc.name !== 'Task') continue;
        if (!tc.id || !spawnByToolId.has(tc.id)) continue;
        spawned.push(_cloneSpawn(spawnByToolId.get(tc.id), opts.childTrees));
      }
      if (spawned.length) turn.spawned_subagents = spawned;
    }
    seg.turns.push(turn);
    pending = null;
  }

  function _ensurePending(ts) {
    if (!pending) {
      pending = {
        ts, parts: [], tool_calls: [], has_thinking: false,
        usage: null, duration_ms: null, stop_reason: null,
      };
    }
  }

  function _closeSegment(trigger) {
    _flushPending();
    if (opts.git_branch) _addBranch(opts.git_branch);
    seg.compact_trigger = trigger;
    segments.push(seg);
    seg        = _newSegment(segments.length);
    hasContent = false;
    toolById   = new Map();
  }

  for (const nr of nrs) {
    if (nr.ts) {
      if (!seg.ts_start) seg.ts_start = nr.ts;
      seg.ts_end = nr.ts;
    }

    switch (nr.kind) {

      case 'session_meta': {
        if (nr.ai_title && !aiTitle) aiTitle = nr.ai_title;
        if (nr.duration_ms != null && pending) pending.duration_ms = nr.duration_ms;
        break;
      }

      case 'permission_mode': {
        if (nr.mode && !seg.permission_modes.includes(nr.mode))
          seg.permission_modes.push(nr.mode);
        break;
      }

      case 'branch_change': {
        _addBranch(nr.branch);
        break;
      }

      case 'user_turn': {
        _flushPending();
        seg.user_turns++;
        hasContent = true;
        _addBranch(nr.branch);
        const text = _capTurnText(nr.display_text ?? nr.text ?? null);
        if (text) {
          seg.turns.push({
            role:        'user',
            ts:          nr.ts || null,
            text,
            tool_calls:  [],
            has_thinking: false,
            usage:        null,
            duration_ms:  null,
            stop_reason:  null,
          });
        }
        break;
      }

      case 'assistant_turn': {
        _flushPending();
        seg.assistant_turns++;
        hasContent = true;
        _ensurePending(nr.ts || null);
        pending.stop_reason = nr.stop_reason || null;
        break;
      }

      case 'tokens': {
        const t = nr.tokens || {};
        seg.tokens.output     += t.output     || 0;
        seg.tokens.cache_read += t.cache_read || 0;
        if (pending) {
          pending.usage = { output: t.output || 0, cache_read: t.cache_read || 0 };
        }
        break;
      }

      case 'content_block': {
        if (nr.block_type === 'thinking') {
          _ensurePending(nr.ts || null);
          pending.has_thinking = true;
          seg.thinking_count++;
          hasContent = true;
        } else if (nr.block_type === 'text' && nr.text) {
          _ensurePending(nr.ts || null);
          pending.parts.push({ text: nr.text, chunk: !!nr.chunk });
          hasContent = true;
        }
        break;
      }

      case 'tool_use': {
        _ensurePending(nr.ts || null);
        const name = nr.tool || 'unknown';
        seg.tool_summary[name] = (seg.tool_summary[name] || 0) + 1;
        seg.tool_calls++;
        if (['Agent', 'Task', 'spawn_subagent', 'invoke_subagent'].includes(name)) seg.subagent_count++;

        hasContent = true;

        const tc = {
          id:         nr.tool_id || null,
          name,
          input:      _sanitizeInput(name, nr.input),
          is_error:   null,
          error_text: null,
        };
        pending.tool_calls.push(tc);
        if (tc.id) toolById.set(tc.id, tc);
        break;
      }

      case 'tool_result': {
        // Tool-call objects stay referenced after their turn is flushed —
        // attaching by id works whether or not the assistant turn is open.
        const tc = nr.tool_id ? toolById.get(nr.tool_id) : null;
        if (tc) {
          tc.is_error = nr.error || false;
          if (nr.error) tc.error_text = nr.error_text ?? null;
        }
        break;
      }

      case 'context_reset': {
        _closeSegment('auto');
        break;
      }

      // tokens-less assistant proxies, scaffolds, attachments, skills,
      // api_errors, unknowns: no trace-tree contribution today.
      default: break;
    }
  }

  _flushPending();
  if (hasContent) {
    if (opts.git_branch) _addBranch(opts.git_branch);
    seg.compact_trigger = null;
    segments.push(seg);
  }

  const out = { ai_title: aiTitle, segments };
  if (opts.spawns) out.subagents = _materializeSpawns(opts.spawns, opts.childTrees);
  return out;
}

/** @param {object[]|undefined} spawns */
function _indexSpawns(spawns) {
  const map = new Map();
  if (!Array.isArray(spawns)) return map;
  for (const s of spawns) {
    if (s?.tool_use_id) map.set(s.tool_use_id, s);
  }
  return map;
}

/**
 * Lookup key for nested child trees. Prefer tool_use_id; fall back to
 * agent:<id> when meta.toolUseId is missing (real CC metas sometimes empty).
 */
export function childTreeKey(spawn) {
  if (!spawn) return null;
  if (spawn.tool_use_id) return spawn.tool_use_id;
  if (spawn.agent_id) return `agent:${spawn.agent_id}`;
  return null;
}

function _lookupChildTree(spawn, childTrees) {
  if (!childTrees || !spawn) return undefined;
  if (spawn.tool_use_id && childTrees[spawn.tool_use_id] != null)
    return childTrees[spawn.tool_use_id];
  if (spawn.agent_id) {
    const k = `agent:${spawn.agent_id}`;
    if (childTrees[k] != null) return childTrees[k];
  }
  return undefined;
}

function _cloneSpawn(spawn, childTrees) {
  // Public API ref: no host filesystem paths (service keeps them for I/O only).
  const { jsonl_path: _dropPath, meta_path: _dropMeta, ...rest } = spawn || {};
  const ref = { ...rest };
  const nested = _lookupChildTree(spawn, childTrees);
  if (nested !== undefined) ref.tree = nested;
  return ref;
}

function _materializeSpawns(spawns, childTrees) {
  if (!Array.isArray(spawns)) return [];
  return spawns.map(s => _cloneSpawn(s, childTrees));
}
