/**
 * lib/harness-registry.mjs
 *
 * Declarative registry of session harness adapters.
 * serve.mjs and analyze-orchestrator consume this for discovery and watch config.
 *
 * === Adding a new harness (easy hook-in goal) ===
 * 1. Add roots + entry in HARNESS_REGISTRY below (id, label, capabilities, watch.matchLogFile/ctxFromPath/rebuildArg).
 * 2. Implement adapters/<new>.mjs with recordsToNormalized() → NormalizedRecord[] (the common kinds).
 * 3. Add scanner + analyze<New>Session in analyze-<new>.mjs (can delegate heavily to reduceSession + normalized).
 * 4. Wire scanner in lib/scan-harnesses.mjs and (optionally) pulse adapter in lib/pulse-adapters.mjs.
 * 5. Optional: context-tree variant only if rich trace support is wanted.
 * 6. Add tests (adapter golden, reducer parity or independent correctness, pulse if applicable).
 * 7. Update docs/harnesses.md matrix.
 *
 * The normalized kinds + reducer + registry are designed so new harnesses require minimal
 * cross-cutting changes. See Architecture Note in analyze-intelligence.md.
 */

import { deriveLabel } from './analyze-helpers.mjs';
import {
  CLAUDE_PROJECTS_ROOT, PI_SESSIONS_ROOT, ANTIGRAVITY_BRAIN_ROOT, GROK_SESSIONS_ROOT,
} from './harness-paths.mjs';
import { deriveGrokProjectId, deriveGrokLabel } from './grok-helpers.mjs';

export { PI_SESSIONS_ROOT, ANTIGRAVITY_BRAIN_ROOT, GROK_SESSIONS_ROOT } from './harness-paths.mjs';

function derivePiLabel(slug) {
  return deriveLabel(slug.replace(/^--/, '').replace(/--$/, ''));
}

export const HARNESS_IDS = ['claude-code', 'pi', 'antigravity', 'grok'];

/** @type {HarnessDescriptor[]} */
export const HARNESS_REGISTRY = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    roots: [CLAUDE_PROJECTS_ROOT],
    capabilities: {
      tokens: true, pulse: true, trace: true,
      context_resets: true, ai_title: true, subagent_count: true, branches: true,
      size_proxy: 'tokens_work',
    },
    watch: {
      matchLogFile: (rel) => rel.replace(/\\/g, '/').endsWith('.jsonl'),
      ctxFromPath(relPath) {
        const parts = relPath.replace(/\\/g, '/').split('/');
        if (parts.length < 2) return null;
        const project_id = parts[0];
        const session_id = parts[1].replace(/\.jsonl$/, '');
        return {
          harness: 'claude-code', session_id,
          slug: session_id.slice(0, 8), project_id,
          project_label: deriveLabel(project_id),
        };
      },
      rebuildArg(relPath) {
        const parts = relPath.replace(/\\/g, '/').split('/');
        return parts.length === 2 ? `--session=${parts[0]}/${parts[1]}` : null;
      },
    },
  },
  {
    id: 'pi',
    label: 'Pi',
    roots: [PI_SESSIONS_ROOT],
    capabilities: {
      tokens: true, pulse: true, trace: false,
      context_resets: false, ai_title: false, subagent_count: false, branches: false,
      size_proxy: 'tokens_work',
    },
    watch: {
      matchLogFile: (rel) => rel.replace(/\\/g, '/').endsWith('.jsonl'),
      ctxFromPath(relPath) {
        const parts = relPath.replace(/\\/g, '/').split('/');
        if (parts.length < 2) return null;
        const project_id = parts[0];
        const base       = parts[1].replace(/\.jsonl$/, '');
        const session_id = base.includes('_') ? base.slice(base.indexOf('_') + 1) : base;
        return {
          harness: 'pi', session_id,
          slug: session_id.slice(0, 8), project_id,
          project_label: derivePiLabel(project_id),
        };
      },
      rebuildArg(relPath) {
        const parts = relPath.replace(/\\/g, '/').split('/');
        return parts.length === 2 ? `--session=${parts[0]}/${parts[1]}` : null;
      },
    },
  },
  {
    id: 'antigravity',
    label: 'Google Antigravity',
    roots: [ANTIGRAVITY_BRAIN_ROOT],
    capabilities: {
      tokens: false, pulse: true, trace: false,
      context_resets: false, ai_title: false, subagent_count: false, branches: false,
      size_proxy: 'tool_calls',
    },
    watch: {
      matchLogFile: (rel) => {
        const n = rel.replace(/\\/g, '/');
        return n.endsWith('transcript.jsonl') || n.endsWith('overview.txt');
      },
      ctxFromPath(relPath) {
        const parts = relPath.replace(/\\/g, '/').split('/');
        const convIdx = parts.findIndex((p, i) =>
          parts[i + 1] === '.system_generated' && parts[i + 2] === 'logs'
        );
        if (convIdx < 0) return null;
        const session_id = parts[convIdx];
        return {
          harness: 'antigravity', session_id,
          slug: session_id.slice(0, 8),
          project_id: null,
          project_label: 'antigravity',
        };
      },
      rebuildArg: () => null,
    },
  },
  {
    id: 'grok',
    label: 'Grok Build',
    roots: [GROK_SESSIONS_ROOT],
    capabilities: {
      tokens: false, pulse: true, trace: true,
      context_resets: true, ai_title: true, subagent_count: true, branches: true,
      size_proxy: 'tool_calls',
    },
    watch: {
      matchLogFile(rel) {
        const n = rel.replace(/\\/g, '/');
        const parts = n.split('/');
        return parts.length >= 3 && parts[parts.length - 1] === 'updates.jsonl';
      },
      ctxFromPath(relPath) {
        const parts = relPath.replace(/\\/g, '/').split('/');
        if (parts.length < 3 || parts[parts.length - 1] !== 'updates.jsonl') return null;
        const encoded_cwd = parts[0];
        const session_id  = parts[1];
        return {
          harness: 'grok', session_id,
          slug: session_id.slice(0, 8),
          project_id: deriveGrokProjectId(encoded_cwd),
          project_label: deriveGrokLabel(encoded_cwd),
        };
      },
      rebuildArg: () => null,
    },
  },
];

export function getHarness(id) {
  return HARNESS_REGISTRY.find(h => h.id === id) ?? null;
}

export function getEnabledHarnesses(harnessIds = HARNESS_IDS) {
  return HARNESS_REGISTRY.filter(h => harnessIds.includes(h.id));
}