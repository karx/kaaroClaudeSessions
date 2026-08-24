/**
 * test/public-index-nr.test.mjs → public/index.html normalized hop
 *
 * Guards the landing-page NR matrix against the live contract
 * (RECORD_KINDS, HARNESS_IDS, pulse-transformer cases) so the viz
 * cannot rot independently of hooks/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RECORD_KINDS, KIND_FIELDS } from '../hooks/normalized-record.mjs';
import { HARNESS_IDS } from '../hooks/registry.mjs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function seedOf() {
  const m = html.match(/<script type="application\/json" id="nr-seed">([\s\S]*?)<\/script>/);
  assert.ok(m, 'public/index.html embeds nr-seed JSON');
  return JSON.parse(m[1]);
}

test('nr-seed — parses and lists every RECORD_KIND in contract order', () => {
  const seed = seedOf();
  assert.deepEqual(seed.kinds.map(k => k.id), RECORD_KINDS);
});

test('nr-seed — harness ids match the registry', () => {
  const seed = seedOf();
  assert.deepEqual(seed.harnesses.map(h => h.id), HARNESS_IDS);
});

test('nr-seed — emit vector length matches harness count', () => {
  const seed = seedOf();
  for (const k of seed.kinds) {
    assert.equal(k.emit.length, seed.harnesses.length, k.id + ' emit length');
    for (const v of k.emit) assert.ok(v === 0 || v === 1, k.id + ' emit not 0/1');
  }
});

test('nr-seed — required fields are a subset of KIND_FIELDS', () => {
  const seed = seedOf();
  for (const k of seed.kinds) {
    const spec = KIND_FIELDS[k.id];
    const allowed = new Set([...Object.keys(spec.required), ...Object.keys(spec.optional)]);
    for (const f of [...k.required, ...k.optional]) {
      assert.ok(allowed.has(f), k.id + ' lists unknown field ' + f);
    }
    for (const f of k.required) {
      assert.ok(Object.prototype.hasOwnProperty.call(spec.required, f), k.id + ' required ' + f + ' not in contract');
    }
  }
});

test('nr-seed — dedicated pulse names match the transformer', () => {
  const seed = seedOf();
  const byId = Object.fromEntries(seed.kinds.map(k => [k.id, k.pulse]));
  assert.equal(byId.user_turn, 'human_turn');
  assert.equal(byId.tool_use, 'tool_call');
  assert.equal(byId.tokens, 'tokens');
  assert.equal(byId.context_reset, 'compact');
  assert.equal(byId.permission_mode, 'permission');
  assert.equal(byId.mode_shift, 'mode_shift');
  assert.equal(byId.attachment, 'attachment');
  assert.equal(byId.scaffold, 'scaffold');
  assert.equal(byId.api_error, 'api_error');
  assert.equal(byId.unknown_record, 'unknown');
  assert.equal(byId.tool_result, 'tool_result');
  assert.equal(byId.content_block, 'words');
});

test('nr-seed — tape kinds exist in the contract', () => {
  const seed = seedOf();
  const ids = new Set(RECORD_KINDS);
  for (const step of seed.tape) {
    assert.ok(ids.has(step.kind), 'tape kind missing: ' + step.kind);
  }
});

test('nr-seed — sample NR JSON has matching kind + harness', () => {
  const seed = seedOf();
  for (const [kind, byH] of Object.entries(seed.samples)) {
    assert.ok(RECORD_KINDS.includes(kind), 'sample for unknown kind ' + kind);
    for (const [hid, rec] of Object.entries(byH)) {
      assert.ok(HARNESS_IDS.includes(hid), 'sample harness ' + hid);
      const nr = JSON.parse(rec.nr);
      assert.equal(nr.kind, kind);
      assert.equal(nr.harness, hid);
      JSON.parse(rec.raw);
      assert.ok(typeof rec.pulse === 'string' && rec.pulse.length > 0);
    }
  }
});
