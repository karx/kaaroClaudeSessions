/**
 * lib/sessions-schema.mjs
 *
 * Canonical schema for sessions-data.json.
 * All parser adapters (claude-code, pi, opencode, copilot) must produce data
 * that satisfies validateSessionsData(). The build pipeline trusts this shape.
 *
 * Required fields are the minimum the graph builder needs to render a node.
 * Optional fields add richer encoding (tooltips, swimlane bars, recency).
 */

/**
 * Validate the top-level sessions-data.json payload.
 * Returns { ok: true } or { ok: false, errors: string[] }.
 */
export function validateSessionsData(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['root must be an object'] };
  }

  if (!Array.isArray(data.projects)) errors.push('missing: data.projects (array)');
  if (!Array.isArray(data.sessions)) errors.push('missing: data.sessions (array)');
  if (!data.meta || typeof data.meta !== 'object') errors.push('missing: data.meta (object)');

  if (errors.length) return { ok: false, errors };

  for (const [i, p] of data.projects.entries()) {
    const pe = validateProject(p);
    if (pe.length) errors.push(`projects[${i}] (${p.id}): ${pe.join(', ')}`);
  }

  for (const [i, s] of data.sessions.entries()) {
    const se = validateSession(s);
    if (se.length) errors.push(`sessions[${i}] (${s.session_id}): ${se.join(', ')}`);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Required fields for a project entry. */
export function validateProject(p) {
  const errors = [];
  if (!p.id)            errors.push('missing id');
  if (!p.label)         errors.push('missing label');
  if (typeof p.session_count !== 'number') errors.push('session_count must be number');
  if (!p.tokens || typeof p.tokens !== 'object') {
    errors.push('missing tokens object');
  } else {
    for (const k of ['input', 'output', 'cache_create', 'cache_read']) {
      if (typeof p.tokens[k] !== 'number') errors.push(`tokens.${k} must be number`);
    }
  }
  return errors;
}

/**
 * Required fields for a session entry.
 * Harnesses that cannot populate optional fields should omit them (not null).
 */
export function validateSession(s) {
  const errors = [];
  if (!s.session_id)  errors.push('missing session_id');
  if (!s.project_id)  errors.push('missing project_id');

  // tokens block — all numeric, default to 0 if not tracked
  if (!s.tokens || typeof s.tokens !== 'object') {
    errors.push('missing tokens object');
  } else {
    for (const k of ['input', 'output', 'cache_create', 'cache_read']) {
      if (s.tokens[k] !== undefined && typeof s.tokens[k] !== 'number')
        errors.push(`tokens.${k} must be number if present`);
    }
  }

  return errors;
}

/**
 * OPTIONAL SESSION FIELDS — not validated but documented here as the contract
 * for what the graph builder may consume.
 *
 * first_timestamp  : ISO string  — session start; used for timeline/swimlane
 * last_timestamp   : ISO string  — used for recency + in-flight detection
 * duration_min     : number      — session wall-clock minutes
 * git_branch       : string      — branch name; drives branch sub-rows
 * slug             : string      — short human label for the session
 * date_str         : string      — e.g. "2026-05-11"
 * model            : string      — e.g. "claude-sonnet-4-6"
 * tool_calls       : number
 * tool_errors      : number
 * tool_diversity   : number      — distinct tool types used
 * message_count    : number
 * user_turns       : number
 * assistant_turns  : number
 * cache_hit_rate   : number      — percent
 * skills           : string[]    — slash-commands used
 * bash_categories  : object      — { git, npm, ... }
 * content_blocks   : object      — { thinking, ... }
 * stop_reasons     : object      — { max_tokens, ... }
 * first_user_message: string
 * file_ops         : object      — { [path]: { read, write, edit } }
 * source           : string      — harness identifier: 'claude-code'|'pi'|'opencode'|'copilot'
 * context_resets   : number      — count of compact_boundary events (context window resets)
 * ai_title         : string      — AI-generated session title from ai-title JSONL record
 * subagent_count   : number      — number of Agent tool calls (subagents spawned)
 * branches         : string[]    — all unique git branches encountered in the session
 */
export const OPTIONAL_SESSION_FIELDS = [
  'first_timestamp', 'last_timestamp', 'duration_min', 'git_branch',
  'slug', 'date_str', 'model', 'tool_calls', 'tool_errors', 'tool_diversity',
  'message_count', 'user_turns', 'assistant_turns', 'cache_hit_rate',
  'skills', 'bash_categories', 'content_blocks', 'stop_reasons',
  'first_user_message', 'file_ops', 'source',
  'context_resets', 'ai_title', 'subagent_count', 'branches',
];
