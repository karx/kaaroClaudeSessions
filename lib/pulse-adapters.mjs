/**
 * lib/pulse-adapters.mjs
 *
 * Harness-dispatched SSE pulse parsing. Replaces shape-based dispatch in
 * pulse-parser.mjs — routes on ctx.harness, not record.type.
 */

import { categorizeBash } from './analyze-helpers.mjs';
import { parseArgValue } from './antigravity-helpers.mjs';

const CC_FILE_OPS = new Set(['Read', 'Write', 'Edit']);
const PI_FILE_OPS = new Set(['read', 'write', 'edit']);

function toolCallPulse(name, where, why, category, ctx, ts) {
  return {
    event: 'tool_call',
    data: {
      session_id: ctx.session_id,
      slug: ctx.slug,
      harness: ctx.harness,
      project: ctx.project_label,
      tool: name, where, why, category, ts,
    },
  };
}

function tokensPulse(input, output, cache_create, cache_read, ctx, ts) {
  return {
    event: 'tokens',
    data: {
      session_id: ctx.session_id,
      slug: ctx.slug,
      harness: ctx.harness,
      project: ctx.project_label,
      input, output, cache_create, cache_read, ts,
    },
  };
}

function wordsPulse(text, ctx, ts) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/);
  if (words.length < 3) return null;
  return {
    event: 'words',
    data: {
      session_id: ctx.session_id,
      slug: ctx.slug,
      harness: ctx.harness,
      project: ctx.project_label,
      preview: trimmed.slice(0, 120),
      word_count: words.length,
      ts,
    },
  };
}

function parseCcPulse(record, ctx) {
  const pulses = [];
  const ts  = record.timestamp ?? null;
  const msg = record.message;
  if (!msg) return pulses;

  if (msg.usage !== undefined) {
    const u = msg.usage || {};
    pulses.push(tokensPulse(
      u.input_tokens || 0, u.output_tokens || 0,
      u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0,
      ctx, ts,
    ));
  }

  for (const block of (msg.content || [])) {
    if (block.type === 'tool_use') {
      const name  = block.name || 'unknown';
      const input = block.input || {};
      let where = null, category = null;
      if (CC_FILE_OPS.has(name) && input.file_path) where = input.file_path;
      else if ((name === 'Bash' || name === 'PowerShell') && input.command) {
        where = String(input.command).slice(0, 80);
        category = categorizeBash(input.command);
      } else if ((name === 'Grep' || name === 'Glob') && input.pattern) where = input.pattern;
      pulses.push(toolCallPulse(name, where, input.description || null, category, ctx, ts));
    } else if (block.type === 'text') {
      const p = wordsPulse(block.text, ctx, ts);
      if (p) pulses.push(p);
    }
  }
  return pulses;
}

function parsePiPulse(record, ctx) {
  const pulses = [];
  const ts  = record.timestamp ?? null;
  const msg = record.message;
  if (!msg) return pulses;

  if (msg.usage !== undefined) {
    const u = msg.usage || {};
    pulses.push(tokensPulse(u.input || 0, u.output || 0, u.cacheWrite || 0, u.cacheRead || 0, ctx, ts));
  }

  for (const block of (msg.content || [])) {
    if (block.type === 'toolCall') {
      const name = block.name || 'unknown';
      const args = block.arguments || {};
      let where = null, category = null;
      if (PI_FILE_OPS.has(name) && args.path) where = args.path;
      else if ((name === 'bash' || name === 'powershell') && args.command) {
        where = String(args.command).slice(0, 80);
        category = categorizeBash(args.command);
      } else if ((name === 'grep' || name === 'glob') && args.pattern) where = args.pattern;
      pulses.push(toolCallPulse(name, where, args.description || null, category, ctx, ts));
    } else if (block.type === 'text') {
      const p = wordsPulse(block.text, ctx, ts);
      if (p) pulses.push(p);
    }
  }
  return pulses;
}

const AG_TOOL_MAP = {
  view_file: 'view_file', write_to_file: 'write_to_file',
  replace_file_content: 'replace_file_content', run_command: 'run_command',
  list_dir: 'list_dir', grep_search: 'grep_search',
};

function parseAntigravityPulse(record, ctx) {
  const pulses = [];
  const ts = record.created_at ?? null;

  if (record.type === 'PLANNER_RESPONSE' && record.source === 'MODEL') {
    const text = record.content || '';
    const p = wordsPulse(text, ctx, ts);
    if (p) pulses.push(p);

    for (const tc of (record.tool_calls || [])) {
      const name = tc.name || 'unknown';
      const args = tc.args || {};
      let where = null, category = null;

      if (name === 'view_file' || name === 'write_to_file' || name === 'replace_file_content') {
        const raw = parseArgValue(args.AbsolutePath || args.TargetFile);
        if (raw) where = String(raw).replace(/\\/g, '/');
      } else if (name === 'run_command') {
        const cmd = parseArgValue(args.CommandLine);
        if (cmd) {
          where = String(cmd).slice(0, 80);
          category = categorizeBash(cmd);
        }
      } else if (name === 'grep_search') {
        const pat = parseArgValue(args.Pattern || args.Query);
        if (pat) where = String(pat);
      }

      pulses.push(toolCallPulse(
        AG_TOOL_MAP[name] || name, where,
        parseArgValue(args.toolSummary) || null, category, ctx, ts,
      ));
    }
  }
  return pulses;
}

const ADAPTERS = {
  'claude-code':  parseCcPulse,
  'pi':           parsePiPulse,
  'antigravity':  parseAntigravityPulse,
};

function inferHarness(record, ctx) {
  if (ctx?.harness) return ctx.harness;
  if (record.type === 'assistant') return 'claude-code';
  if (record.type === 'message' && record.message?.role === 'assistant') return 'pi';
  if (record.type === 'PLANNER_RESPONSE') return 'antigravity';
  return null;
}

export function parsePulse(record, ctx = {}) {
  if (!record || typeof record !== 'object') return [];
  const harness = inferHarness(record, ctx);
  if (!harness) return [];
  const fn = ADAPTERS[harness];
  if (!fn) return [];
  return fn(record, { harness, ...ctx });
}