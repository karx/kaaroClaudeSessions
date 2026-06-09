/**
 * lib/pulse-transformer.mjs — NormalizedRecord[] → SSE pulse objects
 *
 * Replaces lib/pulse-adapters.mjs. Every NR emits ≥1 pulse.
 * Unknown or unmapped kinds fall through to the 'unknown' catch-all.
 *
 * @param {object[]} nrRecords     — NormalizedRecord[]
 * @param {object}   ctx           — { session_id, slug, project_label, harness }
 * @param {object}   capabilities  — harness capabilities (e.g. { tokens: false })
 * @returns {object[]} pulse objects { event, data }
 */
export function normRecordsToPulses(nrRecords, ctx, capabilities = {}) {
  const pulses = [];
  for (const nr of nrRecords) {
    const p = transformRecord(nr, ctx, capabilities);
    pulses.push(p);
  }
  return pulses;
}

function base(ctx, ts) {
  return {
    session_id:    ctx.session_id,
    slug:          ctx.slug,
    harness:       ctx.harness,
    project:       ctx.project_label,
    ts,
  };
}

function transformRecord(nr, ctx, capabilities) {
  const ts = nr.ts ?? null;

  switch (nr.kind) {

    case 'tool_use': {
      const where = nr.input?.file_path || nr.input?.path || null;
      const why   = nr.input?.command || nr.input?.description || null;
      return {
        event: 'tool_call',
        data: { ...base(ctx, ts), tool: nr.tool, key: nr.key, where, why, category: nr.key },
      };
    }

    case 'tokens': {
      const t = nr.tokens || {};
      return {
        event: 'tokens',
        data: {
          ...base(ctx, ts),
          input:        t.input        || 0,
          output:       t.output       || 0,
          cache_create: t.cache_create || 0,
          cache_read:   t.cache_read   || 0,
        },
      };
    }

    case 'content_block': {
      if (nr.block_type === 'text' && nr.text) {
        const trimmed = nr.text.trim();
        const words   = trimmed ? trimmed.split(/\s+/) : [];
        if (words.length >= 3) {
          return {
            event: 'words',
            data: { ...base(ctx, ts), preview: trimmed.slice(0, 120), word_count: words.length },
          };
        }
        return {
          event: 'chirp',
          data: { ...base(ctx, ts), preview: trimmed.slice(0, 120), word_count: words.length },
        };
      }
      return { event: 'unknown', data: { ...base(ctx, ts), nr_kind: nr.kind, block_type: nr.block_type } };
    }

    case 'user_turn': {
      return {
        event: 'human_turn',
        data: { ...base(ctx, ts), text: nr.text || null },
      };
    }

    case 'context_reset': {
      return { event: 'compact', data: base(ctx, ts) };
    }

    case 'permission_mode': {
      return { event: 'permission', data: { ...base(ctx, ts), mode: nr.mode } };
    }

    case 'scaffold': {
      return {
        event: 'scaffold',
        data: { ...base(ctx, ts), content_preview: nr.content_preview || null },
      };
    }

    case 'tool_result': {
      const evt = nr.error ? 'tool_error' : 'tool_result';
      return { event: evt, data: { ...base(ctx, ts), tool: nr.tool } };
    }

    case 'unknown_record': {
      return { event: 'unknown', data: { ...base(ctx, ts), raw_type: nr.raw_type } };
    }

    case 'assistant_turn': {
      if (capabilities.tokens === false) {
        const contentLength = nr.content_length || 0;
        return {
          event: 'tokens',
          data: {
            ...base(ctx, ts),
            synthetic: true,
            input: 0,
            output: Math.round(contentLength / 4),
            cache_create: 0,
            cache_read: 0,
          },
        };
      }
      return { event: 'unknown', data: { ...base(ctx, ts), nr_kind: nr.kind } };
    }

    default: {
      return { event: 'unknown', data: { ...base(ctx, ts), nr_kind: nr.kind } };
    }
  }
}
