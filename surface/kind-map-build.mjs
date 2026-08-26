/**
 * surface/kind-map-build.mjs — compose traces → Kind Map payload.
 *
 * Snapshot composition only (hooks + goldens + optional sample traces).
 * HTML projection lives in experience/kind-map-widget.mjs. Composition
 * roots (serve.mjs, build.mjs) inject EVENT_TYPES and the renderer —
 * this module must not import experience/.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { HARNESS_REGISTRY } from '../hooks/registry.mjs';
import { RECORD_KINDS } from '../hooks/normalized-record.mjs';
import { KIND_PULSE } from '../hooks/pulse-map.mjs';
import { toolNameToKey, TOOL_ACTION_KEYS } from '../hooks/action-keys.mjs';
import { GOLDEN_SESSIONS } from '../hooks/adapters/golden-sessions.mjs';
import { buildKindMapPayload } from '../hooks/kind-map.mjs';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Local presence: detected = harness root exists on disk;
 * verified = detected AND this machine has sessions for that harness.
 */
export function localHarnessFlags(registry = HARNESS_REGISTRY, {
  exists = fs.existsSync,
  sessions = [],
} = {}) {
  const seen = new Set((sessions || []).map(s => s && s.harness).filter(Boolean));
  const flags = {};
  for (const h of registry) {
    const root = h.roots && h.roots[0];
    const detected = !!(root && exists(root));
    flags[h.id] = { detected, verified: detected && seen.has(h.id) };
  }
  return flags;
}

function readLocalSessions() {
  try {
    const fp = path.join(REPO_ROOT, 'sessions-data.json');
    if (!fs.existsSync(fp)) return [];
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return data.sessions || [];
  } catch {
    return [];
  }
}

function adapt(fn, records) {
  try {
    const out = fn(records);
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
}

export function gatherKindMapTraces(registry = HARNESS_REGISTRY, eventTypes, goldens = GOLDEN_SESSIONS) {
  const traces = {};
  for (const h of registry) {
    const golden = [];
    const sample = [];
    if (typeof h.adapter !== 'function') {
      traces[h.id] = { golden, sample };
      continue;
    }
    const goldenRecs = goldens[h.id];
    if (goldenRecs) golden.push(...adapt(h.adapter, goldenRecs));
    if (eventTypes) {
      for (const entry of Object.values(eventTypes)) {
        const rec = entry.samples && entry.samples[h.id];
        if (rec && rec.record) sample.push(...adapt(h.adapter, [rec.record]));
      }
    }
    traces[h.id] = { golden, sample };
  }
  return traces;
}

export function buildKindMap(opts = {}) {
  const registry = opts.registry || HARNESS_REGISTRY;
  let flags = opts.localFlags || {};
  if (opts.local && !opts.localFlags) {
    flags = localHarnessFlags(registry, { sessions: opts.sessions || readLocalSessions() });
  }
  const harnesses = registry.map(h => ({
    id: h.id, label: h.label, capabilities: h.capabilities, adapter: h.adapter,
    detected: !!flags[h.id]?.detected,
    verified: !!flags[h.id]?.verified,
  }));
  const traces = opts.traces || gatherKindMapTraces(registry, opts.eventTypes, opts.goldens);
  return buildKindMapPayload({
    harnesses,
    kinds: opts.kinds || RECORD_KINDS,
    kindPulse: opts.kindPulse || KIND_PULSE,
    traces,
    toolNameToKey: opts.toolNameToKey || toolNameToKey,
    toolKeys: opts.toolKeys || [...TOOL_ACTION_KEYS],
    generated_at: opts.generated_at ?? new Date().toISOString(),
  });
}

