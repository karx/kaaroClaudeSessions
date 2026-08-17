import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichSession, enrichProject, tokensWork, computeToolMix } from '../hooks/enrich-session.mjs';
import { isBashToolName } from '../hooks/action-keys.mjs';

function baseSession(overrides = {}) {
  return {
    tokens: { input: 100, output: 50, cache_create: 20, cache_read: 80 },
    tools: { Read: { calls: 2, errors: 0 }, Write: { calls: 1, errors: 0 } },
    duration_ms: 120000,
    first_timestamp: '2026-05-01T14:30:00.000Z',
    ...overrides,
  };
}

test('enrichSession — computes token totals and cache_hit_rate', () => {
  const s = baseSession();
  enrichSession(s);
  assert.equal(s.tokens.total, 250);
  assert.equal(s.cache_hit_rate, 40);
  assert.equal(s.tool_diversity, 2);
  assert.equal(s.duration_min, 2);
  assert.equal(s.date_str, '2026-05-01');
  assert.equal(typeof s.day_of_week, 'number');
  assert.equal(typeof s.hour_of_day, 'number');
});

test('enrichSession — cache_hit_rate zero when no input side', () => {
  const s = baseSession({ tokens: { input: 0, output: 0, cache_create: 0, cache_read: 0 } });
  enrichSession(s);
  assert.equal(s.cache_hit_rate, 0);
});

test('enrichSession — duration_min null when duration_ms absent', () => {
  const s = baseSession({ duration_ms: null });
  enrichSession(s);
  assert.equal(s.duration_min, null);
});

// ── tokens_work: single source of truth ───────────────────────────────────────

test('tokensWork — output + cache_create, missing fields default to 0', () => {
  assert.equal(tokensWork({ output: 80, cache_create: 20 }), 100);
  assert.equal(tokensWork({ output: 5 }), 5);
  assert.equal(tokensWork({}), 0);
  assert.equal(tokensWork(undefined), 0);
});

test('enrichSession — sets tokens_work from tokens', () => {
  const s = baseSession(); // output 50 + cache_create 20
  enrichSession(s);
  assert.equal(s.tokens_work, 70);
});

test('enrichProject — sets tokens_work and tokens_total on a project summary', () => {
  const p = { id: 'proj-a', tokens: { input: 100, output: 200, cache_create: 50, cache_read: 30 } };
  enrichProject(p);
  assert.equal(p.tokens_work, 250);
  assert.equal(p.tokens_total, 380);
});

// ── tool_mix: canonical cross-harness tool-category ratios ───────────────────

test('isBashToolName — recognizes all bash-family raw names, case-insensitive', () => {
  assert.equal(isBashToolName('Bash'), true);
  assert.equal(isBashToolName('PowerShell'), true);
  assert.equal(isBashToolName('shell'), true);
  assert.equal(isBashToolName('run_command'), true);
  assert.equal(isBashToolName('RunInTerminal'), true);
  assert.equal(isBashToolName('run_in_terminal'), true);
  assert.equal(isBashToolName('run_terminal_command'), true); // real Grok tool name
  assert.equal(isBashToolName('Read'), false);
  assert.equal(isBashToolName(''), false);
  assert.equal(isBashToolName(null), false);
});

test('computeToolMix — canonicalizes raw tool names across harness vocabularies', () => {
  const s = baseSession({
    tools: {
      Read: { calls: 2, errors: 0 },
      view_file: { calls: 3, errors: 0 },      // antigravity name → also 'read'
      Write: { calls: 1, errors: 0 },
      Bash: { calls: 5, errors: 0 },            // excluded — bash comes from bash_categories
    },
    bash_categories: { git: 2, run: 3, other: 0 },
  });
  const mix = computeToolMix(s);
  assert.deepEqual(mix, {
    read: 5, write: 1, edit: 0, grep_glob: 0, agent: 0, web: 0, other: 0,
    bash_git: 2, bash_run: 3, bash_other: 0,
  });
});

test('computeToolMix — bash counts come from bash_categories, not re-derived from tools', () => {
  const s = baseSession({
    tools: { Bash: { calls: 99, errors: 0 } }, // would corrupt result if not excluded
    bash_categories: { git: 1, run: 0, other: 0 },
  });
  const mix = computeToolMix(s);
  assert.equal(mix.bash_git, 1);
  assert.equal(mix.bash_run, 0);
  assert.equal(mix.bash_other, 0);
  assert.equal(mix.other, 0);
});

test('computeToolMix — missing bash_categories defaults all bash keys to 0', () => {
  const s = baseSession({ tools: { Read: { calls: 1, errors: 0 } } });
  delete s.bash_categories;
  const mix = computeToolMix(s);
  assert.equal(mix.bash_git, 0);
  assert.equal(mix.bash_run, 0);
  assert.equal(mix.bash_other, 0);
});

test('enrichSession — sets tool_mix', () => {
  const s = baseSession({
    tools: { Read: { calls: 2, errors: 0 }, Write: { calls: 1, errors: 0 } },
  });
  enrichSession(s);
  assert.deepEqual(s.tool_mix, {
    read: 2, write: 1, edit: 0, grep_glob: 0, agent: 0, web: 0, other: 0,
    bash_git: 0, bash_run: 0, bash_other: 0,
  });
});