import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { analyzeSession } from '../analyze.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

function writeTempJsonl(records, sessionId = 'testsession') {
  const dir = join(tmpdir(), 'kaaro-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, sessionId + '.jsonl');
  writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n'), 'utf8');
  return { dir, filePath };
}

function assistantRec(opts = {}) {
  return {
    type: 'assistant',
    timestamp: opts.timestamp || '2026-05-01T10:00:00.000Z',
    message: {
      model:      opts.model || 'claude-sonnet-4-6',
      stop_reason: opts.stop_reason || 'end_turn',
      usage: {
        input_tokens:                opts.input        || 0,
        cache_creation_input_tokens: opts.cache_create || 0,
        cache_read_input_tokens:     opts.cache_read   || 0,
        output_tokens:               opts.output       || 0,
      },
      content: opts.content || [],
    },
  };
}

function userRec(opts = {}) {
  return {
    type:      'user',
    timestamp: opts.timestamp || '2026-05-01T10:00:00.000Z',
    version:   opts.version   || undefined,
    entrypoint: opts.entrypoint || undefined,
    gitBranch: opts.gitBranch  || undefined,
    cwd:       opts.cwd        || undefined,
    message: { content: opts.content || 'hello world' },
  };
}

function turnDurationRec(opts = {}) {
  return {
    type:         'system',
    subtype:      'turn_duration',
    durationMs:   opts.durationMs   !== undefined ? opts.durationMs   : null,
    messageCount: opts.messageCount !== undefined ? opts.messageCount : null,
    slug:         opts.slug         || undefined,
    version:      opts.version      || undefined,
    entrypoint:   opts.entrypoint   || undefined,
    gitBranch:    opts.gitBranch    || undefined,
    cwd:          opts.cwd          || undefined,
  };
}

// ── Session identity ──────────────────────────────────────────────────────────

test('session identity', async t => {
  const { dir, filePath } = writeTempJsonl([userRec()], 'mySession123');
  try {
    const session = analyzeSession('D--src-foo', filePath);

    await t.test('session_id equals the basename without .jsonl', () => {
      assert.equal(session.session_id, 'mySession123');
    });

    await t.test('project_id equals the argument passed in', () => {
      assert.equal(session.project_id, 'D--src-foo');
    });

    await t.test('project_label is derived from project_id', () => {
      assert.equal(session.project_label, 'foo');
    });

    await t.test('file_size_bytes is a positive number matching file content', () => {
      assert.ok(typeof session.file_size_bytes === 'number' && session.file_size_bytes > 0);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Slug ──────────────────────────────────────────────────────────────────────

test('slug', async t => {
  await t.test('slug comes from turn_duration record', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ slug: 'my-slug', durationMs: 1000, messageCount: 2 }),
    ], 'abcdefghij');
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.slug, 'my-slug');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('slug falls back to first 8 chars of session_id when no turn_duration', async () => {
    const { dir, filePath } = writeTempJsonl([userRec()], 'abcdefghij');
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.slug, 'abcdefgh');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── git_branch ────────────────────────────────────────────────────────────────

test('git_branch', async t => {
  await t.test('set from turn_duration.gitBranch', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ gitBranch: 'main', durationMs: 0, messageCount: 0 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.git_branch, 'main');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('set from user.gitBranch when no turn_duration', async () => {
    const { dir, filePath } = writeTempJsonl([
      userRec({ gitBranch: 'feat/x' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.git_branch, 'feat/x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('turn_duration wins over later user record (first-wins)', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ gitBranch: 'from-td', durationMs: 0, messageCount: 0 }),
      userRec({ gitBranch: 'from-user' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.git_branch, 'from-td');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── duration_ms and message_count ─────────────────────────────────────────────

test('duration_ms and message_count', async t => {
  await t.test('duration_ms comes from turn_duration.durationMs', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ durationMs: 60000, messageCount: 5 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.duration_ms, 60000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('message_count comes from turn_duration.messageCount', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ durationMs: 1000, messageCount: 7 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.message_count, 7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('duration_ms is null when no turn_duration record', async () => {
    const { dir, filePath } = writeTempJsonl([userRec()]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.duration_ms, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── cwd and version ───────────────────────────────────────────────────────────

test('cwd and version — first-wins', async t => {
  await t.test('cwd from turn_duration wins over user record', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ cwd: '/from-td', durationMs: 0, messageCount: 0 }),
      userRec({ cwd: '/from-user' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.cwd, '/from-td');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('cwd falls back to user record when no turn_duration', async () => {
    const { dir, filePath } = writeTempJsonl([
      userRec({ cwd: '/from-user' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.cwd, '/from-user');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('version from turn_duration wins over user record', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ version: '1.0.0', durationMs: 0, messageCount: 0 }),
      userRec({ version: '2.0.0' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.version, '1.0.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('version falls back to user record when no turn_duration', async () => {
    const { dir, filePath } = writeTempJsonl([
      userRec({ version: '2.5.1' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.version, '2.5.1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── model ─────────────────────────────────────────────────────────────────────

test('model', async t => {
  await t.test('model comes from the first assistant record', async () => {
    const { dir, filePath } = writeTempJsonl([
      assistantRec({ model: 'claude-sonnet-4-6' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.model, 'claude-sonnet-4-6');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('model is the first assistant record model even when a later one differs', async () => {
    const { dir, filePath } = writeTempJsonl([
      assistantRec({ model: 'claude-opus-4', timestamp: '2026-05-01T10:00:00.000Z' }),
      assistantRec({ model: 'claude-haiku-4', timestamp: '2026-05-01T10:01:00.000Z' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.model, 'claude-opus-4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('model is null when no assistant records', async () => {
    const { dir, filePath } = writeTempJsonl([userRec()]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.model, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── permission_mode ───────────────────────────────────────────────────────────

test('permission_mode', async t => {
  await t.test('permission_mode set from permissionMode field', async () => {
    const { dir, filePath } = writeTempJsonl([
      { type: 'permission-mode', permissionMode: 'acceptEdits' },
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.permission_mode, 'acceptEdits');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('permission_mode is null when record absent', async () => {
    const { dir, filePath } = writeTempJsonl([userRec()]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.permission_mode, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Timestamps ────────────────────────────────────────────────────────────────

test('timestamps', async t => {
  await t.test('first_timestamp is the earliest timestamp across record types', async () => {
    const { dir, filePath } = writeTempJsonl([
      assistantRec({ timestamp: '2026-05-01T10:05:00.000Z' }),
      userRec({ timestamp: '2026-05-01T10:00:00.000Z' }),
      { type: 'permission-mode', permissionMode: 'default', timestamp: '2026-05-01T10:02:00.000Z' },
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.first_timestamp, '2026-05-01T10:00:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('last_timestamp is the latest timestamp across record types', async () => {
    const { dir, filePath } = writeTempJsonl([
      userRec({ timestamp: '2026-05-01T10:00:00.000Z' }),
      assistantRec({ timestamp: '2026-05-01T11:30:00.000Z' }),
      userRec({ timestamp: '2026-05-01T09:59:00.000Z' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.last_timestamp, '2026-05-01T11:30:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('single record: first and last timestamps are the same', async () => {
    const { dir, filePath } = writeTempJsonl([
      userRec({ timestamp: '2026-04-15T08:00:00.000Z' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.first_timestamp, '2026-04-15T08:00:00.000Z');
      assert.equal(session.last_timestamp,  '2026-04-15T08:00:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('records without timestamp do not affect tracking', async () => {
    const { dir, filePath } = writeTempJsonl([
      { type: 'permission-mode', permissionMode: 'default' },
      userRec({ timestamp: '2026-05-10T12:00:00.000Z' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.first_timestamp, '2026-05-10T12:00:00.000Z');
      assert.equal(session.last_timestamp,  '2026-05-10T12:00:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── enrichSession derived fields ──────────────────────────────────────────────

test('enrichSession — tokens.total', async t => {
  await t.test('total = input + cache_create + cache_read + output', async () => {
    const { dir, filePath } = writeTempJsonl([
      assistantRec({ input: 100, cache_create: 20, cache_read: 50, output: 80 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.tokens.total, 250);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('total is 0 when no assistant records', async () => {
    const { dir, filePath } = writeTempJsonl([userRec()]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.tokens.total, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('enrichSession — cache_hit_rate', async t => {
  await t.test('cache_hit_rate formula: cache_read / (input + cache_create + cache_read) * 100', async () => {
    // cache_read=50, input=100, cache_create=20, cache_read=50 → 50/170 * 100 = 29.4
    const { dir, filePath } = writeTempJsonl([
      assistantRec({ input: 100, cache_create: 20, cache_read: 50, output: 80 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.cache_hit_rate, +(50 / 170 * 100).toFixed(1));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('cache_hit_rate is 0 when all token counts are zero', async () => {
    const { dir, filePath } = writeTempJsonl([userRec()]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.cache_hit_rate, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('cache_hit_rate is 100 when all input-side tokens are cache_read', async () => {
    const { dir, filePath } = writeTempJsonl([
      assistantRec({ input: 0, cache_create: 0, cache_read: 200, output: 50 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.cache_hit_rate, 100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('enrichSession — duration_min', async t => {
  await t.test('duration_min = duration_ms / 60000 rounded to 1 decimal', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ durationMs: 90000, messageCount: 3 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.duration_min, 1.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('duration_min rounds to 1 decimal place', async () => {
    const { dir, filePath } = writeTempJsonl([
      turnDurationRec({ durationMs: 100000, messageCount: 1 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.duration_min, +(100000 / 60000).toFixed(1));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('duration_min is null when duration_ms is null', async () => {
    const { dir, filePath } = writeTempJsonl([userRec()]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.duration_min, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('enrichSession — tool_diversity', async t => {
  await t.test('tool_diversity is count of unique tool names', async () => {
    const { dir, filePath } = writeTempJsonl([
      assistantRec({
        content: [
          { type: 'tool_use', name: 'Read',  input: { file_path: 'a.js' } },
          { type: 'tool_use', name: 'Write', input: { file_path: 'b.js' } },
          { type: 'tool_use', name: 'Read',  input: { file_path: 'c.js' } },
        ],
      }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.tool_diversity, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('tool_diversity is 0 when no tool calls', async () => {
    const { dir, filePath } = writeTempJsonl([userRec()]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.tool_diversity, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('enrichSession — date_str, day_of_week, hour_of_day', async t => {
  await t.test('date_str is the first 10 chars of first_timestamp', async () => {
    const { dir, filePath } = writeTempJsonl([
      userRec({ timestamp: '2026-03-15T14:30:00.000Z' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.date_str, '2026-03-15');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('day_of_week is UTC day 0–6 derived from first_timestamp', async () => {
    // 2026-03-15 is a Sunday (UTC day 0)
    const { dir, filePath } = writeTempJsonl([
      userRec({ timestamp: '2026-03-15T14:30:00.000Z' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.day_of_week, new Date('2026-03-15T14:30:00.000Z').getUTCDay());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('hour_of_day is UTC hour 0–23 from first_timestamp', async () => {
    const { dir, filePath } = writeTempJsonl([
      userRec({ timestamp: '2026-05-01T17:45:00.000Z' }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.hour_of_day, 17);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('date_str, day_of_week, hour_of_day are absent when no timestamps', async () => {
    const { dir, filePath } = writeTempJsonl([
      { type: 'permission-mode', permissionMode: 'default' },
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.first_timestamp, null);
      assert.equal(session.date_str,    undefined);
      assert.equal(session.day_of_week, undefined);
      assert.equal(session.hour_of_day, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Accumulation across multiple assistant records ────────────────────────────

test('token accumulation across multiple assistant records', async t => {
  await t.test('sums tokens from all assistant records', async () => {
    const { dir, filePath } = writeTempJsonl([
      assistantRec({ input: 100, cache_create: 10, cache_read: 20, output: 50 }),
      assistantRec({ input: 200, cache_create: 30, cache_read: 40, output: 60 }),
    ]);
    try {
      const session = analyzeSession('proj', filePath);
      assert.equal(session.tokens.input,        300);
      assert.equal(session.tokens.cache_create,  40);
      assert.equal(session.tokens.cache_read,    60);
      assert.equal(session.tokens.output,       110);
      assert.equal(session.tokens.total,        510);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
