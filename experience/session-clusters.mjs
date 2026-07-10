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
