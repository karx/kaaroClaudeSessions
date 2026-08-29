/**
 * experience/client-core/06-pulse.mjs — cognition-pulse event vocabulary and
 * ticker-line formatting. Part of the client-core split; see
 * experience/client-core.mjs.
 */

// ── Live SSE subscribe (Graph / DAW → playPulse) ──────────────────────────────
// tool_call / tokens / words have their own listeners (custom ticker lines).
// Cognition events share one loop. unknown / silent / tool_result stay wire-only.

export const LIVE_COGNITION_EVENTS = [
  'human_turn', 'compact', 'permission', 'mode_shift',
  'tool_error', 'api_error', 'chirp', 'attachment', 'scaffold',
  'thinking',
];

export const LIVE_PLAYPULSE_EVENTS = [
  'tool_call', 'tokens', 'words',
  ...LIVE_COGNITION_EVENTS,
];

// ── Cognition pulse vocabulary (ticker / overlays) ────────────────────────────

export const PULSE_GLYPHS = {
  human_turn: '⌨', compact: '⟲', permission: '⚙', mode_shift: '⚙',
  tool_error: '✖', api_error: '⊘', attachment: '⊕', scaffold: '▤',
};

/**
 * Ticker line for a cognition pulse. Returns { text, role } or null when the
 * event should stay out of the ticker (chirps, thinking — too chatty).
 * Roles: 'err' | 'human' | 'context' | 'dim' (consumer maps role → color).
 */
export function pulseTickerEntry(event, data = {}) {
  const g = PULSE_GLYPHS[event];
  const tag = data.slug ? '  [' + data.slug + ']' : '';
  switch (event) {
    case 'human_turn':
      return { text: g + ' "' + String(data.text || 'prompt').slice(0, 48) + '"' + tag, role: 'human' };
    case 'compact':
      return { text: g + ' context compacted' + tag, role: 'context' };
    case 'permission':
      return { text: g + ' perm → ' + (data.mode || '?') + tag, role: 'dim' };
    case 'mode_shift':
      return { text: g + ' mode → ' + (data.mode || '?') + tag, role: 'dim' };
    case 'tool_error':
      return { text: g + ' ' + (data.tool || 'tool') + ' failed' + tag, role: 'err' };
    case 'api_error':
      return { text: g + ' ' + (data.message || 'api error') + (data.code ? ' [' + data.code + ']' : '') + tag, role: 'err' };
    default:
      return null;
  }
}
