/**
 * test/adapters/nr-compliance.test.mjs
 *
 * The permanent adapter-contract guard: every NormalizedRecord emitted by
 * every adapter must satisfy validateNormalizedRecord (hooks/normalized-record.mjs).
 *
 * Two sweeps:
 *  1. Event Registry sample traces (hooks/event-types.mjs samples) — the
 *     canonical per-event fixtures.
 *  2. A golden multi-record session per harness — covers envelope kinds
 *     (session_meta, branch_change, unknown_record) the samples may miss.
 *
 * When a harness's storage format changes, fix its adapter until this file
 * is green again — no other layer should need edits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateNormalizedRecord } from '../../hooks/normalized-record.mjs';
import { EVENT_TYPES } from '../../experience/audio/event-registry.mjs';
import { recordsToNormalized as ccToNorm }   from '../../hooks/adapters/claude-code.mjs';
import { recordsToNormalized as codexToNorm } from '../../hooks/adapters/codex.mjs';
import { recordsToNormalized as piToNorm }   from '../../hooks/adapters/pi.mjs';
import { recordsToNormalized as agToNorm }   from '../../hooks/adapters/antigravity.mjs';
import { recordsToNormalized as grokToNorm } from '../../hooks/adapters/grok.mjs';
import { recordsToNormalized as ocToNorm }   from '../../hooks/adapters/opencode.mjs';
import { recordsToNormalized as cpToNorm }   from '../../hooks/adapters/copilot.mjs';
import { recordsToNormalized as cmdToNorm }  from '../../hooks/adapters/command-code.mjs';
import { GOLDEN_SESSIONS } from '../../hooks/adapters/golden-sessions.mjs';

const ADAPTERS = {
  'claude-code': ccToNorm,
  'codex':       codexToNorm,
  'pi':          piToNorm,
  'antigravity': agToNorm,
  'grok':        grokToNorm,
  'opencode':    ocToNorm,
  'copilot':     cpToNorm,
  'command-code': cmdToNorm,
};

function assertAllValid(nrs, label) {
  assert.ok(nrs.length > 0, `${label}: adapter emitted no records`);
  for (const nr of nrs) {
    const { ok, errors } = validateNormalizedRecord(nr);
    assert.ok(ok, `${label}: invalid NR ${JSON.stringify(nr)} — ${errors.join('; ')}`);
  }
}

// ── Sweep 1: Event Registry sample traces ─────────────────────────────────────

for (const [eventKey, entry] of Object.entries(EVENT_TYPES)) {
  if (!entry.samples) continue;
  for (const [harness, sample] of Object.entries(entry.samples)) {
    const adapterFn = ADAPTERS[harness];
    if (!adapterFn) continue;
    test(`nr-compliance — sample ${eventKey}/${harness}`, () => {
      assertAllValid(adapterFn([sample.record]), `${eventKey}/${harness}`);
    });
  }
}

// ── Sweep 2: golden sessions per harness (hooks/adapters/golden-sessions.mjs)

const GOLDEN = GOLDEN_SESSIONS;

for (const [harness, records] of Object.entries(GOLDEN)) {
  test(`nr-compliance — golden session (${harness})`, () => {
    assertAllValid(ADAPTERS[harness](records), `golden/${harness}`);
  });
}
