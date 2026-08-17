import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePiLabel, parsePiRecords } from '../hooks/analyzers/analyze-pi.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_ID = '019dca2b-f4f5-7609-96ae-fe883f7a03db';
const PROJECT_ID = '--D--src-ebrain--';

const rec = {
  session: (overrides = {}) => ({
    type: 'session', version: 3,
    id: SESSION_ID,
    timestamp: '2026-04-26T14:22:51.638Z',
    cwd: 'D:\\src\\ebrain',
    ...overrides,
  }),

  modelChange: (provider, modelId, ts = '2026-04-26T14:22:52.000Z') => ({
    type: 'model_change', id: 'mc01', parentId: null,
    timestamp: ts, provider, modelId,
  }),

  userMsg: (text, ts = '2026-04-26T14:23:00.000Z') => ({
    type: 'message', id: 'u01', parentId: 'mc01', timestamp: ts,
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: new Date(ts).getTime(),
    },
  }),

  assistantMsg: (content = [], usage = {}, stopReason = 'stop', ts = '2026-04-26T14:23:05.000Z') => ({
    type: 'message', id: 'a01', parentId: 'u01', timestamp: ts,
    message: {
      role: 'assistant',
      content,
      provider: 'google-antigravity',
      model: 'gemini-3.1-pro-low',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...usage },
      stopReason,
      timestamp: new Date(ts).getTime(),
    },
  }),

  toolCall: (name, args = {}) => ({ type: 'toolCall', id: 'tc01', name, arguments: args }),
};

// ── derivePiLabel ─────────────────────────────────────────────────────────────

test('derivePiLabel', async t => {
  await t.test('strips outer -- and src prefix', () => {
    assert.equal(derivePiLabel('--D--src-ebrain--'), 'ebrain');
  });
  await t.test('handles dotted project names', () => {
    assert.equal(derivePiLabel('--D--src-karx.github.io--'), 'karx.github.io');
  });
  await t.test('handles hyphenated project names', () => {
    assert.equal(derivePiLabel('--D--src-Minecraft-Overviewer--'), 'Minecraft-Overviewer');
  });
  await t.test('handles user-home project slugs', () => {
    assert.equal(derivePiLabel('--C--Users-karx0--'), 'C--Users-karx0');
  });
  await t.test('passes through slug without outer -- unchanged', () => {
    assert.equal(derivePiLabel('D--src-foo'), 'foo');
  });
});

// ── parsePiRecords — session shell ────────────────────────────────────────────

test('parsePiRecords — session identity', async t => {
  const session = parsePiRecords([rec.session()], SESSION_ID, PROJECT_ID);

  await t.test('sets session_id', () => {
    assert.equal(session.session_id, SESSION_ID);
  });
  await t.test('sets project_id', () => {
    assert.equal(session.project_id, PROJECT_ID);
  });
  await t.test('derives project_label', () => {
    assert.equal(session.project_label, 'ebrain');
  });
  await t.test('sets cwd from session record', () => {
    assert.ok(session.cwd);
  });
  await t.test('slug is first 8 chars of session_id', () => {
    assert.equal(session.slug, SESSION_ID.slice(0, 8));
  });
  await t.test('harness field is pi', () => {
    assert.equal(session.harness, 'pi');
  });
});

// ── parsePiRecords — model_change ─────────────────────────────────────────────

test('parsePiRecords — model tracking', async t => {
  await t.test('captures model as provider/modelId from model_change', () => {
    const records = [rec.session(), rec.modelChange('openai', 'gpt-5.4')];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.model, 'openai/gpt-5.4');
  });

  await t.test('later model_change overwrites earlier one', () => {
    const records = [
      rec.session(),
      rec.modelChange('openai', 'gpt-4', '2026-04-26T14:22:52.000Z'),
      rec.modelChange('google-antigravity', 'gemini-3.1-pro-low', '2026-04-26T14:23:00.000Z'),
    ];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.model, 'google-antigravity/gemini-3.1-pro-low');
  });

  await t.test('assistant message model overrides model_change', () => {
    const records = [
      rec.session(),
      rec.modelChange('openai', 'gpt-4'),
      rec.userMsg('hello'),
      rec.assistantMsg([], { input: 10, output: 5 }),
    ];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.model, 'google-antigravity/gemini-3.1-pro-low');
  });

  await t.test('model is null when no model records present', () => {
    const session = parsePiRecords([rec.session(), rec.userMsg('hi')], SESSION_ID, PROJECT_ID);
    assert.equal(session.model, null);
  });
});

// ── parsePiRecords — user turns ───────────────────────────────────────────────

test('parsePiRecords — user turns', async t => {
  await t.test('increments user_turns per user message', () => {
    const records = [
      rec.session(),
      rec.userMsg('first message here'),
      { ...rec.userMsg('second message'), id: 'u02', parentId: 'u01', timestamp: '2026-04-26T14:24:00.000Z' },
    ];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.user_turns, 2);
  });

  await t.test('captures first user message', () => {
    const records = [rec.session(), rec.userMsg('setup pi to leverage a new LLM provider')];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.first_user_message, 'setup pi to leverage a new LLM provider');
  });

  await t.test('does not override first_user_message on subsequent turns', () => {
    const records = [
      rec.session(),
      rec.userMsg('first message here'),
      { ...rec.userMsg('second message replaces?'), id: 'u02', timestamp: '2026-04-26T14:24:00.000Z' },
    ];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.first_user_message, 'first message here');
  });

  await t.test('skips first_user_message when text is too short (< 8 chars)', () => {
    const records = [
      rec.session(),
      rec.userMsg('hey'),
      { ...rec.userMsg('this is a longer message'), id: 'u02', timestamp: '2026-04-26T14:24:00.000Z' },
    ];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.first_user_message, 'this is a longer message');
  });

  await t.test('caps first_user_message at 200 chars', () => {
    const long = 'x'.repeat(300);
    const records = [rec.session(), rec.userMsg(long)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.first_user_message?.length, 200);
  });
});

// ── parsePiRecords — assistant turns & tokens ─────────────────────────────────

test('parsePiRecords — assistant turns and tokens', async t => {
  await t.test('increments assistant_turns', () => {
    const records = [rec.session(), rec.userMsg('hello'), rec.assistantMsg()];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.assistant_turns, 1);
  });

  await t.test('maps Pi usage.input → tokens.input', () => {
    const records = [rec.session(), rec.userMsg('hi'), rec.assistantMsg([], { input: 500 })];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.tokens.input, 500);
  });

  await t.test('maps Pi usage.output → tokens.output', () => {
    const records = [rec.session(), rec.userMsg('hi'), rec.assistantMsg([], { output: 120 })];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.tokens.output, 120);
  });

  await t.test('maps Pi usage.cacheRead → tokens.cache_read', () => {
    const records = [rec.session(), rec.userMsg('hi'), rec.assistantMsg([], { cacheRead: 80 })];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.tokens.cache_read, 80);
  });

  await t.test('maps Pi usage.cacheWrite → tokens.cache_create', () => {
    const records = [rec.session(), rec.userMsg('hi'), rec.assistantMsg([], { cacheWrite: 40 })];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.tokens.cache_create, 40);
  });

  await t.test('accumulates tokens across multiple assistant turns', () => {
    const records = [
      rec.session(),
      rec.userMsg('first'),
      rec.assistantMsg([], { input: 100, output: 50 }),
      { ...rec.userMsg('second'), id: 'u02', timestamp: '2026-04-26T14:24:00.000Z' },
      { ...rec.assistantMsg([], { input: 200, output: 75 }), id: 'a02', parentId: 'u02', timestamp: '2026-04-26T14:24:05.000Z' },
    ];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.tokens.input, 300);
    assert.equal(session.tokens.output, 125);
  });

  await t.test('stop_reason is tracked', () => {
    const records = [rec.session(), rec.userMsg('hi'), rec.assistantMsg([], {}, 'toolUse')];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.stop_reasons['toolUse'], 1);
  });

  await t.test('stop_reason error does not affect tool_errors', () => {
    const records = [rec.session(), rec.userMsg('hi'), rec.assistantMsg([], {}, 'error')];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.tool_errors, 0);
  });

  await t.test('message_count equals user_turns + assistant_turns', () => {
    const records = [rec.session(), rec.userMsg('hi'), rec.assistantMsg()];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.message_count, session.user_turns + session.assistant_turns);
  });
});

// ── parsePiRecords — tool calls ───────────────────────────────────────────────

test('parsePiRecords — tool calls', async t => {
  await t.test('increments tool_calls for each toolCall block', () => {
    const content = [rec.toolCall('bash', { command: 'ls' }), rec.toolCall('read', { path: 'a.js' })];
    const records = [rec.session(), rec.userMsg('do it'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.tool_calls, 2);
  });

  await t.test('populates tools map with call counts', () => {
    const content = [rec.toolCall('bash', { command: 'ls' }), rec.toolCall('bash', { command: 'git status' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.tools['bash'].calls, 2);
  });

  await t.test('categorizes git bash command', () => {
    const content = [rec.toolCall('bash', { command: 'git status' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.bash_categories['git'], 1);
  });

  await t.test('categorizes npm bash command', () => {
    const content = [rec.toolCall('bash', { command: 'npm install' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.bash_categories['npm'], 1);
  });

  await t.test('categorizes node bash command', () => {
    const content = [rec.toolCall('bash', { command: 'node server.mjs' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.bash_categories['node'], 1);
  });

  await t.test('categorizes other bash command', () => {
    const content = [rec.toolCall('bash', { command: 'echo hello' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.bash_categories['other'], 1);
  });

  await t.test('categorizes npx bash command', () => {
    const content = [rec.toolCall('bash', { command: 'npx tsc --noEmit' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.bash_categories['npx'], 1);
  });

  await t.test('categorizes python bash command', () => {
    const content = [rec.toolCall('bash', { command: 'python main.py' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.bash_categories['python'], 1);
  });

  await t.test('categorizes fs bash command (ls)', () => {
    const content = [rec.toolCall('bash', { command: 'ls -la' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.bash_categories['fs'], 1);
  });

  await t.test('categorizes curl bash command', () => {
    const content = [rec.toolCall('bash', { command: 'curl https://example.com' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.bash_categories['curl'], 1);
  });
});

// ── parsePiRecords — file ops ─────────────────────────────────────────────────

test('parsePiRecords — file ops', async t => {
  await t.test('tracks write op via write toolCall', () => {
    const content = [rec.toolCall('write', { path: 'D:\\src\\ebrain\\foo.md', content: '# hi' })];
    const records = [rec.session(), rec.userMsg('write it'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    const fp = Object.keys(session.file_ops)[0];
    assert.ok(fp, 'should have a file_ops entry');
    assert.equal(session.file_ops[fp].write, 1);
    assert.equal(session.file_ops[fp].read,  0);
    assert.equal(session.file_ops[fp].edit,  0);
  });

  await t.test('tracks read op via read toolCall', () => {
    const content = [rec.toolCall('read', { path: 'C:/foo/bar.js' })];
    const records = [rec.session(), rec.userMsg('read it'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    const fp = 'c:/foo/bar.js';
    assert.equal(session.file_ops[fp]?.read, 1);
  });

  await t.test('tracks edit op via edit toolCall', () => {
    const content = [rec.toolCall('edit', { path: 'src/index.js', edits: [] })];
    const records = [rec.session(), rec.userMsg('edit it'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    const fp = 'src/index.js';
    assert.equal(session.file_ops[fp]?.edit, 1);
  });

  await t.test('normalises backslash paths in file_ops keys', () => {
    const content = [rec.toolCall('read', { path: 'C:\\Users\\foo\\bar.js' })];
    const records = [rec.session(), rec.userMsg('read it'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.ok('c:/users/foo/bar.js' in session.file_ops, 'key should use forward slashes');
  });

  await t.test('skips file op when path is absent', () => {
    const content = [rec.toolCall('write', { content: 'data with no path field' })];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(Object.keys(session.file_ops).length, 0);
  });

  await t.test('accumulates ops on the same path', () => {
    const content = [
      rec.toolCall('read',  { path: 'src/x.js' }),
      rec.toolCall('write', { path: 'src/x.js', content: '' }),
    ];
    const records = [rec.session(), rec.userMsg('go'), rec.assistantMsg(content)];
    const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);
    assert.equal(session.file_ops['src/x.js'].read,  1);
    assert.equal(session.file_ops['src/x.js'].write, 1);
  });
});

// ── parsePiRecords — timestamps ───────────────────────────────────────────────

test('parsePiRecords — timestamps', async t => {
  const records = [
    rec.session(),                                                    // 14:22:51
    rec.userMsg('hello', '2026-04-26T14:23:00.000Z'),                 // 14:23:00
    rec.assistantMsg([], {}, 'stop', '2026-04-26T14:23:05.000Z'),     // 14:23:05
  ];
  const session = parsePiRecords(records, SESSION_ID, PROJECT_ID);

  await t.test('first_timestamp is earliest record timestamp', () => {
    assert.equal(session.first_timestamp, '2026-04-26T14:22:51.638Z');
  });
  await t.test('last_timestamp is latest record timestamp', () => {
    assert.equal(session.last_timestamp, '2026-04-26T14:23:05.000Z');
  });
});

// ── parsePiRecords — empty / minimal ─────────────────────────────────────────

test('parsePiRecords — empty records', async t => {
  const session = parsePiRecords([], SESSION_ID, PROJECT_ID);

  await t.test('initialises zero counts', () => {
    assert.equal(session.user_turns,      0);
    assert.equal(session.assistant_turns, 0);
    assert.equal(session.tool_calls,      0);
    assert.equal(session.tool_errors,     0);
  });
  await t.test('initialises zero token buckets', () => {
    assert.deepEqual(session.tokens, { input: 0, cache_create: 0, cache_read: 0, output: 0 });
  });
  await t.test('first_user_message is null', () => {
    assert.equal(session.first_user_message, null);
  });
  await t.test('model is null', () => {
    assert.equal(session.model, null);
  });
  await t.test('skills and builtin_commands are empty arrays', () => {
    assert.deepEqual(session.skills, []);
    assert.deepEqual(session.builtin_commands, []);
  });
});
