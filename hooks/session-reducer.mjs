/**
 * lib/session-reducer.mjs
 *
 * Folds NormalizedRecord[] into a canonical session object.
 * Pure — no I/O. enrichSession() runs after this.
 */

import { normPath, categorizeBash, BUILTIN_COMMANDS } from './helpers/analyze-helpers.mjs';
import { isBashToolName } from './action-keys.mjs';

export const FILE_OP_TOOLS = {
  Read: 'read', Write: 'write', Edit: 'edit',
  StrReplace: 'edit', EditNotebook: 'edit',
  read: 'read', write: 'write', edit: 'edit',
  view_file: 'read',
  write_to_file: 'write',
  replace_file_content: 'edit',
  multi_replace_file_content: 'edit',
  // copilot (VS Code) tool ids, copilot_ prefix stripped by the adapter;
  // snake_case variants appear in older chatSessions dumps
  readFile: 'read',
  createFile: 'write',
  editFile: 'edit',
  replaceString: 'edit',
  applyPatch: 'edit',
  read_file: 'read',
  create_file: 'write',
  insert_edit_into_file: 'edit',
  replace_string_in_file: 'edit',
  apply_patch: 'edit', // codex — snake_case, real tool name (custom_tool_call)
};


function filePathFromInput(input = {}) {
  return input.file_path ?? input.path ?? input.AbsolutePath ?? input.TargetFile ?? null;
}
function emptySession(meta) {
  return {
    session_id:      meta.session_id,
    project_id:      meta.project_id,
    project_label:   meta.project_label,
    harness:         meta.harness,
    source:          meta.harness,
    file_size_bytes: meta.file_size_bytes ?? 0,
    size_proxy:      meta.capabilities?.size_proxy ?? 'tokens_work',
    cache_accounting: meta.capabilities?.cache_accounting ?? true,

    first_timestamp: null,
    last_timestamp:  null,
    slug:            null,
    duration_ms:     null,
    message_count:   null,
    version:         null,
    entrypoint:      null,
    git_branch:      null,
    cwd:             null,
    permission_mode: null,
    model:           null,

    user_turns:      0,
    assistant_turns: 0,
    tool_calls:      0,
    tool_errors:     0,

    tokens:          { input: 0, cache_create: 0, cache_read: 0, output: 0 },
    tools:           {},
    file_ops:        {},
    bash_categories: {},
    content_blocks:  {},
    stop_reasons:    {},
    skills:          [],
    builtin_commands: [],
    // W-OBS-01/02: skill timeline + tool-to-skill attribution (empty until skill_invoke)
    skill_timeline:    [],
    skill_attribution: {},
    first_user_message: null,
    context_resets:  0,
    ai_title:        null,
    subagent_count:  0,
    branches:        [],
  };
}

function ensureSkillAttribution(session, skill) {
  if (!session.skill_attribution[skill]) {
    session.skill_attribution[skill] = { tool_calls: 0, tools: {}, errors: 0 };
  }
  return session.skill_attribution[skill];
}

function trackTs(session, ts) {
  if (!ts) return;
  if (!session.first_timestamp || ts < session.first_timestamp) session.first_timestamp = ts;
  if (!session.last_timestamp  || ts > session.last_timestamp)  session.last_timestamp  = ts;
}

function addBranch(session, branch) {
  if (!branch) return;
  if (!session.git_branch) session.git_branch = branch;
  if (!session.branches.includes(branch)) session.branches.push(branch);
}

/**
 * @param {object[]} records — NormalizedRecord[]
 * @param {object} meta — session identity + capabilities
 */
export function reduceSession(records, meta) {
  const session = emptySession(meta);
  let firstUserSeen = false;
  // Active attribution window: skill name after skill_invoke; cleared on next
  // skill_invoke (replaced) or context_reset (dies — does not survive compact).
  let activeSkill = null;

  for (const rec of records) {
    trackTs(session, rec.ts);

    switch (rec.kind) {
      case 'permission_mode':
        session.permission_mode = rec.mode;
        break;

      case 'context_reset':
        session.context_resets++;
        activeSkill = null;
        break;

      case 'session_meta':
        if (rec.ai_title && !session.ai_title) session.ai_title = rec.ai_title;
        if (rec.slug)       session.slug         = rec.slug;
        if (rec.duration_ms != null)   session.duration_ms   = rec.duration_ms;
        if (rec.message_count != null) session.message_count = rec.message_count;
        if (rec.version)    session.version    = rec.version;
        if (rec.entrypoint) session.entrypoint = rec.entrypoint;
        if (rec.cwd)        session.cwd        = rec.cwd;
        if (rec.model && (rec.overwrite || !session.model)) session.model = rec.model;
        addBranch(session, rec.branch);
        break;

      case 'branch_change':
        addBranch(session, rec.branch);
        break;

      case 'user_turn':
        session.user_turns++;
        if (rec.version    && !session.version)    session.version    = rec.version;
        if (rec.entrypoint && !session.entrypoint) session.entrypoint = rec.entrypoint;
        if (rec.cwd        && !session.cwd)        session.cwd        = rec.cwd;
        addBranch(session, rec.branch);
        if (!firstUserSeen && rec.text?.length >= 8) {
          session.first_user_message = rec.text.slice(0, 200);
          firstUserSeen = true;
        }
        break;

      case 'skill_invoke': {
        const bucket = BUILTIN_COMMANDS.has(rec.skill) ? 'builtin_commands' : 'skills';
        if (!session[bucket].includes(rec.skill)) session[bucket].push(rec.skill);
        // Timeline + attribution windows exclude harness chrome (BUILTIN_COMMANDS).
        if (!BUILTIN_COMMANDS.has(rec.skill) && rec.skill) {
          session.skill_timeline.push({ skill: rec.skill, ts: rec.ts ?? null });
          ensureSkillAttribution(session, rec.skill);
          activeSkill = rec.skill;
        }
        break;
      }

      case 'tool_result':
        if (rec.error) {
          session.tool_errors++;
          const tool = rec.tool || 'unknown';
          if (session.tools[tool]) session.tools[tool].errors++;
          if (activeSkill) ensureSkillAttribution(session, activeSkill).errors++;
        }
        break;

      case 'assistant_turn':
        session.assistant_turns++;
        if (rec.model && (rec.overwrite || !session.model)) session.model = rec.model;
        if (rec.stop_reason) {
          session.stop_reasons[rec.stop_reason] =
            (session.stop_reasons[rec.stop_reason] || 0) + 1;
        }
        break;

      case 'content_block': {
        const bt = rec.block_type || rec.content_block; // supports old transitional records
        if (bt) {
          session.content_blocks[bt] = (session.content_blocks[bt] || 0) + 1;
        }
        break;
      }

      case 'tokens': {
        const t = rec.tokens || {};
        session.tokens.input        += t.input        || 0;
        session.tokens.output       += t.output       || 0;
        session.tokens.cache_create += t.cache_create || 0;
        session.tokens.cache_read   += t.cache_read   || 0;
        break;
      }

      case 'tool_use': {
        session.tool_calls++;
        const name = rec.tool || 'unknown';
        if (!session.tools[name]) session.tools[name] = { calls: 0, errors: 0 };
        session.tools[name].calls++;
        if (name === 'Agent' || name === 'Task' || name === 'spawn_subagent') session.subagent_count++;

        const op = FILE_OP_TOOLS[name];
        if (op) {
          // Most tools touch one path; a multi-file patch (codex apply_patch)
          // carries input.paths[] instead — credit every path, but the call
          // itself was still only counted once above.
          const paths = Array.isArray(rec.input?.paths) ? rec.input.paths : [filePathFromInput(rec.input)];
          for (const raw of paths) {
            const fp = normPath(raw);
            if (!fp) continue;
            if (!session.file_ops[fp]) session.file_ops[fp] = { read: 0, write: 0, edit: 0 };
            session.file_ops[fp][op]++;
          }
        }

        if (isBashToolName(name) && rec.input?.command) {
          const cat = categorizeBash(rec.input.command);
          session.bash_categories[cat] = (session.bash_categories[cat] || 0) + 1;
        }

        if (activeSkill) {
          const attr = ensureSkillAttribution(session, activeSkill);
          attr.tool_calls++;
          attr.tools[name] = (attr.tools[name] || 0) + 1;
        }
        break;
      }

      default:
        break;
    }
  }

  if (!session.slug) session.slug = session.session_id.slice(0, 8);
  if (session.message_count == null) {
    if (session.user_turns || session.assistant_turns) {
      session.message_count = session.user_turns + session.assistant_turns;
    } else {
      session.message_count = 0;
    }
  }

  return session;
}
