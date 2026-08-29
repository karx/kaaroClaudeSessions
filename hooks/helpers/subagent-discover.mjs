/**
 * hooks/helpers/subagent-discover.mjs
 *
 * Claude Code subagent on-disk contract (current layout):
 *
 *   ~/.claude/projects/<projectId>/
 *     <parentSessionUuid>.jsonl
 *     <parentSessionUuid>/
 *       subagents/
 *         agent-<agentId>.jsonl
 *         agent-<agentId>.meta.json
 *
 * Meta (authoritative spawn link):
 *   { agentType, description, toolUseId, spawnDepth }
 *
 * Pure-ish helpers: filesystem read of the subagents dir only — no adapter,
 * no full tree reconstruction. Trace-service composes these with
 * reconstructTraceFromNRs.
 */

import fs from 'fs';
import path from 'path';

const AGENT_JSONL_RE = /^agent-(.+)\.jsonl$/i;

/**
 * Parent log `…/<uuid>.jsonl` → sibling session dir `…/<uuid>` that may
 * contain a `subagents/` folder.
 * @param {string} logFilePath
 * @returns {string}
 */
export function parentSessionDirFromLog(logFilePath) {
  const base = path.basename(logFilePath, path.extname(logFilePath));
  return path.join(path.dirname(logFilePath), base);
}

/**
 * CC stores all agents flat under `<parentUuid>/subagents/`, including
 * spawnDepth ≥ 2 (siblings, not nested dirs). Return the parent session
 * directory such that `listSubagentArtifacts(dir)` finds that flat set.
 *
 * - Parent: `…/<uuid>.jsonl` → `…/<uuid>`
 * - Sidechain: `…/<uuid>/subagents/agent-*.jsonl` → `…/<uuid>`
 *
 * @param {string} logFilePath
 * @returns {string}
 */
export function subagentScanDirFromLog(logFilePath) {
  if (!logFilePath) return parentSessionDirFromLog(logFilePath);
  const dir = path.dirname(logFilePath);
  const base = path.basename(logFilePath);
  if (/^agent-.+\.jsonl$/i.test(base) && path.basename(dir) === 'subagents') {
    return path.dirname(dir);
  }
  return parentSessionDirFromLog(logFilePath);
}

/**
 * Sidechain agent id from `…/subagents/agent-<id>.jsonl`, else null.
 * @param {string} logFilePath
 * @returns {string|null}
 */
export function agentIdFromSidechainLog(logFilePath) {
  if (!logFilePath) return null;
  const base = path.basename(logFilePath);
  const m = base.match(/^agent-(.+)\.jsonl$/i);
  if (!m) return null;
  if (path.basename(path.dirname(logFilePath)) !== 'subagents') return null;
  return m[1];
}

/**
 * @param {string} parentSessionDir — directory next to parent `.jsonl`
 * @returns {{ agent_id: string, meta_path: string|null, jsonl_path: string, meta: object|null }[]}
 */
export function listSubagentArtifacts(parentSessionDir) {
  if (!parentSessionDir) return [];
  const subDir = path.join(parentSessionDir, 'subagents');
  let names;
  try {
    if (!fs.existsSync(subDir) || !fs.statSync(subDir).isDirectory()) return [];
    names = fs.readdirSync(subDir);
  } catch {
    return [];
  }

  const byAgent = new Map(); // agentId → partial

  for (const name of names) {
    const m = name.match(AGENT_JSONL_RE);
    if (m) {
      const agentId = m[1];
      const cur = byAgent.get(agentId) || { agent_id: agentId, meta_path: null, jsonl_path: null, meta: null };
      cur.jsonl_path = path.join(subDir, name);
      byAgent.set(agentId, cur);
      continue;
    }
    if (name.endsWith('.meta.json') && name.startsWith('agent-')) {
      const agentId = name.slice('agent-'.length, -'.meta.json'.length);
      if (!agentId) continue;
      const cur = byAgent.get(agentId) || { agent_id: agentId, meta_path: null, jsonl_path: null, meta: null };
      cur.meta_path = path.join(subDir, name);
      try {
        cur.meta = JSON.parse(fs.readFileSync(cur.meta_path, 'utf8'));
      } catch {
        cur.meta = null;
      }
      byAgent.set(agentId, cur);
    }
  }

  // Only artifacts that have a transcript jsonl (meta-only is useless for tree)
  return [...byAgent.values()]
    .filter(a => a.jsonl_path)
    .sort((a, b) => a.agent_id.localeCompare(b.agent_id));
}

/**
 * @typedef {object} SubagentRef
 * @property {string|null} agent_id
 * @property {string|null} tool_use_id
 * @property {string|null} description
 * @property {string|null} agent_type
 * @property {number|null} spawn_depth
 * @property {string|null} jsonl_path
 * @property {boolean} linked — true when tool_use_id matched meta.toolUseId
 */

/**
 * Link parent Agent/Task tool uses to discovered artifacts via meta.toolUseId.
 * Emits: linked refs, unmatched tool uses (linked:false), orphan artifacts (linked:false).
 *
 * @param {{ tool_id?: string|null, description?: string|null }[]} agentToolUses
 * @param {{ agent_id: string, jsonl_path: string, meta: object|null }[]} artifacts
 * @returns {SubagentRef[]}
 */
export function linkSpawns(agentToolUses = [], artifacts = []) {
  const byToolUseId = new Map();
  for (const a of artifacts) {
    const tid = a.meta?.toolUseId;
    if (tid) byToolUseId.set(tid, a);
  }

  const usedAgentIds = new Set();
  const refs = [];

  for (const tu of agentToolUses) {
    const toolUseId = tu.tool_id || null;
    const art = toolUseId ? byToolUseId.get(toolUseId) : null;
    if (art) {
      usedAgentIds.add(art.agent_id);
      refs.push(_refFromArtifact(art, {
        tool_use_id: toolUseId,
        description: art.meta?.description || tu.description || null,
        linked: true,
      }));
    } else {
      refs.push({
        agent_id: null,
        tool_use_id: toolUseId,
        description: tu.description || null,
        agent_type: null,
        spawn_depth: null,
        jsonl_path: null,
        linked: false,
      });
    }
  }

  for (const art of artifacts) {
    if (usedAgentIds.has(art.agent_id)) continue;
    refs.push(_refFromArtifact(art, {
      tool_use_id: art.meta?.toolUseId || null,
      description: art.meta?.description || null,
      linked: false,
    }));
  }

  return refs;
}

function _refFromArtifact(art, { tool_use_id, description, linked }) {
  const meta = art.meta || {};
  return {
    agent_id: art.agent_id,
    tool_use_id: tool_use_id ?? meta.toolUseId ?? null,
    description: description ?? meta.description ?? null,
    agent_type: meta.agentType ?? null,
    spawn_depth: typeof meta.spawnDepth === 'number' ? meta.spawnDepth : null,
    jsonl_path: art.jsonl_path || null,
    linked: !!linked,
  };
}

/**
 * Graph/analyze stubs only — no jsonl_path, no nested tree.
 * Prefer meta when present; orphans still appear with linked:false.
 *
 * @param {{ agent_id: string, meta: object|null }[]} artifacts
 * @returns {{ agent_id: string, tool_use_id: string|null, description: string|null,
 *   agent_type: string|null, spawn_depth: number|null, linked: boolean }[]}
 */
export function stubRefsFromArtifacts(artifacts = []) {
  return artifacts.map(a => {
    const meta = a.meta || {};
    const toolUseId = meta.toolUseId || null;
    return {
      agent_id: a.agent_id,
      tool_use_id: toolUseId,
      description: meta.description || null,
      agent_type: meta.agentType || null,
      spawn_depth: typeof meta.spawnDepth === 'number' ? meta.spawnDepth : null,
      linked: !!toolUseId,
    };
  });
}
