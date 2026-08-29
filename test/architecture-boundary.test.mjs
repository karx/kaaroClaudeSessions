/**
 * test/architecture-boundary.test.mjs — the two-layer boundary guard.
 *
 * CLAUDE.md and EXECUTION.md both state the rule: the cognitive experience
 * layer (experience/) consumes the Observability Surface (HTTP + SSE) only —
 * it must never import harness-normalization internals from hooks/.
 *
 * One documented exception: experience/audio/{audio-sim,event-registry}.mjs
 * are Node-only build/dev tooling (feeding scripts/sim-audio.mjs,
 * scripts/dump-pulses.mjs, and build.mjs's EVENT_TYPES extraction) — never
 * concatenated into a browser bundle — so they're allowed to read hooks/
 * directly rather than round-tripping through HTTP.
 *
 * hooks/analyzers/*.mjs used to import surface/analyze-orchestrator.mjs,
 * which imported back from root analyze.mjs — a hooks->surface->root
 * circular import (TODO.md #7, resolved 2026-08-29: the assembly logic
 * moved to hooks/session-output.mjs, retiring surface/analyze-orchestrator.mjs
 * to ARCHIVE/). No allowlist needed for hooks/ any more — this guard is
 * back to zero tolerance in that direction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_HOOKS_IMPORTERS = new Set([
  path.join('experience', 'audio', 'audio-sim.mjs'),
  path.join('experience', 'audio', 'event-registry.mjs'),
]);

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some(ext => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

test('experience/ does not import hooks/ (outside the documented Node-tooling exception)', () => {
  const files = walk('experience', ['.mjs', '.js']);
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const importsHooks = /from\s+['"][^'"]*\/hooks\//.test(src) || /require\(\s*['"][^'"]*\/hooks\//.test(src);
    if (importsHooks && !ALLOWED_HOOKS_IMPORTERS.has(file)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `experience/ files importing hooks/ directly: ${offenders.join(', ')}`);
});

test('the allowlist itself still imports hooks/ (fails loud if the exception goes stale)', () => {
  for (const file of ALLOWED_HOOKS_IMPORTERS) {
    assert.ok(fs.existsSync(file), `${file} no longer exists — remove it from the allowlist`);
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(/\/hooks\//.test(src), `${file} no longer imports hooks/ — remove it from the allowlist`);
  }
});

test('surface/ does not import experience/ (surface stays UI-agnostic)', () => {
  const files = walk('surface', ['.mjs']);
  const offenders = files.filter(file => /from\s+['"][^'"]*\/experience\//.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, [], `surface/ files importing experience/: ${offenders.join(', ')}`);
});

test('hooks/ does not import surface/ or experience/ (hooks stays the innermost layer)', () => {
  const files = walk('hooks', ['.mjs']);
  const offenders = files.filter(file => {
    const src = fs.readFileSync(file, 'utf8');
    return /from\s+['"][^'"]*\/(surface|experience)\//.test(src);
  });
  assert.deepEqual(offenders, [], `hooks/ files importing surface/ or experience/: ${offenders.join(', ')}`);
});
