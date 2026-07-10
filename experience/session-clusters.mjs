/**
 * experience/session-clusters.mjs
 *
 * Deterministic per-project session clustering for the graph view.
 * Similarity = weighted Jaccard: shared file sets (primary) + text tokens
 * from ai_title / first_user_message / skills (secondary). Pure — no I/O.
 */

export const CLUSTER_THRESHOLD = 0.35;
export const MIN_CLUSTER_SIZE  = 2;

const FILE_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into',
  'are', 'was', 'were', 'you', 'not', 'can', 'will',
  'have', 'has', 'had', 'its', 'our', 'your', 'all', 'use', 'when', 'then',
]);

export function tokenizeSessionText(sess) {
  const raw = [sess.ai_title, sess.first_user_message, ...(sess.skills || [])]
    .filter(Boolean).join(' ');
  const tokens = raw.toLowerCase().split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

export function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function fileSet(sess) {
  return new Set(Object.keys(sess.file_ops ?? {}));
}

export function sessionSimilarity(a, b) {
  const fa = fileSet(a), fb = fileSet(b);
  const textJ = jaccard(tokenizeSessionText(a), tokenizeSessionText(b));
  // Tokenless-file sessions would cap at TEXT_WEIGHT and never cluster —
  // fall back to pure text similarity when neither side touched files.
  if (fa.size === 0 && fb.size === 0) return textJ;
  return FILE_WEIGHT * jaccard(fa, fb) + TEXT_WEIGHT * textJ;
}

const byTimeThenId = (a, b) =>
  (a.first_timestamp || '') < (b.first_timestamp || '') ? -1 :
  (a.first_timestamp || '') > (b.first_timestamp || '') ? 1 :
  a.session_id < b.session_id ? -1 : 1;

/** Top entry of a frequency map: highest count first, then alphabetical key. */
function topByFreq(freq) {
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

export function autoLabel(members) {
  // 1. Text tokens shared by ≥2 members, top-2 by member frequency
  const tokenFreq = new Map();
  for (const m of members)
    for (const t of tokenizeSessionText(m))
      tokenFreq.set(t, (tokenFreq.get(t) || 0) + 1);
  const shared = topByFreq(tokenFreq).filter(([, n]) => n >= 2).slice(0, 2);
  if (shared.length) return shared.map(([t]) => t).join(' ');

  // 2. Most-shared file path's top-level dir
  const fileFreq = new Map();
  for (const m of members)
    for (const p of fileSet(m))
      fileFreq.set(p, (fileFreq.get(p) || 0) + 1);
  const topFile = topByFreq(fileFreq)[0];
  if (topFile) {
    const path = topFile[0];
    return path.includes('/') ? path.split('/')[0] : path;
  }

  // 3. Anchor's git branch
  const anchor = [...members].sort(byTimeThenId)[0];
  if (anchor?.git_branch) return anchor.git_branch;

  // 4. Size fallback
  return `bundle x${members.length}`;
}

/**
 * Cluster sessions per project via single-linkage union-find over pairs with
 * similarity ≥ threshold. Order-independent, hence deterministic.
 *
 * @returns {[{ id, project_id, label, member_ids, manual: false }]} sorted by id
 */
export function clusterSessions(sessions, { threshold = CLUSTER_THRESHOLD, minClusterSize = MIN_CLUSTER_SIZE } = {}) {
  const byProject = new Map();
  for (const s of sessions) {
    if (!byProject.has(s.project_id)) byProject.set(s.project_id, []);
    byProject.get(s.project_id).push(s);
  }

  const clusters = [];
  for (const [project_id, group] of byProject) {
    const sorted = [...group].sort(byTimeThenId);

    // union-find
    const parent = sorted.map((_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++)
        if (sessionSimilarity(sorted[i], sorted[j]) >= threshold)
          parent[find(j)] = find(i);

    const components = new Map();
    sorted.forEach((s, i) => {
      const root = find(i);
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(s);
    });

    for (const members of components.values()) {
      if (members.length < minClusterSize) continue;
      // members are already time-sorted; anchor = earliest
      clusters.push({
        id: `cluster:${project_id}:${members[0].session_id}`,
        project_id,
        label: autoLabel(members),
        member_ids: members.map(m => m.session_id),
        manual: false,
      });
    }
  }

  return clusters.sort((a, b) => a.id < b.id ? -1 : 1);
}

// ── Editorial overrides (cluster-overrides.json) ─────────────────────────────

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validate a parsed cluster-overrides.json. Returns { ok, errors[] }. */
export function validateClusterOverrides(obj) {
  const errors = [];
  if (!isPlainObject(obj)) {
    return { ok: false, errors: ['overrides must be an object'] };
  }
  if (obj.version !== 1) errors.push(`unsupported version: ${obj.version}`);
  if (!isPlainObject(obj.projects)) {
    errors.push('projects must be an object');
  } else {
    for (const [pid, proj] of Object.entries(obj.projects)) {
      if (!isPlainObject(proj)) { errors.push(`projects.${pid} must be an object`); continue; }
      if (proj.labels !== undefined) {
        if (!isPlainObject(proj.labels) || Object.values(proj.labels).some(v => typeof v !== 'string'))
          errors.push(`projects.${pid}.labels must map cluster ids to strings`);
      }
      if (proj.assign !== undefined) {
        if (!isPlainObject(proj.assign) || Object.values(proj.assign).some(v => typeof v !== 'string'))
          errors.push(`projects.${pid}.assign must map session ids to cluster names`);
      }
      if (proj.pin !== undefined) {
        if (!Array.isArray(proj.pin) || proj.pin.some(v => typeof v !== 'string'))
          errors.push(`projects.${pid}.pin must be an array of session ids`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

const slugify = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Cluster sessions with editorial overrides applied, in order:
 * 1. pinned sessions are excluded from clustering entirely
 * 2. assigned sessions form manual clusters by name (even below min size)
 * 3. remaining sessions auto-cluster per project
 * 4. label renames apply by cluster id (auto and manual)
 */
export function buildClusters(sessions, overrides, opts = {}) {
  const projects = overrides?.projects || {};

  const pinned = new Set();
  const assignedTo = new Map();   // session_id → manual cluster name
  for (const [pid, proj] of Object.entries(projects)) {
    for (const sid of proj.pin || []) pinned.add(`${pid} ${sid}`);
    for (const [sid, name] of Object.entries(proj.assign || {})) assignedTo.set(`${pid} ${sid}`, name);
  }

  const autoPool = [];
  const manualGroups = new Map();  // pid -> Map(name -> members[])
  for (const s of sessions) {
    const key = `${s.project_id} ${s.session_id}`;
    if (pinned.has(key)) continue;
    const name = assignedTo.get(key);
    if (name !== undefined) {
      if (!manualGroups.has(s.project_id)) manualGroups.set(s.project_id, new Map());
      const byName = manualGroups.get(s.project_id);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(s);
    } else {
      autoPool.push(s);
    }
  }

  const clusters = clusterSessions(autoPool, opts)
    .map(c => ({ ...c, label_overridden: false }));

  for (const [project_id, byName] of manualGroups) {
    for (const [name, members] of byName) {
      members.sort(byTimeThenId);
      clusters.push({
        id: `cluster:${project_id}:manual:${slugify(name)}`,
        project_id,
        label: name,
        member_ids: members.map(m => m.session_id),
        manual: true,
        label_overridden: false,
      });
    }
  }

  for (const c of clusters) {
    const rename = projects[c.project_id]?.labels?.[c.id];
    if (typeof rename === 'string') {
      c.label = rename;
      c.label_overridden = true;
    }
  }

  return clusters.sort((a, b) => a.id < b.id ? -1 : 1);
}
