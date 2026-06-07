/**
 * lib/normalized-record.mjs
 *
 * Internal event kinds produced by harness adapters and consumed by session-reducer.
 * Not persisted in sessions-data.json.
 */

export const RECORD_KINDS = [
  'user_turn',
  'assistant_turn',
  'tool_use',
  'tool_result',
  'tokens',
  'skill_invoke',
  'context_reset',
  'session_meta',
  'permission_mode',
  'branch_change',
];

const KIND_SET = new Set(RECORD_KINDS);

/**
 * @param {unknown} rec
 * @returns {boolean}
 */
export function isNormalizedRecord(rec) {
  return !!rec
    && typeof rec === 'object'
    && KIND_SET.has(rec.kind)
    && typeof rec.harness === 'string';
}