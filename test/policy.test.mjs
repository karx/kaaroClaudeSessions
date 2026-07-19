/**
 * test/policy.test.mjs → hooks/policy.mjs (W-POL-01)
 *
 * Policy file loader + merge semantics. Project `.agents/policy.json`
 * prepends global `~/.agents/policy.json`. Absent/malformed → warn + null;
 * loading never throws.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPolicyFile, mergePolicies, loadPolicy } from '../hooks/policy.mjs';

let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaaro-policy-'));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeJson(rel, obj) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  return p;
}

const RULE_A = { id: 'no-bash-in-viz', match: { skill: 'visualize-seed', tool: 'Bash' }, signal: 'WARN', reason: 'no bash' };
const RULE_B = { id: 'slow-session', match: { 'duration_min.gt': 60 }, signal: 'INFO', reason: 'long session' };

// ── loadPolicyFile ────────────────────────────────────────────────────────────

test('loadPolicyFile — parses a valid policy file', () => {
  const p = writeJson('valid/policy.json', { version: '1', default: 'allow', rules: [RULE_A] });
  const policy = loadPolicyFile(p);
  assert.equal(policy.version, '1');
  assert.equal(policy.rules.length, 1);
  assert.equal(policy.rules[0].id, 'no-bash-in-viz');
});

test('loadPolicyFile — absent file → null, no throw', () => {
  assert.equal(loadPolicyFile(path.join(root, 'nope', 'policy.json')), null);
});

test('loadPolicyFile — tolerates a UTF-8 BOM (Windows editors/PowerShell)', () => {
  const p = path.join(root, 'bom', 'policy.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '﻿' + JSON.stringify({ version: '1', rules: [RULE_A] }), 'utf8');
  const policy = loadPolicyFile(p);
  assert.ok(policy, 'BOM-prefixed policy must load');
  assert.equal(policy.rules[0].id, 'no-bash-in-viz');
});

test('loadPolicyFile — malformed JSON → null, no throw', () => {
  const p = writeJson('bad/policy.json', '{ not json !!');
  assert.equal(loadPolicyFile(p), null);
});

test('loadPolicyFile — rules not an array → null (invalid shape)', () => {
  const p = writeJson('shape/policy.json', { version: '1', rules: { a: 1 } });
  assert.equal(loadPolicyFile(p), null);
});

// ── mergePolicies ─────────────────────────────────────────────────────────────

test('mergePolicies — project rules prepend global rules', () => {
  const merged = mergePolicies(
    { version: '1', rules: [RULE_A] },
    { version: '1', rules: [RULE_B] },
  );
  assert.deepEqual(merged.rules.map(r => r.id), ['no-bash-in-viz', 'slow-session']);
});

test('mergePolicies — either side null passes the other through', () => {
  const proj = { version: '1', rules: [RULE_A] };
  assert.deepEqual(mergePolicies(proj, null).rules.map(r => r.id), ['no-bash-in-viz']);
  assert.deepEqual(mergePolicies(null, proj).rules.map(r => r.id), ['no-bash-in-viz']);
  assert.equal(mergePolicies(null, null), null);
});

test('mergePolicies — project builtin_anomalies keys override global', () => {
  const merged = mergePolicies(
    { version: '1', rules: [], builtin_anomalies: { high_error_rate: { threshold: 0.5, signal: 'ALERT' } } },
    { version: '1', rules: [], builtin_anomalies: { high_error_rate: { threshold: 0.3, signal: 'WARN' }, repeated_compaction: { threshold: 2, signal: 'WARN' } } },
  );
  assert.equal(merged.builtin_anomalies.high_error_rate.threshold, 0.5);
  assert.equal(merged.builtin_anomalies.high_error_rate.signal, 'ALERT');
  assert.equal(merged.builtin_anomalies.repeated_compaction.threshold, 2);
});

// ── loadPolicy (project + global composition) ─────────────────────────────────

test('loadPolicy — merges <projectDir>/.agents/policy.json with <homeDir>/.agents/policy.json', () => {
  const projectDir = path.join(root, 'proj');
  const homeDir    = path.join(root, 'home');
  writeJson('proj/.agents/policy.json', { version: '1', rules: [RULE_A] });
  writeJson('home/.agents/policy.json', { version: '1', rules: [RULE_B] });
  const policy = loadPolicy({ projectDir, homeDir });
  assert.deepEqual(policy.rules.map(r => r.id), ['no-bash-in-viz', 'slow-session']);
});

test('loadPolicy — both absent → null', () => {
  assert.equal(loadPolicy({ projectDir: path.join(root, 'x'), homeDir: path.join(root, 'y') }), null);
});
