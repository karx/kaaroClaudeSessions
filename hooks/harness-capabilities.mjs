/**
 * hooks/harness-capabilities.mjs — per-harness capability flags.
 *
 * A leaf module (no other hooks/ imports), same shape as harness-paths.mjs,
 * so both registry.mjs and every hooks/analyzers/*.mjs (three of which —
 * grok, opencode, copilot — registry.mjs already statically imports for
 * their readSessionRecords helpers) can import it directly with no import
 * cycle: registry.mjs's own docs call out staying "free of ... import
 * cycles" as the reason scan/analyze functions are loaded lazily instead.
 *
 * This is THE single object per harness — registry.mjs uses it verbatim as
 * descriptor.capabilities (consumed by /api/harnesses, pulse-emitter,
 * trace-service, kind-map…); every analyzer passes the same object into
 * reduceSession()'s meta.capabilities (consumed by session-reducer.mjs for
 * size_proxy / cache_accounting). One edit here updates both consumers —
 * before this, each side hand-rolled its own literal and could silently
 * drift (see RFC-cache-hit-rate.md for a real instance of this happening).
 *
 * Frozen (module-load time, cheap) so a bug can't mutate a value shared
 * across every session of a harness.
 */

export const HARNESS_CAPABILITIES = Object.freeze({
  'claude-code': Object.freeze({
    tokens: true, pulse: true, trace: true,
    context_resets: true, ai_title: true, subagent_count: true, branches: true,
    size_proxy: 'tokens_work',
  }),
  codex: Object.freeze({
    tokens: true, pulse: true, trace: true, // tokens are output-only (input/cache are per-request context-window snapshots, not per-turn deltas — see docs/CODEX.md)
    context_resets: false, ai_title: true, subagent_count: false, branches: true,
    size_proxy: 'tokens_work', cache_accounting: false,
  }),
  pi: Object.freeze({
    tokens: true, pulse: true, trace: true,
    context_resets: false, ai_title: false, subagent_count: false, branches: false,
    size_proxy: 'tokens_work',
  }),
  antigravity: Object.freeze({
    // trace stays false: antigravity NRs carry no assistant text/thinking
    // blocks, so reconstructed turns are degenerate (tool lists only).
    tokens: false, pulse: true, trace: false,
    context_resets: false, ai_title: false, subagent_count: false, branches: false,
    size_proxy: 'tool_calls',
  }),
  grok: Object.freeze({
    tokens: false, pulse: true, trace: true,
    context_resets: true, ai_title: true, subagent_count: true, branches: true,
    size_proxy: 'tool_calls',
  }),
  opencode: Object.freeze({
    tokens: true, pulse: true, trace: true,
    context_resets: false, ai_title: true, subagent_count: false, branches: false,
    size_proxy: 'tokens_work',
  }),
  copilot: Object.freeze({
    tokens: true, pulse: true, trace: true, // tokens are output-only (completionTokens)
    context_resets: false, ai_title: true, subagent_count: false, branches: false,
    size_proxy: 'tokens_work', cache_accounting: false,
  }),
  'command-code': Object.freeze({
    tokens: false, pulse: true, trace: true,
    context_resets: false, ai_title: true, subagent_count: false, branches: true,
    size_proxy: 'tool_calls',
  }),
});
