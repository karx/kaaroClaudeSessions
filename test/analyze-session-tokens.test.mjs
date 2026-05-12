import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { analyzeSession } from '../analyze.mjs';

// ── temp JSONL helpers ────────────────────────────────────────────────────────

function writeTempJsonl(records, sessionId = 'testsession') {
  const dir = join(tmpdir(), 'kaaro-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, sessionId + '.jsonl');
  writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n'), 'utf8');
  return { dir, filePath };
}

function assistantRec(usage = {}, content = [], stopReason = 'end_turn', ts = '2026-05-01T10:00:00.000Z') {
  return {
    type: 'assistant',
    timestamp: ts,
    message: {
      model: 'claude-sonnet-4-6',
      usage,
      stop_reason: stopReason,
      content,
    },
  };
}

function userRec(content = 'hello', ts = '2026-05-01T10:00:00.000Z') {
  return {
    type: 'user',
    timestamp: ts,
    message: { content },
  };
}

function toolUseBlock(name, input = {}) {
  return { type: 'tool_use', id: 't1', name, input };
}

function toolResultBlock(toolUseId, isError = false) {
  return { type: 'tool_result', tool_use_id: toolUseId, is_error: isError };
}

// ── Token accumulation ────────────────────────────────────────────────────────

test('tokens.input sums input_tokens across all assistant records', async t => {
  const records = [
    assistantRec({ input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }),
    assistantRec({ input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('sums input_tokens', () => {
      assert.equal(sess.tokens.input, 300);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tokens.cache_create sums cache_creation_input_tokens', async t => {
  const records = [
    assistantRec({ input_tokens: 0, cache_creation_input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 0 }),
    assistantRec({ input_tokens: 0, cache_creation_input_tokens: 35, cache_read_input_tokens: 0, output_tokens: 0 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('sums cache_creation_input_tokens', () => {
      assert.equal(sess.tokens.cache_create, 55);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tokens.cache_read sums cache_read_input_tokens', async t => {
  const records = [
    assistantRec({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 50, output_tokens: 0 }),
    assistantRec({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 70, output_tokens: 0 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('sums cache_read_input_tokens', () => {
      assert.equal(sess.tokens.cache_read, 120);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tokens.output sums output_tokens', async t => {
  const records = [
    assistantRec({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 80 }),
    assistantRec({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 40 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('sums output_tokens', () => {
      assert.equal(sess.tokens.output, 120);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('all four token fields accumulate correctly across 3+ assistant turns', async t => {
  const records = [
    assistantRec({ input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 50, output_tokens: 80 }),
    assistantRec({ input_tokens: 150, cache_creation_input_tokens: 10, cache_read_input_tokens: 30, output_tokens: 60 }),
    assistantRec({ input_tokens: 200, cache_creation_input_tokens: 40, cache_read_input_tokens: 70, output_tokens: 90 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('input total', ()        => assert.equal(sess.tokens.input,        450));
    await t.test('cache_create total', () => assert.equal(sess.tokens.cache_create,  70));
    await t.test('cache_read total', ()   => assert.equal(sess.tokens.cache_read,   150));
    await t.test('output total', ()       => assert.equal(sess.tokens.output,        230));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing usage field on assistant record contributes 0 to all buckets', async t => {
  const records = [
    {
      type: 'assistant',
      timestamp: '2026-05-01T10:00:00.000Z',
      message: { model: 'claude-sonnet-4-6', stop_reason: 'end_turn', content: [] },
      // no usage field
    },
    assistantRec({ input_tokens: 50, cache_creation_input_tokens: 5, cache_read_input_tokens: 10, output_tokens: 25 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('does not crash', () => assert.ok(sess));
    await t.test('input only from second record', ()        => assert.equal(sess.tokens.input,        50));
    await t.test('cache_create only from second record', () => assert.equal(sess.tokens.cache_create,  5));
    await t.test('cache_read only from second record', ()   => assert.equal(sess.tokens.cache_read,   10));
    await t.test('output only from second record', ()       => assert.equal(sess.tokens.output,        25));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tokens.total equals input + cache_create + cache_read + output', async t => {
  const records = [
    assistantRec({ input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 50, output_tokens: 80 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('total is computed correctly by enrichSession', () => {
      assert.equal(sess.tokens.total, 100 + 20 + 50 + 80);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Turn counters ─────────────────────────────────────────────────────────────

test('user_turns counts user records with a message', async t => {
  const records = [
    userRec('hello'),
    userRec('world'),
    userRec('again'),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('user_turns is 3', () => assert.equal(sess.user_turns, 3));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assistant_turns counts assistant records with a message', async t => {
  const records = [
    assistantRec({ input_tokens: 10, output_tokens: 5 }),
    assistantRec({ input_tokens: 20, output_tokens: 8 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('assistant_turns is 2', () => assert.equal(sess.assistant_turns, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mixed user and assistant sequence — both counters correct', async t => {
  const records = [
    userRec('turn 1'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }),
    userRec('turn 2'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }),
    userRec('turn 3'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('user_turns is 3',      () => assert.equal(sess.user_turns,      3));
    await t.test('assistant_turns is 3', () => assert.equal(sess.assistant_turns, 3));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('system and permission-mode records do not affect turn counters', async t => {
  const records = [
    { type: 'system', subtype: 'turn_duration', timestamp: '2026-05-01T10:00:00.000Z', durationMs: 1000 },
    { type: 'permission-mode', timestamp: '2026-05-01T10:00:00.000Z', permissionMode: 'bypassPermissions' },
    userRec('only user turn'),
    assistantRec({ input_tokens: 5, output_tokens: 2 }),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('user_turns is 1',      () => assert.equal(sess.user_turns,      1));
    await t.test('assistant_turns is 1', () => assert.equal(sess.assistant_turns, 1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Tool call counter ─────────────────────────────────────────────────────────

test('tool_calls counts individual tool_use blocks across assistant records', async t => {
  const records = [
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Read', { file_path: 'a.js' })]),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Write', { file_path: 'b.js' })]),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Bash', { command: 'node test.mjs' })]),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_calls is 3', () => assert.equal(sess.tool_calls, 3));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two tool_use blocks in one assistant record → tool_calls = 2', async t => {
  const records = [
    assistantRec(
      { input_tokens: 10, output_tokens: 5 },
      [toolUseBlock('Read', { file_path: 'a.js' }), toolUseBlock('Write', { file_path: 'b.js' })],
    ),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_calls is 2', () => assert.equal(sess.tool_calls, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tool_use blocks across two assistant records are summed', async t => {
  const records = [
    assistantRec(
      { input_tokens: 10, output_tokens: 5 },
      [toolUseBlock('Read', { file_path: 'a.js' }), toolUseBlock('Read', { file_path: 'b.js' })],
    ),
    assistantRec(
      { input_tokens: 10, output_tokens: 5 },
      [toolUseBlock('Write', { file_path: 'c.js' }), toolUseBlock('Edit', { file_path: 'd.js' }), toolUseBlock('Bash', { command: 'ls' })],
    ),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_calls is 5', () => assert.equal(sess.tool_calls, 5));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-tool blocks do not increment tool_calls', async t => {
  const records = [
    assistantRec(
      { input_tokens: 10, output_tokens: 5 },
      [
        { type: 'text', text: 'some response' },
        { type: 'thinking', thinking: 'pondering...' },
        toolUseBlock('Read', { file_path: 'x.js' }),
      ],
    ),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_calls is 1, not 3', () => assert.equal(sess.tool_calls, 1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('content_blocks map counts each block type', async t => {
  const records = [
    assistantRec(
      { input_tokens: 10, output_tokens: 5 },
      [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
        { type: 'thinking', thinking: 'hmm' },
        toolUseBlock('Read', { file_path: 'x.js' }),
      ],
    ),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('text block counted twice',    () => assert.equal(sess.content_blocks['text'],     2));
    await t.test('thinking block counted once', () => assert.equal(sess.content_blocks['thinking'], 1));
    await t.test('tool_use block counted once', () => assert.equal(sess.content_blocks['tool_use'], 1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Tool errors ───────────────────────────────────────────────────────────────

test('tool_errors increments for tool_result blocks with is_error: true', async t => {
  const records = [
    {
      type: 'user',
      timestamp: '2026-05-01T10:01:00.000Z',
      message: {
        content: [
          toolResultBlock('t1', true),
        ],
      },
    },
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_errors is 1', () => assert.equal(sess.tool_errors, 1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tool_result with is_error: false does not increment tool_errors', async t => {
  const records = [
    {
      type: 'user',
      timestamp: '2026-05-01T10:01:00.000Z',
      message: {
        content: [
          toolResultBlock('t1', false),
        ],
      },
    },
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_errors is 0', () => assert.equal(sess.tool_errors, 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tool_result with missing is_error does not increment tool_errors', async t => {
  const records = [
    {
      type: 'user',
      timestamp: '2026-05-01T10:01:00.000Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1' },
        ],
      },
    },
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_errors is 0', () => assert.equal(sess.tool_errors, 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tool_result in assistant records does not increment tool_errors', async t => {
  // Only user records are checked; assistant content blocks are iterated for tool_use,
  // not tool_result — so even if an assistant record had a tool_result it would be ignored.
  const records = [
    {
      type: 'assistant',
      timestamp: '2026-05-01T10:00:00.000Z',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
        content: [
          { type: 'tool_result', tool_use_id: 't1', is_error: true },
        ],
      },
    },
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_errors is 0 — only user records count', () => assert.equal(sess.tool_errors, 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('multiple tool_result errors in one user record each counted separately', async t => {
  const records = [
    {
      type: 'user',
      timestamp: '2026-05-01T10:01:00.000Z',
      message: {
        content: [
          toolResultBlock('t1', true),
          toolResultBlock('t2', true),
          toolResultBlock('t3', true),
        ],
      },
    },
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_errors is 3', () => assert.equal(sess.tool_errors, 3));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── stop_reasons map ──────────────────────────────────────────────────────────

test('stop_reasons tracks end_turn count', async t => {
  const records = [
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [], 'end_turn'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [], 'end_turn'),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('stop_reasons.end_turn is 2', () => assert.equal(sess.stop_reasons['end_turn'], 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop_reasons tracks tool_use count', async t => {
  const records = [
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Read', { file_path: 'a.js' })], 'tool_use'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Write', { file_path: 'b.js' })], 'tool_use'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Bash', { command: 'ls' })], 'tool_use'),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('stop_reasons.tool_use is 3', () => assert.equal(sess.stop_reasons['tool_use'], 3));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('multiple assistant records with different stop reasons each tracked in map', async t => {
  const records = [
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [], 'end_turn'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Read', { file_path: 'x.js' })], 'tool_use'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [], 'max_tokens'),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('end_turn count is 1',    () => assert.equal(sess.stop_reasons['end_turn'],  1));
    await t.test('tool_use count is 1',    () => assert.equal(sess.stop_reasons['tool_use'],  1));
    await t.test('max_tokens count is 1',  () => assert.equal(sess.stop_reasons['max_tokens'], 1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('same stop reason across multiple records accumulates', async t => {
  const records = [
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [], 'end_turn'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [], 'end_turn'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [], 'end_turn'),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('end_turn count is 3', () => assert.equal(sess.stop_reasons['end_turn'], 3));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── tools map ─────────────────────────────────────────────────────────────────

test('tools map has correct calls count for Read', async t => {
  const records = [
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Read', { file_path: 'a.js' })], 'tool_use'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Read', { file_path: 'b.js' })], 'tool_use'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Read', { file_path: 'c.js' })], 'tool_use'),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tools.Read.calls is 3', () => {
      assert.ok(sess.tools['Read'], 'Read entry should exist');
      assert.equal(sess.tools['Read'].calls, 3);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('different tool names create separate entries in tools map', async t => {
  const records = [
    assistantRec(
      { input_tokens: 10, output_tokens: 5 },
      [
        toolUseBlock('Read',  { file_path: 'a.js' }),
        toolUseBlock('Write', { file_path: 'b.js' }),
        toolUseBlock('Bash',  { command: 'ls' }),
      ],
      'tool_use',
    ),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('Read entry exists',     () => assert.ok(sess.tools['Read']));
    await t.test('Write entry exists',    () => assert.ok(sess.tools['Write']));
    await t.test('Bash entry exists',     () => assert.ok(sess.tools['Bash']));
    await t.test('Read.calls is 1',       () => assert.equal(sess.tools['Read'].calls,  1));
    await t.test('Write.calls is 1',      () => assert.equal(sess.tools['Write'].calls, 1));
    await t.test('Bash.calls is 1',       () => assert.equal(sess.tools['Bash'].calls,  1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('same tool across multiple assistant records — calls accumulate', async t => {
  const records = [
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Grep', { pattern: 'foo' })], 'tool_use'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Grep', { pattern: 'bar' })], 'tool_use'),
    assistantRec({ input_tokens: 10, output_tokens: 5 }, [toolUseBlock('Grep', { pattern: 'baz' })], 'tool_use'),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('Grep.calls is 3', () => {
      assert.ok(sess.tools['Grep'], 'Grep entry should exist');
      assert.equal(sess.tools['Grep'].calls, 3);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tool_diversity equals number of distinct tool names used', async t => {
  const records = [
    assistantRec(
      { input_tokens: 10, output_tokens: 5 },
      [
        toolUseBlock('Read',  { file_path: 'a.js' }),
        toolUseBlock('Read',  { file_path: 'b.js' }),
        toolUseBlock('Write', { file_path: 'c.js' }),
        toolUseBlock('Bash',  { command: 'ls' }),
        toolUseBlock('Grep',  { pattern: 'foo' }),
      ],
      'tool_use',
    ),
  ];
  const { dir, filePath } = writeTempJsonl(records);
  try {
    const sess = analyzeSession('proj-test', filePath);
    await t.test('tool_diversity is 4 — Read, Write, Bash, Grep', () => {
      assert.equal(sess.tool_diversity, 4);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
