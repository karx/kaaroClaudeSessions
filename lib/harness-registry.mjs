/**
 * lib/harness-registry.mjs
 *
 * Declarative registry of session harness adapters.
 * serve.mjs and analyze-orchestrator consume this for discovery and watch config.
 */

import { deriveLabel } from '../analyze.mjs';
import {
  CLAUDE_PROJECTS_ROOT, PI_SESSIONS_ROOT, ANTIGRAVITY_BRAIN_ROOT,
} from './harness-paths.mjs';

export { PI_SESSIONS_ROOT, ANTIGRAVITY_BRAIN_ROOT } from './harness-paths.mjs';

function derivePiLabel(slug) {
  return deriveLabel(slug.replace(/^--/, '').replace(/--$/, ''));
}

export const HARNESS_IDS = ['claude-code', 'pi', 'antigravity'];

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
];

export function getHarness(id) {
  return HARNESS_REGISTRY.find(h => h.id === id) ?? null;
}

export function getEnabledHarnesses(harnessIds = HARNESS_IDS) {
  return HARNESS_REGISTRY.filter(h => harnessIds.includes(h.id));
}