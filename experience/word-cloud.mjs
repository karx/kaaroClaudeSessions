/**
 * experience/word-cloud.mjs
 *
 * One linear pass over already-normalized sessions-data.json → bags of
 * {t, n, w} terms, plus a cheap golden-angle polar renderer (SVG / HTML).
 * No JSONL reread, no TF-IDF, no force, no spiral packing.
 *
 * Collated intent is two bags from the same pass:
 *   intent       — titles + prompts + skills, English stops only
 *   intent_topic — same, minus AGENT_CHROME (verbs/filler coding agents say)
 */

export const CLOUD_LIMIT = 80;
export const MONTH_LIMIT = 12;
/** PNG floor only. Signals layout does not apply it. */
export const WORD_SIGNAL_MIN_DF = 3;

/** Function words. Always dropped. */
export const CLOUD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into',
  'are', 'was', 'were', 'you', 'not', 'can', 'will',
  'have', 'has', 'had', 'its', 'our', 'your', 'all', 'use', 'when', 'then',
  'let', 'lets', 'please', 'just', 'also', 'some', 'more',
  'what', 'how', 'why', 'does', 'did', 'using', 'used', 'based',
  'over', 'out', 'via', 'per', 'who', 'like', 'each', 'full', 'about',
  'any', 'than', 'them', 'they', 'but', 'been', 'being',
]);

/** IDE / path crumbs that leak into first_user_message context dumps. */
export const PATH_CRUMBS = new Set([
  'users', 'src', 'home', 'tmp', 'cwd', 'users-arshigoyal',
  'http', 'https', 'www', 'html',
]);

/**
 * Words coding agents say in every session — work-verbs and review-prompt
 * filler. Optional second filter on the collated intent bag. Topics (rfc,
 * city, garden, kaaro, git, …) stay.
 */
export const AGENT_CHROME = new Set([
  'add', 'added', 'adding',
  'build', 'building', 'built',
  'create', 'created', 'creating',
  'check', 'checking', 'checked',
  'fix', 'fixed', 'fixing',
  'implement', 'implemented', 'implementation', 'implementer',
  'update', 'updated', 'updating',
  'make', 'making', 'made',
  'help', 'helping',
  'need', 'needed', 'needs',
  'want', 'wants',
  'run', 'running',
  'open', 'opening',
  'write', 'writes', 'writing', 'written',
  'read', 'reading',
  'review', 'reviewing', 'reviewer',
  'revise', 'revised',
  'ensure', 'ensuring',
  'complete', 'completed', 'completing',
  'understand', 'understanding',
  'explore', 'exploring',
  'analyze', 'analysing', 'analysis',
  'look', 'looking',
  'try', 'trying',
  'start', 'starting',
  'stop', 'stopping',
  'change', 'changing', 'changed',
  'work', 'working',
  'produce', 'produced', 'producing',
  'give', 'given',
  'get', 'getting',
  'set', 'setting',
  'plan', 'planning',
  'see', 'seeing',
  'keep', 'keeping',
  'show', 'showing',
  'take', 'taking',
  'put',
  'file', 'code',
  'status', 'process', 'issue', 'name', 'prompt', 'goal',
  'findings', 'references', 'staff', 'location', 'path',
  'meticulous', 'thorough', 'thoroughly', 'experienced', 'pragmatic',
  'relevant', 'relative', 'structured', 'clear', 'ready', 'existing',
  'current',
]);

/**
 * Strip leaked `<think>…</think>` preambles that some harnesses stuffed into
 * ai_title. Keep the line after the closing tag when present.
 */
export function cleanTitle(raw) {
  if (!raw) return '';
  const s = String(raw);
  const close = s.toLowerCase().lastIndexOf('</think>');
  if (close >= 0) return s.slice(close + 8).trim();
  if (/<think>/i.test(s)) return '';
  return s.trim();
}

/** Drop truncated leftovers (`documen` next to `document`) — cap-200 prompt crumbs. */
export function dropTruncations(freq) {
  const keys = [...freq.keys()];
  const out = new Map(freq);
  for (const t of keys) {
    if (t.length < 5 || !out.has(t)) continue;
    for (const k of keys) {
      if (k === t || !out.has(k)) continue;
      if (k.startsWith(t) && k.length - t.length <= 3 && out.get(k) >= out.get(t)) {
        out.delete(t);
        break;
      }
    }
  }
  return out;
}

/** Merge `documents` into `document` only when the singular is already present. */
export function mergePlurals(freq) {
  const out = new Map(freq);
  for (const [t, n] of freq) {
    if (!(t.endsWith('s') && t.length > 4) || /(ss|us|is|as|os)$/.test(t)) continue;
    const stem = t.slice(0, -1);
    if (!out.has(stem)) continue;
    out.set(stem, out.get(stem) + n);
    out.delete(t);
  }
  return out;
}

export function isAgentChrome(t) {
  if (AGENT_CHROME.has(t)) return true;
  if (t.endsWith('s') && t.length > 4 && !/(ss|us|is|as|os)$/.test(t) && AGENT_CHROME.has(t.slice(0, -1))) return true;
  return false;
}

export function tokenizeText(raw) {
  return String(raw || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !CLOUD_STOPWORDS.has(t) && !PATH_CRUMBS.has(t) && !/^[0-9]+$/.test(t));
}

export function tokenizeIntent(sess) {
  const raw = [
    cleanTitle(sess?.ai_title),
    sess?.first_user_message,
    ...(sess?.skills || []),
  ].filter(Boolean).join(' ');
  return new Set(tokenizeText(raw));
}

/**
 * Per-session collated intent weights.
 * Title and slash-skills count 2, first_user_message counts 1.
 * English stops + path crumbs already gone; agent chrome still present.
 */
export function sessionIntentWeights(sess) {
  const title = new Set(tokenizeText(cleanTitle(sess?.ai_title)));
  const msg = new Set(tokenizeText(sess?.first_user_message));
  const weights = new Map();
  for (const t of msg) weights.set(t, 1);
  for (const t of title) weights.set(t, 2);
  for (const skill of (sess?.skills || [])) {
    const s = String(skill).toLowerCase().replace(/^\/+/, '');
    if (s.length >= 3 && !CLOUD_STOPWORDS.has(s) && !PATH_CRUMBS.has(s) && !/^[0-9]+$/.test(s)) {
      weights.set(s, Math.max(weights.get(s) || 0, 2));
    }
  }
  return weights;
}

/** Basename without extension, forward-slash normalised. */
export function fileStem(filePath) {
  const base = String(filePath || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
  return stem;
}

function isNoiseStem(stem) {
  if (!stem || stem.length < 2) return true;
  if (stem.startsWith('.')) return true;
  if (stem.length > 40) return true;
  // uuid / hex session crumbs that leaked into a path
  if (/^[0-9a-f-]{8,}$/.test(stem)) return true;
  if (/[0-9a-f]{8}/.test(stem)) return true;
  return CLOUD_STOPWORDS.has(stem);
}

function toolCalls(info) {
  if (typeof info === 'number') return info;
  if (info && typeof info.calls === 'number') return info.calls;
  return 0;
}

/** Prefer sess.tools; GRAPH session nodes only carry tools_top. */
function toolEntries(sess) {
  if (sess?.tools && typeof sess.tools === 'object' && !Array.isArray(sess.tools)) {
    return Object.entries(sess.tools).map(([name, info]) => [name, toolCalls(info)]);
  }
  if (Array.isArray(sess?.tools_top)) {
    return sess.tools_top.map(x => [x.name || '', x.calls || 0]);
  }
  return [];
}

/**
 * Five-entity escape. File-private — must not be named `esc`:
 * the injected word-cloud module and client-core share one classic-script
 * scope on /graph, so a second `function esc` is a duplicate-declaration SyntaxError.
 */
function cloudEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function signalFontPx(w, min, max) {
  return min + (Number(w) || 0) * (max - min);
}

function truncLabel(t, trunc) {
  const s = String(t || '');
  if (!trunc || s.length <= trunc) return s;
  return s.slice(0, Math.max(1, trunc - 1)) + '…';
}

function sessionMonth(sess) {
  const d = sess?.date_str || sess?.first_timestamp || '';
  return String(d).slice(0, 7);
}

/** Highest count first, then alphabetical — stable across runs. */
export function rankTerms(freq, limit) {
  const values = [...freq.values()];
  const max = values.length ? Math.max(...values) : 1;
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([t, n]) => ({ t, n, w: n / max }));
}

/**
 * Golden-angle point in unit square. i=0 sits near the centre.
 * No collision — O(1) per term.
 */
export function goldenPoint(i, n) {
  const count = Math.max(n, 1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const r = Math.sqrt((i + 0.5) / count);
  const a = i * golden;
  return {
    x: 0.5 + 0.42 * r * Math.cos(a),
    y: 0.5 + 0.42 * r * Math.sin(a),
  };
}

/**
 * Ranked bag → paint items. Unit-square x,y from goldenPoint; i=0 near centre.
 * Empty / missing terms → [].
 */
export function wordSignalItems(terms, { cap = 28, fontMin = 9, fontMax = 11, trunc = 22 } = {}) {
  if (!Array.isArray(terms) || !terms.length) return [];
  const sliced = terms.slice(0, cap);
  const n = sliced.length;
  return sliced.map((term, i) => {
    const p = goldenPoint(i, n);
    const w = term?.w || 0;
    return {
      t: term?.t || '',
      n: term?.n || 0,
      w,
      x: p.x,
      y: p.y,
      fontPx: signalFontPx(w, fontMin, fontMax),
      label: truncLabel(term?.t, trunc),
    };
  });
}

/**
 * SVG polar. fillFor is required for colour; wrapper <svg> clips overflow.
 * Empty → one dim "no terms" at pane centre.
 */
export function wordSignalSvg(terms, opts = {}) {
  const {
    x = 0, y = 0, w = 283, h = 132,
    cap = 28, fontMin = 9, fontMax = 11, trunc = 10,
    fillFor,
    clip = true,
  } = opts;
  const items = wordSignalItems(terms, { cap, fontMin, fontMax, trunc });
  const fill = typeof fillFor === 'function' ? fillFor : () => '#445544';
  let inner;
  if (!items.length) {
    inner = `<text text-anchor="middle" x="${(w / 2).toFixed(1)}" y="${(h / 2).toFixed(1)}" font-size="${fontMin}" fill="#445544">no terms</text>`;
  } else {
    inner = items.map(item =>
      `<text text-anchor="middle" x="${(item.x * w).toFixed(1)}" y="${(item.y * h).toFixed(1)}" font-size="${item.fontPx.toFixed(1)}" fill="${fill(item.w)}">${cloudEsc(item.label)}</text>`
    ).join('');
  }
  if (!clip) return inner;
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}">${inner}</svg>`;
}

/**
 * HTML polar. Colours via CSS variables — no fillFor.
 * Empty → the same copy as /cloud.
 */
export function wordSignalHtml(terms, { cap = 40, fontMin = 10, fontMax = 28, trunc = 22, unit = '' } = {}) {
  const items = wordSignalItems(terms, { cap, fontMin, fontMax, trunc });
  if (!items.length) return '<div id="empty">━━━ no terms ━━━</div>';
  const u = unit || 'n';
  return '<div class="polar">' + items.map(item => {
    const color = item.w >= 0.7 ? 'var(--k-data)'
      : item.w >= 0.4 ? 'var(--k-label)'
      : item.w >= 0.2 ? 'var(--k-body)'
      : 'var(--k-dim)';
    return '<span class="w" title="' + cloudEsc(item.t) + ' · ' + item.n + ' ' + u + '" style="left:' +
      (item.x * 100).toFixed(2) + '%;top:' + (item.y * 100).toFixed(2) +
      '%;font-size:' + item.fontPx.toFixed(1) + 'px;color:' + color + '">' +
      cloudEsc(item.label) + '</span>';
  }).join('') + '</div>';
}

/**
 * @param {{ sessions?: object[], meta?: object }} data
 * @param {{ limit?: number, monthLimit?: number }} [opts]
 */
export function buildWordCloud(data, opts = {}) {
  const limit = opts.limit ?? CLOUD_LIMIT;
  const monthLimit = opts.monthLimit ?? MONTH_LIMIT;
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];

  const intent = new Map();
  const topic = new Map();
  const stems = new Map();
  const actions = new Map();
  const months = new Map();

  for (const sess of sessions) {
    const weights = sessionIntentWeights(sess);
    for (const [t, n] of weights) {
      intent.set(t, (intent.get(t) || 0) + n);
      if (!isAgentChrome(t)) topic.set(t, (topic.get(t) || 0) + n);
    }

    const month = sessionMonth(sess);
    if (/^\d{4}-\d{2}$/.test(month) && weights.size) {
      let bucket = months.get(month);
      if (!bucket) { bucket = new Map(); months.set(month, bucket); }
      for (const [t, n] of weights) bucket.set(t, (bucket.get(t) || 0) + n);
    }

    const seenStems = new Set();
    for (const p of Object.keys(sess?.file_ops || {})) {
      const stem = fileStem(p);
      if (isNoiseStem(stem) || seenStems.has(stem)) continue;
      seenStems.add(stem);
      stems.set(stem, (stems.get(stem) || 0) + 1);
    }

    for (const [name, n] of toolEntries(sess)) {
      if (n > 0 && name) actions.set(name, (actions.get(name) || 0) + n);
    }
  }

  return {
    generated_at: data?.meta?.generated_at ?? null,
    session_count: sessions.length,
    intent: rankTerms(dropTruncations(mergePlurals(intent)), limit),
    intent_topic: rankTerms(dropTruncations(mergePlurals(topic)), limit),
    stems: rankTerms(stems, limit),
    actions: rankTerms(actions, limit),
    months: [...months.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, freq]) => ({ month, terms: rankTerms(dropTruncations(mergePlurals(freq)), monthLimit) })),
  };
}
