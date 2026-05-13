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
