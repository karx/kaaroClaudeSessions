/**
 * lib/graph-data.mjs
 *
 * Pure data-transform functions shared between the build pipeline and tests.
 * No Node.js I/O, no HTML generation — importable anywhere.
 */

export const MAX_AGE_MS = 2 * 24 * 3600 * 1000;

export const IN_FLIGHT_COLOR = '#00ffcc';

export const PALETTE = [
  '#00aaff', '#ff4488', '#cc44ff', '#ff8800',
  '#00ff88', '#ffcc00', '#00cccc', '#ff6666',
  '#44ffaa', '#ff88cc', '#8844ff', '#88ccff',
];

export const EXT_COLORS = {
  mjs: '#00cccc', js: '#00aaff', ts: '#6688ff', svelte: '#ff8844',
  json: '#ffcc00', md: '#cc44ff', html: '#ff4488', css: '#33ee88',
  py: '#88cc44', txt: '#888888', sh: '#44ffaa',
};

export function calcRecencyScore(ts, referenceMs) {
  if (!ts) return 0;
  return Math.max(0, 1 - (referenceMs - new Date(ts).getTime()) / MAX_AGE_MS);
}

export function calcRecencyLevel(ts, referenceMs) {
  if (!ts) return 0;
  const age = referenceMs - new Date(ts).getTime();
  if (age <  5 * 60 * 1000)        return 3;
  if (age < 15 * 60 * 1000)        return 2;
  if (age <  2 * 24 * 3600 * 1000) return 1;
  return 0;
}

/** Projects sorted alphabetically for stable colour assignment across runs. */
export function assignProjectColors(projects, palette) {
  const PROJECT_COLORS = {};
  const COLOR_TO_INDEX = {};
  [...projects].sort((a, b) => a.id < b.id ? -1 : 1).forEach((p, i) => {
    PROJECT_COLORS[p.id]                  = palette[i % palette.length];
    COLOR_TO_INDEX[palette[i % palette.length]] = i;
  });
  return { PROJECT_COLORS, COLOR_TO_INDEX };
}

export function parseMinSessions(argv) {
  return parseInt(argv.find(a => a.startsWith('--min-sessions='))?.split('=')[1] ?? '1');
}

export function buildFileNodesAndEdges(globalFiles, sessById, { minSessions = 1, referenceMs = Date.now() } = {}) {
  const nodes = [];
  const edges = [];
  if (globalFiles.length === 0) return { nodes, edges };
  const MAX_FILE_W = Math.max(1, ...globalFiles.map(f => f.write + f.edit));
  const fileLastTs = {};
  for (const f of globalFiles) {
    fileLastTs[f.path] = f.sessions.map(sid => {
      const s = sessById[sid];
      return s ? (s.last_timestamp || s.first_timestamp) : null;
    }).filter(Boolean).sort().pop() || null;
  }
  for (const f of globalFiles) {
    if (f.sessions.length < minSessions) continue;
    const ext      = (f.path.split('.').pop() || '').toLowerCase().split('?')[0];
    const sizeNorm = Math.sqrt((f.write + f.edit) / MAX_FILE_W);
    const fLastTs  = fileLastTs[f.path] || null;
    nodes.push({
      id: f.path, type: 'file', label: f.path.split('/').pop(),
      full_path: f.path, color: EXT_COLORS[ext] || '#666666', ext,
      read: f.read, write: f.write, edit: f.edit,
      session_count: f.sessions.length, sizeNorm,
      last_activity: fLastTs,
      recency:       calcRecencyScore(fLastTs, referenceMs),
      recencyLevel:  calcRecencyLevel(fLastTs, referenceMs),
    });
    for (const sessId of f.sessions) {
      const sess = sessById[sessId];
      if (!sess?.file_ops?.[f.path]) continue;
      const ops = sess.file_ops[f.path];
      if (ops.write > 0) edges.push({ source: sessId, target: f.path, type: 'write', weight: ops.write });
      if (ops.edit  > 0) edges.push({ source: sessId, target: f.path, type: 'edit',  weight: ops.edit  });
      if (ops.read  > 0) edges.push({ source: sessId, target: f.path, type: 'read',  weight: ops.read  });
    }
  }
  return { nodes, edges };
}

export function isSessionInFlight(session, referenceMs = Date.now(), thresholdMs = 2 * 60 * 1000) {
  if (!session.last_timestamp) return false;
  const age = referenceMs - new Date(session.last_timestamp).getTime();
  return age >= 0 && age < thresholdMs;
}

export function filterSessionsByDateRange(sessions, fromTs = null, toTs = null) {
  return sessions.filter(s => {
    const ts = s.first_timestamp;
    if (!ts) return true;
    if (fromTs && ts < fromTs) return false;
    if (toTs   && ts > toTs)   return false;
    return true;
  });
}

/**
 * Returns { nodes, edges } with hidden nodes and their connected edges removed.
 * Handles both plain string IDs and D3-mutated object references on edge.source/target.
 */
export function filterVisibleGraph(nodes, edges, hiddenNodeIds) {
  const hidden = new Set(hiddenNodeIds);
  return {
    nodes: nodes.filter(n => !hidden.has(n.id)),
    edges: edges.filter(e => {
      const s = e.source?.id ?? e.source;
      const t = e.target?.id ?? e.target;
      return !hidden.has(s) && !hidden.has(t);
    }),
  };
}

// ── Edge rendering constants ──────────────────────────────────────────────────

export const GRAPH_BACKGROUND = '#080810';

/** Stroke colours for each edge type. membership is tuned for ≥1.5 contrast against GRAPH_BACKGROUND. */
export const EDGE_COLORS = {
  membership: '#1e3d7a',
  write:      '#00ff88',
  edit:       '#ffcc00',
  read:       '#1e4a66',
  branch:     '#334455',
};

// ── Force-layout parameter definitions ───────────────────────────────────────

export const FORCE_PARAMS_DEFAULTS = {
  sessionCharge:  -130,
  projectCharge:  -700,
  fileCharge:     -55,
  membershipDist: 125,
  branchDist:     95,
  fileDist:       60,
  velocityDecay:  0.38,
};

export const FORCE_PARAMS_BOUNDS = {
  sessionCharge:  { min: -400, max: -20  },
  projectCharge:  { min: -2000, max: -100 },
  fileCharge:     { min: -200, max: -10  },
  membershipDist: { min: 50,   max: 300  },
  branchDist:     { min: 40,   max: 200  },
  fileDist:       { min: 20,   max: 150  },
  velocityDecay:  { min: 0.05, max: 0.90 },
};

export function clampForceParam(key, value) {
  const b = FORCE_PARAMS_BOUNDS[key];
  if (!b) return value;
  return Math.max(b.min, Math.min(b.max, value));
}
