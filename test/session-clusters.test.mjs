import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeSessionText, jaccard, sessionSimilarity, autoLabel, clusterSessions,
  CLUSTER_THRESHOLD, MIN_CLUSTER_SIZE,
} from '../experience/session-clusters.mjs';

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeSess(overrides = {}) {
  return {
    session_id: 's1',
    project_id: 'proj-a',
    tokens: { input: 10, output: 100, cache_create: 50, cache_read: 200 },
    first_timestamp: '2026-07-01T10:00:00Z',
    last_timestamp: '2026-07-01T11:00:00Z',
    git_branch: 'main',
    file_ops: {},
    skills: [],
    ai_title: null,
    first_user_message: null,
    ...overrides,
  };
}

const fileOps = (...paths) =>
  Object.fromEntries(paths.map(p => [p, { read: 1, write: 1, edit: 0 }]));

// ── tokenizeSessionText ──────────────────────────────────────────────────────

test('tokenize: lowercases and splits on non-alphanumeric', () => {
  const toks = tokenizeSessionText(makeSess({ ai_title: 'Fix Auth-Login Flow!' }));
  assert.ok(toks.has('fix'));
  assert.ok(toks.has('auth'));
  assert.ok(toks.has('login'));
  assert.ok(toks.has('flow'));
});

test('tokenize: drops tokens shorter than 3 chars', () => {
  const toks = tokenizeSessionText(makeSess({ ai_title: 'go to db fix' }));
  assert.ok(!toks.has('go'));
  assert.ok(!toks.has('to'));
  assert.ok(!toks.has('db'));
  assert.ok(toks.has('fix'));
});

test('tokenize: drops stopwords', () => {
  const toks = tokenizeSessionText(makeSess({ first_user_message: 'the auth and the login for this session' }));
  assert.ok(!toks.has('the'));
  assert.ok(!toks.has('and'));
  assert.ok(!toks.has('for'));
  assert.ok(!toks.has('this'));
  assert.ok(toks.has('auth'));
  assert.ok(toks.has('login'));
  assert.ok(toks.has('session'));
});

test('tokenize: merges ai_title, first_user_message, and skills; dedupes', () => {
  const toks = tokenizeSessionText(makeSess({
    ai_title: 'auth rework',
    first_user_message: 'rework the auth flow',
    skills: ['commit-helper'],
  }));
  assert.ok(toks.has('auth'));
  assert.ok(toks.has('rework'));
  assert.ok(toks.has('flow'));
  assert.ok(toks.has('commit'));
  assert.ok(toks.has('helper'));
  // Set semantics — each token once
  assert.equal([...toks].filter(t => t === 'auth').length, 1);
});

test('tokenize: empty/missing fields give empty set', () => {
  const toks = tokenizeSessionText(makeSess({}));
  assert.equal(toks.size, 0);
});

// ── jaccard ──────────────────────────────────────────────────────────────────

test('jaccard: identical sets → 1', () => {
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
});

test('jaccard: disjoint sets → 0', () => {
  assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
});

test('jaccard: two empty sets → 0, never 1', () => {
  assert.equal(jaccard(new Set(), new Set()), 0);
});

test('jaccard: partial overlap', () => {
  // {a,b} vs {b,c}: intersection 1, union 3
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3);
});

// ── sessionSimilarity ────────────────────────────────────────────────────────

test('similarity: identical file sets, no text → 0.7', () => {
  const a = makeSess({ file_ops: fileOps('src/auth.js', 'src/login.js') });
  const b = makeSess({ session_id: 's2', file_ops: fileOps('src/auth.js', 'src/login.js') });
  assert.equal(sessionSimilarity(a, b), 0.7);
});

test('similarity: identical text, no files on either side → pure text jaccard (1.0)', () => {
  const a = makeSess({ ai_title: 'auth rework login' });
  const b = makeSess({ session_id: 's2', ai_title: 'auth rework login' });
  assert.equal(sessionSimilarity(a, b), 1);
});

test('similarity: weighted blend when files present', () => {
  // fileJ = 1, textJ = 0 → 0.7 ; fileJ = 0 (one side has files), textJ = 1 → 0.3
  const a = makeSess({ file_ops: fileOps('src/a.js'), ai_title: 'auth' });
  const b = makeSess({ session_id: 's2', file_ops: fileOps('src/b.js'), ai_title: 'auth' });
  assert.ok(Math.abs(sessionSimilarity(a, b) - 0.3) < 1e-9);
});

test('similarity: one side has files, other empty → weighted (not pure-text special case)', () => {
  const a = makeSess({ file_ops: fileOps('src/a.js'), ai_title: 'auth rework' });
  const b = makeSess({ session_id: 's2', ai_title: 'auth rework' });
  // fileJ = 0 (union non-empty), textJ = 1 → 0.3
  assert.ok(Math.abs(sessionSimilarity(a, b) - 0.3) < 1e-9);
});

// ── clusterSessions ──────────────────────────────────────────────────────────

test('exports sane constants', () => {
  assert.equal(CLUSTER_THRESHOLD, 0.35);
  assert.equal(MIN_CLUSTER_SIZE, 2);
});

test('cluster: sessions sharing files cluster; disjoint session stays out', () => {
  const sessions = [
    makeSess({ session_id: 's1', file_ops: fileOps('src/auth.js', 'src/login.js'), first_timestamp: '2026-07-01T10:00:00Z' }),
    makeSess({ session_id: 's2', file_ops: fileOps('src/auth.js', 'src/login.js'), first_timestamp: '2026-07-02T10:00:00Z' }),
    makeSess({ session_id: 's3', file_ops: fileOps('src/auth.js'), first_timestamp: '2026-07-03T10:00:00Z' }),
    makeSess({ session_id: 's4', file_ops: fileOps('docs/readme.md'), first_timestamp: '2026-07-04T10:00:00Z' }),
  ];
  const clusters = clusterSessions(sessions);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].member_ids, ['s1', 's2', 's3']);
  assert.equal(clusters[0].project_id, 'proj-a');
  assert.equal(clusters[0].manual, false);
});

test('cluster: never clusters across projects even with identical file sets', () => {
  const sessions = [
    makeSess({ session_id: 's1', project_id: 'proj-a', file_ops: fileOps('src/x.js') }),
    makeSess({ session_id: 's2', project_id: 'proj-b', file_ops: fileOps('src/x.js') }),
  ];
  assert.equal(clusterSessions(sessions).length, 0);
});

test('cluster: singletons dropped (min cluster size 2)', () => {
  const sessions = [
    makeSess({ session_id: 's1', file_ops: fileOps('a.js') }),
    makeSess({ session_id: 's2', file_ops: fileOps('b.js') }),
  ];
  assert.equal(clusterSessions(sessions).length, 0);
});

test('cluster: deterministic under shuffled input', () => {
  const base = [
    makeSess({ session_id: 's1', file_ops: fileOps('src/a.js', 'src/b.js'), first_timestamp: '2026-07-01T10:00:00Z', ai_title: 'auth rework' }),
    makeSess({ session_id: 's2', file_ops: fileOps('src/a.js', 'src/b.js'), first_timestamp: '2026-07-02T10:00:00Z', ai_title: 'auth rework more' }),
    makeSess({ session_id: 's3', file_ops: fileOps('src/b.js', 'src/a.js'), first_timestamp: '2026-07-03T10:00:00Z' }),
    makeSess({ session_id: 's4', file_ops: fileOps('docs/x.md', 'docs/y.md'), first_timestamp: '2026-07-01T12:00:00Z' }),
    makeSess({ session_id: 's5', file_ops: fileOps('docs/x.md', 'docs/y.md'), first_timestamp: '2026-07-02T12:00:00Z' }),
  ];
  const shuffled = [base[3], base[1], base[4], base[0], base[2]];
  assert.deepEqual(clusterSessions(shuffled), clusterSessions(base));
});

test('cluster: id anchored to earliest member, stable when later member joins', () => {
  const s1 = makeSess({ session_id: 's1', file_ops: fileOps('src/a.js'), first_timestamp: '2026-07-01T10:00:00Z' });
  const s2 = makeSess({ session_id: 's2', file_ops: fileOps('src/a.js'), first_timestamp: '2026-07-02T10:00:00Z' });
  const s3 = makeSess({ session_id: 's3', file_ops: fileOps('src/a.js'), first_timestamp: '2026-07-03T10:00:00Z' });
  const before = clusterSessions([s1, s2]);
  const after  = clusterSessions([s1, s2, s3]);
  assert.equal(before[0].id, 'cluster:proj-a:s1');
  assert.equal(after[0].id, 'cluster:proj-a:s1');
  assert.deepEqual(after[0].member_ids, ['s1', 's2', 's3']);
});

test('cluster: anchor tie-break is lexicographic session_id', () => {
  const sessions = [
    makeSess({ session_id: 'zz', file_ops: fileOps('a.js'), first_timestamp: '2026-07-01T10:00:00Z' }),
    makeSess({ session_id: 'aa', file_ops: fileOps('a.js'), first_timestamp: '2026-07-01T10:00:00Z' }),
  ];
  assert.equal(clusterSessions(sessions)[0].id, 'cluster:proj-a:aa');
});

test('cluster: members sorted by (first_timestamp, session_id)', () => {
  const sessions = [
    makeSess({ session_id: 's3', file_ops: fileOps('a.js'), first_timestamp: '2026-07-03T10:00:00Z' }),
    makeSess({ session_id: 's1', file_ops: fileOps('a.js'), first_timestamp: '2026-07-01T10:00:00Z' }),
    makeSess({ session_id: 's2', file_ops: fileOps('a.js'), first_timestamp: '2026-07-02T10:00:00Z' }),
  ];
  assert.deepEqual(clusterSessions(sessions)[0].member_ids, ['s1', 's2', 's3']);
});

test('cluster: threshold overridable via opts', () => {
  // similarity here: fileJ = 1/3 → 0.7/3 ≈ 0.233 — below default, above 0.2
  const sessions = [
    makeSess({ session_id: 's1', file_ops: fileOps('a.js', 'b.js') }),
    makeSess({ session_id: 's2', file_ops: fileOps('a.js', 'c.js') }),
  ];
  assert.equal(clusterSessions(sessions).length, 0);
  assert.equal(clusterSessions(sessions, { threshold: 0.2 }).length, 1);
});

// ── autoLabel ────────────────────────────────────────────────────────────────

test('autoLabel: top-2 shared text tokens by member frequency, alpha tie-break', () => {
  const members = [
    makeSess({ session_id: 's1', ai_title: 'auth login rework' }),
    makeSess({ session_id: 's2', ai_title: 'auth login cleanup' }),
    makeSess({ session_id: 's3', ai_title: 'auth session fix' }),
  ];
  // freq: auth 3, login 2, others 1 → 'auth login'
  assert.equal(autoLabel(members), 'auth login');
});

test('autoLabel: falls back to most-shared file top-level dir when no shared tokens', () => {
  const members = [
    makeSess({ session_id: 's1', file_ops: fileOps('src/auth.js', 'test/x.js') }),
    makeSess({ session_id: 's2', file_ops: fileOps('src/auth.js') }),
  ];
  assert.equal(autoLabel(members), 'src');
});

test('autoLabel: falls back to anchor git_branch when no tokens and no files', () => {
  const members = [
    makeSess({ session_id: 's1', git_branch: 'feat/auth', first_timestamp: '2026-07-01T10:00:00Z' }),
    makeSess({ session_id: 's2', git_branch: 'main', first_timestamp: '2026-07-02T10:00:00Z' }),
  ];
  assert.equal(autoLabel(members), 'feat/auth');
});

test('autoLabel: final fallback bundle xN', () => {
  const members = [
    makeSess({ session_id: 's1', git_branch: null }),
    makeSess({ session_id: 's2', git_branch: null }),
  ];
  assert.equal(autoLabel(members), 'bundle x2');
});
