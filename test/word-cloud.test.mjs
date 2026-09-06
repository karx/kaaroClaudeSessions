/**
 * test/word-cloud.test.mjs → experience/word-cloud.mjs
 *
 * Cheap bags from normalized sessions-data.json. One pass, no I/O.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTitle, tokenizeIntent, fileStem, rankTerms, goldenPoint, buildWordCloud,
  mergePlurals, dropTruncations, sessionIntentWeights, AGENT_CHROME, isAgentChrome, CLOUD_LIMIT,
  WORD_SIGNAL_MIN_DF, wordSignalItems, wordSignalSvg, wordSignalHtml,
} from '../experience/word-cloud.mjs';

function makeSess(over = {}) {
  return {
    session_id: over.session_id || 's1',
    project_id: 'p1',
    tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 },
    ...over,
  };
}

test('cleanTitle: strips leaked think blocks, keeps the real title', () => {
  const leaked = `<think>The user wants a title.\nI'll go with something clear.</think>\n\nCheck git branch status`;
  assert.equal(cleanTitle(leaked), 'Check git branch status');
});

test('cleanTitle: open think with no close is dropped', () => {
  assert.equal(cleanTitle('<think>still thinking'), '');
});

test('cleanTitle: empty / missing is empty string', () => {
  assert.equal(cleanTitle(''), '');
  assert.equal(cleanTitle(null), '');
  assert.equal(cleanTitle(undefined), '');
});

test('tokenizeIntent: lowercases, drops stops and short tokens, dedupes', () => {
  const toks = tokenizeIntent(makeSess({
    ai_title: 'Fix Auth-Login Flow!',
    first_user_message: 'the auth and the login for this session',
  }));
  assert.ok(toks.has('auth'));
  assert.ok(toks.has('login'));
  assert.ok(toks.has('flow'));
  assert.equal(toks.has('the'), false);
  assert.equal(toks.has('for'), false);
  assert.equal(toks.has('fix'), true);
});

test('tokenizeIntent: ignores leaked think preamble tokens', () => {
  const toks = tokenizeIntent(makeSess({
    ai_title: `<think>Possible titles: Review current git state</think>\nCheck git branch status`,
  }));
  assert.ok(toks.has('git'));
  assert.ok(toks.has('branch'));
  assert.ok(toks.has('status'));
  assert.equal(toks.has('possible'), false);
  assert.equal(toks.has('titles'), false);
});

test('tokenizeIntent: drops path crumbs from IDE context dumps', () => {
  const toks = tokenizeIntent(makeSess({
    first_user_message: 'users arshigoyal src kaaro garden notes',
  }));
  assert.equal(toks.has('users'), false);
  assert.equal(toks.has('src'), false);
  assert.ok(toks.has('garden'));
  assert.ok(toks.has('kaaro'));
});

test('tokenizeIntent: skills count, empty fields yield empty set', () => {
  const withSkill = tokenizeIntent(makeSess({ skills: ['review-pr'] }));
  assert.ok(withSkill.has('review'));
  assert.equal(tokenizeIntent(makeSess({})).size, 0);
});

test('fileStem: basename without extension, slash-normalised', () => {
  assert.equal(fileStem('hooks/adapters/claude-code.mjs'), 'claude-code');
  assert.equal(fileStem('C:\\src\\README.md'), 'readme');
  assert.equal(fileStem('Makefile'), 'makefile');
});

test('rankTerms: count desc then alpha; weight is n/max', () => {
  const ranked = rankTerms(new Map([['b', 2], ['a', 2], ['c', 4]]), 10);
  assert.deepEqual(ranked.map(x => x.t), ['c', 'a', 'b']);
  assert.equal(ranked[0].w, 1);
  assert.equal(ranked[1].w, 0.5);
  assert.equal(ranked.length, 3);
});

test('rankTerms: respects limit', () => {
  assert.equal(rankTerms(new Map([['a', 3], ['b', 2], ['c', 1]]), 2).length, 2);
});

test('goldenPoint: i=0 near centre; all points stay in unit square', () => {
  const n = 40;
  for (let i = 0; i < n; i++) {
    const p = goldenPoint(i, n);
    assert.ok(p.x >= 0 && p.x <= 1, `x ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 1, `y ${p.y}`);
  }
  const c = goldenPoint(0, n);
  assert.ok(Math.hypot(c.x - 0.5, c.y - 0.5) < 0.2);
});

test('mergePlurals: folds documents into document when both present', () => {
  const m = mergePlurals(new Map([['document', 5], ['documents', 3], ['session', 2], ['status', 4]]));
  assert.equal(m.get('document'), 8);
  assert.equal(m.has('documents'), false);
  assert.equal(m.get('session'), 2);
  assert.equal(m.get('status'), 4);
});

test('dropTruncations: drops documen when document is present', () => {
  const m = dropTruncations(new Map([['document', 12], ['documen', 7], ['kaaro', 10], ['kaarobrain', 2]]));
  assert.equal(m.has('documen'), false);
  assert.equal(m.get('document'), 12);
  assert.equal(m.get('kaaro'), 10);
  assert.equal(m.get('kaarobrain'), 2);
});

test('sessionIntentWeights: title counts 2, message counts 1', () => {
  const w = sessionIntentWeights(makeSess({
    ai_title: 'Share card RFC',
    first_user_message: 'build the share card',
  }));
  assert.equal(w.get('share'), 2);
  assert.equal(w.get('card'), 2);
  assert.equal(w.get('rfc'), 2);
  assert.equal(w.get('build'), 1);
});

test('AGENT_CHROME covers agent verbs, not world nouns', () => {
  assert.ok(AGENT_CHROME.has('build'));
  assert.ok(AGENT_CHROME.has('review'));
  assert.ok(AGENT_CHROME.has('check'));
  assert.equal(AGENT_CHROME.has('rfc'), false);
  assert.equal(AGENT_CHROME.has('city'), false);
  assert.equal(AGENT_CHROME.has('kaaro'), false);
  assert.equal(AGENT_CHROME.has('garden'), false);
  assert.equal(isAgentChrome('changes'), true);
  assert.equal(isAgentChrome('rfc'), false);
});

test('buildWordCloud: collated intent weights titles; topic drops agent chrome', () => {
  const cloud = buildWordCloud({
    meta: { generated_at: '2026-09-06T00:00:00.000Z' },
    sessions: [
      makeSess({ ai_title: 'Review git status', first_user_message: 'check the branch' }),
      makeSess({ ai_title: 'Review share card', first_user_message: 'design the card' }),
    ],
  });
  assert.equal(cloud.session_count, 2);
  assert.equal(cloud.generated_at, '2026-09-06T00:00:00.000Z');
  const review = cloud.intent.find(x => x.t === 'review');
  assert.equal(review.n, 4); // two titles × weight 2
  assert.equal(review.w, 1);
  assert.equal(cloud.intent_topic.some(x => x.t === 'review'), false);
  assert.equal(cloud.intent_topic.some(x => x.t === 'check'), false);
  assert.ok(cloud.intent_topic.some(x => x.t === 'share'));
  assert.ok(cloud.intent_topic.some(x => x.t === 'git'));
});

test('buildWordCloud: stems count sessions that touched a basename', () => {
  const cloud = buildWordCloud({
    sessions: [
      makeSess({ file_ops: { 'src/app.ts': { read: 1 }, 'lib/app.js': { write: 1 } } }),
      makeSess({ file_ops: { 'src/app.ts': { edit: 1 } } }),
    ],
  });
  const app = cloud.stems.find(x => x.t === 'app');
  assert.equal(app.n, 2); // two sessions, even though first session had two app files
});

test('buildWordCloud: drops dotfile stems', () => {
  const cloud = buildWordCloud({
    sessions: [
      makeSess({ file_ops: { 'repo/.gitignore': { read: 1 }, 'src/app.ts': { read: 1 } } }),
    ],
  });
  assert.equal(cloud.stems.some(x => x.t.startsWith('.')), false);
  assert.ok(cloud.stems.some(x => x.t === 'app'));
});

test('buildWordCloud: drops uuid-like stems', () => {
  const cloud = buildWordCloud({
    sessions: [
      makeSess({ file_ops: { 'tmp/35eef452-aaaa-bbbb-cccc-ddddeeeeffff.json': { read: 1 } } }),
    ],
  });
  assert.equal(cloud.stems.length, 0);
});

test('buildWordCloud: drops stems that embed an 8-char hex id', () => {
  const cloud = buildWordCloud({
    sessions: [
      makeSess({ file_ops: {
        'docs/grok-design-review-35eef452.md': { read: 1 },
        'hooks/analyze.mjs': { read: 1 },
      } }),
    ],
  });
  assert.equal(cloud.stems.some(x => x.t.includes('35eef452')), false);
  assert.ok(cloud.stems.some(x => x.t === 'analyze'));
});

test('buildWordCloud: actions sum tool.calls', () => {
  const cloud = buildWordCloud({
    sessions: [
      makeSess({ tools: { read_file: { calls: 4, errors: 0 }, grep: { calls: 2 } } }),
      makeSess({ tools: { read_file: { calls: 1 } } }),
    ],
  });
  assert.equal(cloud.actions.find(x => x.t === 'read_file').n, 5);
  assert.equal(cloud.actions.find(x => x.t === 'grep').n, 2);
});

test('buildWordCloud: months facet intent by YYYY-MM', () => {
  const cloud = buildWordCloud({
    sessions: [
      makeSess({ date_str: '2026-08-01', ai_title: 'City buildings on seats' }),
      makeSess({ first_timestamp: '2026-09-02T00:00:00.000Z', ai_title: 'City roof ring' }),
    ],
  });
  assert.deepEqual(cloud.months.map(m => m.month), ['2026-08', '2026-09']);
  assert.ok(cloud.months[0].terms.some(t => t.t === 'city'));
  assert.ok(cloud.months[0].terms.length <= 12);
});

test('buildWordCloud: empty / missing sessions is a valid empty payload', () => {
  const cloud = buildWordCloud({});
  assert.equal(cloud.session_count, 0);
  assert.deepEqual(cloud.intent, []);
  assert.deepEqual(cloud.intent_topic, []);
  assert.deepEqual(cloud.stems, []);
  assert.deepEqual(cloud.actions, []);
  assert.deepEqual(cloud.months, []);
});

test('buildWordCloud: default cap is CLOUD_LIMIT', () => {
  const sessions = [];
  for (let i = 0; i < 200; i++) {
    sessions.push(makeSess({ session_id: 's' + i, ai_title: `Token${i} unique word` }));
  }
  const cloud = buildWordCloud({ sessions });
  assert.equal(cloud.intent.length, CLOUD_LIMIT);
  assert.ok(cloud.intent_topic.length <= CLOUD_LIMIT);
});

test('buildWordCloud: tools_top produces the same actions row as tools', () => {
  const fromMap = buildWordCloud({
    sessions: [makeSess({ tools: { read_file: { calls: 4 } } })],
  });
  const fromTop = buildWordCloud({
    sessions: [makeSess({ tools_top: [{ name: 'read_file', calls: 4 }] })],
  });
  assert.deepEqual(fromTop.actions, fromMap.actions);
  assert.equal(fromTop.actions[0].t, 'read_file');
  assert.equal(fromTop.actions[0].n, 4);
});

test('buildWordCloud: tools wins over tools_top when both are present', () => {
  const cloud = buildWordCloud({
    sessions: [makeSess({
      tools: { grep: { calls: 2 } },
      tools_top: [{ name: 'read_file', calls: 9 }],
    })],
  });
  assert.equal(cloud.actions.find(x => x.t === 'grep')?.n, 2);
  assert.equal(cloud.actions.some(x => x.t === 'read_file'), false);
});

test('WORD_SIGNAL_MIN_DF is 3 (PNG floor, not applied inside buildWordCloud)', () => {
  assert.equal(WORD_SIGNAL_MIN_DF, 3);
});

test('wordSignalItems: unit-square points from goldenPoint; empty → []', () => {
  assert.deepEqual(wordSignalItems(null), []);
  assert.deepEqual(wordSignalItems([]), []);
  const terms = [
    { t: 'project', n: 10, w: 1 },
    { t: 'card', n: 5, w: 0.5 },
    { t: 'rfc', n: 2, w: 0.2 },
  ];
  const items = wordSignalItems(terms, { cap: 28, fontMin: 9, fontMax: 11, trunc: 10 });
  assert.equal(items.length, 3);
  const c = goldenPoint(0, 3);
  assert.equal(items[0].x, c.x);
  assert.equal(items[0].y, c.y);
  assert.equal(items[0].label, 'project');
  assert.equal(items[0].fontPx, 11);
  assert.equal(items[2].fontPx, 9 + 0.2 * (11 - 9));
});

test('wordSignalItems: cap + trunc', () => {
  const terms = Array.from({ length: 40 }, (_, i) => ({ t: 'term' + i, n: 40 - i, w: 1 }));
  assert.equal(wordSignalItems(terms, { cap: 28 }).length, 28);
  const long = wordSignalItems([{ t: 'verylongtokenname', n: 1, w: 1 }], { trunc: 10 });
  assert.equal(long[0].label, 'verylongt…');
  assert.equal(long[0].t, 'verylongtokenname');
});

test('wordSignalSvg: wraps in <svg>, middle-anchors, escapes, no rx/filter', () => {
  const terms = [
    { t: 'card', n: 4, w: 1 },
    { t: 'read_file', n: 2, w: 0.5 },
    { t: '<script>', n: 1, w: 0.2 },
  ];
  const svg = wordSignalSvg(terms, {
    x: 55, y: 408, w: 283, h: 132,
    fillFor: w => (w >= 0.7 ? '#e8e000' : '#ccccaa'),
  });
  assert.ok(svg.includes('<svg'), 'wrapping svg clips the disc');
  assert.ok(svg.includes('x="55"'));
  assert.ok(svg.includes('y="408"'));
  assert.ok(svg.includes('width="283"'));
  assert.ok(svg.includes('height="132"'));
  assert.ok(svg.includes('text-anchor="middle"'));
  assert.ok(svg.includes('card'));
  assert.ok(svg.includes('read_file'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(!/<rect[^>]*rx/.test(svg));
  assert.ok(!/filter=/.test(svg));
});

test('wordSignalSvg: empty bag → dim no terms at pane centre', () => {
  const svg = wordSignalSvg([], { w: 283, h: 132, fillFor: () => '#e8e000' });
  assert.ok(svg.includes('no terms'));
  assert.ok(svg.includes('text-anchor="middle"'));
  assert.ok(svg.includes('x="141.5"'));
  assert.ok(svg.includes('y="66.0"') || svg.includes('y="66"'));
});

test('wordSignalHtml: polar CSS variables, no fillFor, empty copy matches /cloud', () => {
  const html = wordSignalHtml([{ t: 'rfc', n: 3, w: 1 }], { cap: 40, fontMin: 10, fontMax: 28 });
  assert.ok(html.includes('class="polar"'));
  assert.ok(html.includes('var(--k-data)') || html.includes('var(--k-label)'));
  assert.ok(html.includes('rfc'));
  assert.ok(!html.includes('fillFor'));
  assert.equal(wordSignalHtml([]), '<div id="empty">━━━ no terms ━━━</div>');
});

test('stripped word-cloud source has no function esc (client-core already owns esc)', async () => {
  const fs = await import('node:fs');
  const { stripExports } = await import('../build.mjs');
  const src = fs.readFileSync('experience/word-cloud.mjs', 'utf8');
  const stripped = stripExports(src);
  assert.equal(/^export function esc\b/m.test(src), false);
  assert.equal(/^function esc\b/m.test(stripped), false);
  assert.equal(/export function esc/.test(stripped), false);
  assert.ok(/function cloudEsc\b/.test(src) || /function cloudEsc\b/.test(stripped) || src.includes('cloudEsc'));
});
