/**
 * lib/pulse-parser.mjs
 *
 * Converts a single raw JSONL record into zero or more SSE pulse objects.
 * Handles both Claude Code (CC) and Pi harness record formats — dispatched
 * by record shape, not by a caller-supplied harness flag.
 *
 * @param {object} record  - Raw parsed JSONL record
 * @param {object} ctx     - { session_id, slug, project_id, project_label }
 * @returns {{ event: string, data: object }[]}
 */

import { categorizeBash } from '../analyze.mjs';

const CC_FILE_OPS = new Set(['Read', 'Write', 'Edit']);
const PI_FILE_OPS = new Set(['read', 'write', 'edit']);

// ── Shared pulse builders ──────────────────────────────────────────────────────

function toolCallPulse(name, where, why, category, ctx, ts) {
  return {
    event: 'tool_call',
    data: { slug: ctx.slug, project: ctx.project_label, tool: name, where, why, category, ts },
  };
}

function tokensPulse(input, output, cache_create, cache_read, ctx, ts) {
  return {
    event: 'tokens',
    data: { slug: ctx.slug, project: ctx.project_label, input, output, cache_create, cache_read, ts },
  };
}

function wordsPulse(text, ctx, ts) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/);
  if (words.length < 3) return null;
  return {
    event: 'words',
    data: { slug: ctx.slug, project: ctx.project_label, preview: trimmed.slice(0, 120), word_count: words.length, ts },
  };
}

// ── Claude Code record parser ──────────────────────────────────────────────────
// Handles: type === 'assistant'

function parseCcRecord(record, ctx) {
  const pulses = [];
  const ts  = record.timestamp ?? null;
  const msg = record.message;
  if (!msg) return pulses;

  if (msg.usage !== undefined) {
    const u = msg.usage || {};
    pulses.push(tokensPulse(
      u.input_tokens                || 0,
      u.output_tokens               || 0,
      u.cache_creation_input_tokens || 0,
      u.cache_read_input_tokens     || 0,
      ctx, ts,
    ));
  }

  for (const block of (msg.content || [])) {
    if (block.type === 'tool_use') {
      const name  = block.name || 'unknown';
      const input = block.input || {};
      let where    = null;
      let category = null;

      if (CC_FILE_OPS.has(name) && input.file_path) {
        where = input.file_path;
      } else if ((name === 'Bash' || name === 'PowerShell') && input.command) {
        where    = String(input.command).slice(0, 80);
        category = categorizeBash(input.command);
      } else if ((name === 'Grep' || name === 'Glob') && input.pattern) {
        where = input.pattern;
      }

      pulses.push(toolCallPulse(name, where, input.description || null, category, ctx, ts));

    } else if (block.type === 'text') {
      const p = wordsPulse(block.text, ctx, ts);
      if (p) pulses.push(p);
    }
    // thinking blocks → private, skip
  }

  return pulses;
}

// ── Pi record parser ───────────────────────────────────────────────────────────
// Handles: type === 'message', message.role === 'assistant'

function parsePiRecord(record, ctx) {
  const pulses = [];
  const ts  = record.timestamp ?? null;
  const msg = record.message;
  if (!msg) return pulses;

  if (msg.usage !== undefined) {
    const u = msg.usage || {};
    pulses.push(tokensPulse(
      u.input      || 0,
      u.output     || 0,
      u.cacheWrite || 0,  // Pi cacheWrite → cache_create
      u.cacheRead  || 0,  // Pi cacheRead  → cache_read
      ctx, ts,
    ));
  }

  for (const block of (msg.content || [])) {
    if (block.type === 'toolCall') {
      const name  = block.name || 'unknown';
      const args  = block.arguments || {};
      let where    = null;
      let category = null;

      if (PI_FILE_OPS.has(name) && args.path) {
        where = args.path;
      } else if ((name === 'bash' || name === 'powershell') && args.command) {
        where    = String(args.command).slice(0, 80);
        category = categorizeBash(args.command);
      } else if ((name === 'grep' || name === 'glob') && args.pattern) {
        where = args.pattern;
      }

      pulses.push(toolCallPulse(name, where, args.description || null, category, ctx, ts));

    } else if (block.type === 'text') {
      const p = wordsPulse(block.text, ctx, ts);
      if (p) pulses.push(p);
    }
  }

  return pulses;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function parsePulse(record, ctx) {
  if (!record || typeof record !== 'object') return [];
  if (record.type === 'assistant')
    return parseCcRecord(record, ctx);
  if (record.type === 'message' && record.message?.role === 'assistant')
    return parsePiRecord(record, ctx);
  return [];
}
