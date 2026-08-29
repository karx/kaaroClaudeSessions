import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySubstitutions } from '../build.mjs';

// ── applySubstitutions ────────────────────────────────────────────────────────

test('applySubstitutions — basic', async t => {
  await t.test('replaces a single placeholder', () => {
    assert.equal(
      applySubstitutions('hello %%NAME%%', { '%%NAME%%': 'world' }),
      'hello world',
    );
  });

  await t.test('replaces multiple distinct placeholders in one pass', () => {
    assert.equal(
      applySubstitutions('%%A%% + %%B%%', { '%%A%%': '1', '%%B%%': '2' }),
      '1 + 2',
    );
  });

  await t.test('replaces the same placeholder appearing more than once', () => {
    assert.equal(
      applySubstitutions('%%X%% %%X%%', { '%%X%%': 'hi' }),
      'hi hi',
    );
  });

  await t.test('preserves an unknown placeholder unchanged', () => {
    assert.equal(
      applySubstitutions('%%KNOWN%% %%UNKNOWN%%', { '%%KNOWN%%': 'ok' }),
      'ok %%UNKNOWN%%',
    );
  });

  await t.test('returns the template unchanged when subs map is empty', () => {
    const tmpl = 'no placeholders here';
    assert.equal(applySubstitutions(tmpl, {}), tmpl);
  });

  await t.test('handles empty template', () => {
    assert.equal(applySubstitutions('', { '%%FOO%%': 'bar' }), '');
  });
});

// ── poison-data: the core regression guard ────────────────────────────────────
// If injected data happens to contain a placeholder literal, a chained
// .replace() chain would corrupt it.  applySubstitutions must not re-scan
// replacement values.

test('applySubstitutions — poison data does not corrupt output', async t => {
  await t.test('value containing a sibling placeholder literal is not re-substituted', () => {
    const subs = {
      '%%GRAPH_JSON%%':    '{"msg":"%%TIMELINE_JSON%%"}',
      '%%TIMELINE_JSON%%': '[1,2,3]',
    };
    const template = 'var g=%%GRAPH_JSON%%; var t=%%TIMELINE_JSON%%;';
    const result = applySubstitutions(template, subs);
    // %%TIMELINE_JSON%% inside the first value must survive verbatim
    assert.equal(result, 'var g={"msg":"%%TIMELINE_JSON%%"}; var t=[1,2,3];');
  });

  await t.test('value containing the same placeholder is not recursively expanded', () => {
    const subs = { '%%FOO%%': 'prefix-%%FOO%%-suffix' };
    const result = applySubstitutions('%%FOO%%', subs);
    assert.equal(result, 'prefix-%%FOO%%-suffix');
  });

  await t.test('JSON value with special $ chars is treated as literal, not backreference', () => {
    // String.replace(regex, string) interprets $& as "the match"; using a function
    // replacement avoids this.  A session message could contain '$&' or '$1'.
    const subs = { '%%DATA%%': '{"key":"$& price $1"}' };
    const result = applySubstitutions('var d=%%DATA%%;', subs);
    assert.equal(result, 'var d={"key":"$& price $1"};');
  });
});

// ── client-core injection (E1) ────────────────────────────────────────────────

test('stripExports — removes export prefixes at line starts only', async () => {
  const { stripExports } = await import('../build.mjs');
  const src = [
    'export function fmtTok(n) { return n; }',
    'export const X = 1;',
    'const s = "export function inside a string";',
    '  // export const indented comment stays',
  ].join('\n');
  const out = stripExports(src);
  assert.ok(out.includes('\nconst X = 1;') || out.startsWith('function fmtTok'));
  assert.ok(!/^export /m.test(out), 'no top-level export remains');
  assert.ok(out.includes('"export function inside a string"'), 'strings untouched');
});

test('stripExports — also strips `export async function` (must yield valid plain script, not a bare "export")', async () => {
  const { stripExports } = await import('../build.mjs');
  const out = stripExports('export async function svgToPNG(s) { return s; }');
  assert.equal(out, 'async function svgToPNG(s) { return s; }');
  assert.ok(!/^export /m.test(out), 'no top-level export remains');
});

test('client core placeholder exists and is injected by the bundle assembly', async () => {
  const fs = await import('node:fs');
  const core = fs.readFileSync('experience/client/00-core.js', 'utf8');
  assert.ok(core.includes('%%CLIENT_CORE%%'));
});

// ── Register A token injection (E2) ───────────────────────────────────────────

test('all page templates carry the %%TOKENS_CSS%% marker', async () => {
  const fs = await import('node:fs');
  for (const p of ['experience/pages/template.html', 'experience/pages/daw-template.html', 'experience/pages/now.html', 'experience/pages/home.html']) {
    assert.ok(fs.readFileSync(p, 'utf8').includes('%%TOKENS_CSS%%'), `${p} missing marker`);
  }
});

test('00-core carries the %%KAARO_TOKENS%% marker for canvas JS', async () => {
  const fs = await import('node:fs');
  assert.ok(fs.readFileSync('experience/client/00-core.js', 'utf8').includes('%%KAARO_TOKENS%%'));
});

test('home.html binds KAARO_TOKENS for landing canvas JS', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync('experience/pages/home.html', 'utf8');
  assert.ok(html.includes('%%KAARO_TOKENS%%'), 'landing must inject the JS token object');
  assert.ok(/const KAARO_TOKENS\s*=\s*%%KAARO_TOKENS%%/.test(html));
});

// ── Stray placeholder guard ────────────────────────────────────────────────────
// build.mjs concatenates experience/client/*.js and runs it through the SAME
// single-pass %%PLACEHOLDER%% substitution as the HTML template (see the
// injectedJS = applySubstitutions(clientJS, {...}) call for graph.html). A
// %%WORD%% written anywhere in a client/*.js file — even inside a comment,
// even just documenting the mechanism — is not inert: it gets replaced too,
// splicing a full extra copy of whatever that key maps to (e.g. all of
// client-core.mjs) into the middle of the line. Any %%WORD%% token in
// client/*.js must be one of the keys build.mjs actually substitutes there.

test('experience/client/*.js only uses %%PLACEHOLDER%% tokens build.mjs actually substitutes', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  // Keys passed to applySubstitutions(clientJS, {...}) for the graph bundle,
  // plus tokenSubs() (%%TOKENS_CSS%%, %%KAARO_TOKENS%%) — build.mjs is the
  // source of truth; update this set if that call's key list changes.
  const KNOWN = new Set([
    '%%CLIENT_CORE%%', '%%GRAPH_JSON%%', '%%TIMELINE_JSON%%', '%%COLOR_INDEX_JSON%%',
    '%%IN_FLIGHT_COLOR%%', '%%TRACE_HARNESSES%%', '%%TOKENS_CSS%%', '%%KAARO_TOKENS%%',
  ]);
  const dir = 'experience/client';
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/%%[A-Z_]+%%/g)) {
      if (!KNOWN.has(m[0])) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `stray placeholder-shaped text (will be spliced by build.mjs): ${offenders.join(', ')}`);
});
