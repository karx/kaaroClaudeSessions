import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructContextTree } from '../lib/context-tree.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

function user(opts = {}) {
  return { type: 'user', timestamp: opts.ts || '2026-05-01T10:00:00Z',
    gitBranch: opts.branch || undefined, message: { content: opts.text || 'hello' } };
}

function asst(opts = {}) {
  return { type: 'assistant', timestamp: opts.ts || '2026-05-01T10:01:00Z',
    message: {
      model: opts.model || 'claude-sonnet-4-6',
      stop_reason: opts.stop_reason || 'end_turn',
      usage: { input_tokens: opts.input || 0, output_tokens: opts.output || 100,
                cache_creation_input_tokens: 0, cache_read_input_tokens: opts.cache_read || 0 },
      content: opts.content || [],
    }};
}

function tool(name, input = {}) {
  return { type: 'tool_use', name, input };
}

function compact(opts = {}) {
  return { type: 'system', subtype: 'compact_boundary',
    timestamp: opts.ts || '2026-05-01T11:00:00Z' };
}

function permMode(mode, ts) {
  return { type: 'permission-mode', permissionMode: mode, timestamp: ts };
}

function aiTitle(title) {
  return { type: 'ai-title', aiTitle: title };
}

// ── single segment (no compact boundary) ─────────────────────────────────────

test('single segment — basic structure', async t => {
  const records = [user(), asst()];
  const tree = reconstructContextTree(records);

  await t.test('returns an object with segments array', () => {
    assert.ok(Array.isArray(tree.segments));
  });

  await t.test('produces exactly one segment when no compact_boundary', () => {
    assert.equal(tree.segments.length, 1);
  });

  await t.test('segment has index 0', () => {
    assert.equal(tree.segments[0].index, 0);
  });

  await t.test('compact_trigger is null for the final segment', () => {
    assert.equal(tree.segments[0].compact_trigger, null);
  });
});

// ── turn counting ─────────────────────────────────────────────────────────────

test('turn counting per segment', async t => {
  const records = [
    user(), asst(), user(), asst(),
    compact(),
    user(), asst(),
  ];
  const tree = reconstructContextTree(records);

  await t.test('first segment has 2 user turns and 2 assistant turns', () => {
    assert.equal(tree.segments[0].user_turns,      2);
    assert.equal(tree.segments[0].assistant_turns, 2);
  });

  await t.test('second segment has 1 user turn and 1 assistant turn', () => {
    assert.equal(tree.segments[1].user_turns,      1);
    assert.equal(tree.segments[1].assistant_turns, 1);
  });
});

// ── compact boundary creates new segments ────────────────────────────────────

test('compact_boundary creates new segments', async t => {
  const records = [
    user(), asst(),
    compact({ ts: '2026-05-01T11:00:00Z' }),
    user(), asst(),
    compact({ ts: '2026-05-01T12:00:00Z' }),
    user(), asst(),
  ];
  const tree = reconstructContextTree(records);

  await t.test('three segments produced for two compact boundaries', () => {
    assert.equal(tree.segments.length, 3);
  });

  await t.test('first two segments have compact_trigger set', () => {
    assert.equal(tree.segments[0].compact_trigger, 'auto');
    assert.equal(tree.segments[1].compact_trigger, 'auto');
  });

  await t.test('last segment has compact_trigger null', () => {
    assert.equal(tree.segments[2].compact_trigger, null);
  });

  await t.test('segment indices are 0, 1, 2', () => {
    assert.equal(tree.segments[0].index, 0);
    assert.equal(tree.segments[1].index, 1);
    assert.equal(tree.segments[2].index, 2);
  });
});

// ── tool_summary per segment ──────────────────────────────────────────────────

test('tool_summary counts per segment', async t => {
  const records = [
    asst({ content: [tool('Read', { file_path: 'a.js' }), tool('Read', { file_path: 'b.js' }), tool('Bash', { command: 'git log' })] }),
    compact(),
    asst({ content: [tool('Edit', { file_path: 'c.js' })] }),
  ];
  const tree = reconstructContextTree(records);

  await t.test('segment 0 counts Read×2 and Bash×1', () => {
    assert.equal(tree.segments[0].tool_summary['Read'], 2);
    assert.equal(tree.segments[0].tool_summary['Bash'], 1);
    assert.equal(tree.segments[0].tool_summary['Edit'], undefined);
  });

  await t.test('segment 1 counts Edit×1 only', () => {
    assert.equal(tree.segments[1].tool_summary['Edit'], 1);
    assert.equal(tree.segments[1].tool_summary['Read'], undefined);
  });

  await t.test('total tool_calls matches sum of tool_summary values', () => {
    const s0 = tree.segments[0];
    const summaryTotal = Object.values(s0.tool_summary).reduce((a, b) => a + b, 0);
    assert.equal(s0.tool_calls, summaryTotal);
  });
});

// ── subagent detection ────────────────────────────────────────────────────────

test('subagent_count per segment', async t => {
  const records = [
    asst({ content: [tool('Agent', { description: 'explore' }), tool('Agent', { description: 'test' })] }),
    compact(),
    asst({ content: [tool('Read', { file_path: 'x.js' })] }),
  ];
  const tree = reconstructContextTree(records);

  await t.test('segment 0 has subagent_count 2', () => {
    assert.equal(tree.segments[0].subagent_count, 2);
  });

  await t.test('segment 1 has subagent_count 0', () => {
    assert.equal(tree.segments[1].subagent_count, 0);
  });
});

// ── branches per segment ──────────────────────────────────────────────────────

test('branches collected per segment', async t => {
  const records = [
    user({ branch: 'main' }),
    user({ branch: 'feat/x' }),
    user({ branch: 'main' }),
    compact(),
    user({ branch: 'master' }),
  ];
  const tree = reconstructContextTree(records);

  await t.test('segment 0 branches are deduplicated', () => {
    assert.deepEqual([...tree.segments[0].branches].sort(), ['feat/x', 'main']);
  });

  await t.test('segment 1 has only its own branches', () => {
    assert.deepEqual(tree.segments[1].branches, ['master']);
  });
});

// ── permission_modes per segment ──────────────────────────────────────────────

test('permission_modes collected per segment', async t => {
  const records = [
    permMode('default'),
    user(),
    permMode('plan'),
    user(),
    compact(),
    permMode('acceptEdits'),
    user(),
  ];
  const tree = reconstructContextTree(records);

  await t.test('segment 0 has default and plan modes', () => {
    assert.deepEqual([...tree.segments[0].permission_modes].sort(), ['default', 'plan']);
  });

  await t.test('segment 1 has only acceptEdits mode', () => {
    assert.deepEqual(tree.segments[1].permission_modes, ['acceptEdits']);
  });
});

// ── timestamps ────────────────────────────────────────────────────────────────

test('segment timestamps', async t => {
  const records = [
    user({ ts: '2026-05-01T10:00:00Z' }),
    asst({ ts: '2026-05-01T10:30:00Z' }),
    compact({ ts: '2026-05-01T11:00:00Z' }),
    user({ ts: '2026-05-01T12:00:00Z' }),
    asst({ ts: '2026-05-01T13:00:00Z' }),
  ];
  const tree = reconstructContextTree(records);

  await t.test('segment 0 ts_start is the first record timestamp', () => {
    assert.equal(tree.segments[0].ts_start, '2026-05-01T10:00:00Z');
  });

  await t.test('segment 0 ts_end is the last record before compact', () => {
    assert.equal(tree.segments[0].ts_end, '2026-05-01T11:00:00Z');
  });

  await t.test('segment 1 ts_start is the first record after compact', () => {
    assert.equal(tree.segments[1].ts_start, '2026-05-01T12:00:00Z');
  });
});

// ── ai_title ─────────────────────────────────────────────────────────────────

test('ai_title extraction', async t => {
  await t.test('extracted from ai-title record', () => {
    const tree = reconstructContextTree([aiTitle('My session title'), user()]);
    assert.equal(tree.ai_title, 'My session title');
  });

  await t.test('is null when no ai-title record', () => {
    const tree = reconstructContextTree([user()]);
    assert.equal(tree.ai_title, null);
  });
});

// ── empty records ─────────────────────────────────────────────────────────────

test('empty records array → empty segments', () => {
  const tree = reconstructContextTree([]);
  assert.equal(tree.segments.length, 0);
});

test('compact_boundary with no following content produces no trailing empty segment', () => {
  const records = [user(), asst(), compact()];
  const tree = reconstructContextTree(records);
  assert.equal(tree.segments.length, 1);
});

// ── token accumulation per segment ───────────────────────────────────────────

test('token output accumulates per segment', async t => {
  const records = [
    asst({ output: 100, cache_read: 50 }),
    asst({ output: 200, cache_read: 30 }),
    compact(),
    asst({ output: 80, cache_read: 20 }),
  ];
  const tree = reconstructContextTree(records);

  await t.test('segment 0 sums output tokens', () => {
    assert.equal(tree.segments[0].tokens.output, 300);
  });

  await t.test('segment 0 sums cache_read tokens', () => {
    assert.equal(tree.segments[0].tokens.cache_read, 80);
  });

  await t.test('segment 1 has independent token counts', () => {
    assert.equal(tree.segments[1].tokens.output, 80);
  });
});
