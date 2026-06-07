import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAntigravityRecords,
  parseArgValue,
  deriveAntigravityProjectId,
  deriveAntigravityLabel,
  detectWorkspace,
  extractModelChange,
  extractUserMessage,
} from '../analyze-antigravity.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_ID = 'c7f6b422-2184-4e11-ad6d-535a069e7347';

const rec = {
  userInput: (request, modelTo = null, ts = '2026-06-07T00:15:33Z') => {
    const settingsBlock = modelTo
      ? `<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from None to ${modelTo}. No need to comment on this change.\n</USER_SETTINGS_CHANGE>`
      : '<USER_SETTINGS_CHANGE>\n</USER_SETTINGS_CHANGE>';
    return {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: ts,
      content: `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-06-07T05:45:33+05:30.\n</ADDITIONAL_METADATA>\n${settingsBlock}`,
    };
  },

  plannerResponse: (toolCalls = [], ts = '2026-06-07T00:15:34Z') => ({
    step_index: 2,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: ts,
    content: 'I will look at the files.',
    tool_calls: toolCalls,
  }),

  viewFile: (absPath, ts = '2026-06-07T00:15:40Z') => ({
    step_index: 3,
    source: 'MODEL',
    type: 'VIEW_FILE',
    status: 'DONE',
    created_at: ts,
    content: 'File content here.',
  }),

  viewFileError: (ts = '2026-06-07T00:15:41Z') => ({
    step_index: 4,
    source: 'MODEL',
    type: 'VIEW_FILE',
    status: 'ERROR',
    created_at: ts,
    content: 'Permission denied.',
  }),

  runCommand: (ts = '2026-06-07T00:15:45Z') => ({
    step_index: 5,
    source: 'MODEL',
    type: 'RUN_COMMAND',
    status: 'DONE',
    created_at: ts,
  }),

  systemMessage: (ts = '2026-06-07T00:15:50Z') => ({
    step_index: 6,
    source: 'SYSTEM',
    type: 'SYSTEM_MESSAGE',
    status: 'DONE',
    created_at: ts,
    content: 'Background task complete.',
  }),

  conversationHistory: (ts = '2026-06-07T00:15:33Z') => ({
    step_index: 1,
    source: 'SYSTEM',
    type: 'CONVERSATION_HISTORY',
    status: 'DONE',
    created_at: ts,
  }),

  // Factory for tool call objects within PLANNER_RESPONSE
  tc: {
    viewFile: (absPath) => ({
      name: 'view_file',
      args: { AbsolutePath: JSON.stringify(absPath), toolSummary: '"Viewing file"' },
    }),
    writeFile: (targetFile) => ({
      name: 'write_to_file',
      args: { TargetFile: JSON.stringify(targetFile), Overwrite: 'false', CodeContent: '"# hello"' },
    }),
    replaceFile: (targetFile) => ({
      name: 'replace_file_content',
      args: { TargetFile: JSON.stringify(targetFile), TargetContent: '"old"', ReplacementContent: '"new"' },
    }),
    multiReplaceFile: (targetFile) => ({
      name: 'multi_replace_file_content',
      args: { TargetFile: JSON.stringify(targetFile) },
    }),
    runCommand: (cmd, cwd) => ({
      name: 'run_command',
      args: {
        CommandLine: JSON.stringify(cmd),
        Cwd: JSON.stringify(cwd),
        WaitMsBeforeAsync: '2000',
      },
    }),
    listDir: (dirPath) => ({
      name: 'list_dir',
      args: { DirectoryPath: JSON.stringify(dirPath) },
    }),
    grepSearch: (query, searchPath) => ({
      name: 'grep_search',
      args: { Query: JSON.stringify(query), SearchPath: JSON.stringify(searchPath) },
    }),
  },
};

// ── parseArgValue ─────────────────────────────────────────────────────────────

test('parseArgValue', async t => {
  await t.test('unwraps JSON-stringified string', () => {
    assert.equal(parseArgValue('"hello"'), 'hello');
  });
  await t.test('unwraps JSON-stringified path with backslashes', () => {
    assert.equal(parseArgValue('"d:\\\\src\\\\ebrain"'), 'd:\\src\\ebrain');
  });
  await t.test('returns null for null input', () => {
    assert.equal(parseArgValue(null), null);
  });
  await t.test('returns null for empty string', () => {
    assert.equal(parseArgValue(''), null);
  });
  await t.test('falls back to trimmed string on invalid JSON', () => {
    assert.equal(parseArgValue('  plain text  '), 'plain text');
  });
});

// ── deriveAntigravityProjectId ────────────────────────────────────────────────

test('deriveAntigravityProjectId', async t => {
  await t.test('Windows path with drive letter → Claude-Code-compatible slug', () => {
    assert.equal(deriveAntigravityProjectId('D:\\src\\ebrain'), 'D--src-ebrain');
  });
  await t.test('forward slashes also work', () => {
    assert.equal(deriveAntigravityProjectId('D:/src/ebrain'), 'D--src-ebrain');
  });
  await t.test('nested Windows path', () => {
    assert.equal(deriveAntigravityProjectId('D:\\src\\exp\\art-of-mine'), 'D--src-exp-art-of-mine');
  });
  await t.test('Unix-style path', () => {
    assert.equal(deriveAntigravityProjectId('/home/user/project'), 'home-user-project');
  });
  await t.test('null input returns sentinel', () => {
    assert.equal(deriveAntigravityProjectId(null), 'antigravity-unknown');
  });
  await t.test('preserves drive letter case as uppercase', () => {
    assert.ok(deriveAntigravityProjectId('c:\\foo').startsWith('C--'));
  });
});

// ── deriveAntigravityLabel ────────────────────────────────────────────────────

test('deriveAntigravityLabel', async t => {
  await t.test('returns last path segment', () => {
    assert.equal(deriveAntigravityLabel('D:\\src\\ebrain'), 'ebrain');
  });
  await t.test('forward slashes also work', () => {
    assert.equal(deriveAntigravityLabel('D:/src/ebrain'), 'ebrain');
  });
  await t.test('nested path returns leaf', () => {
    assert.equal(deriveAntigravityLabel('D:\\src\\exp\\art-of-mine(craft)'), 'art-of-mine(craft)');
  });
  await t.test('null returns unknown', () => {
    assert.equal(deriveAntigravityLabel(null), 'unknown');
  });
  await t.test('long Antigravity worktree path returns repo name', () => {
    const p = 'C:\\Users\\karx0\\.gemini\\antigravity\\worktrees\\kaaroSessions\\antigravity-session-logs-support';
    assert.equal(deriveAntigravityLabel(p), 'antigravity-session-logs-support');
  });
});

// ── extractModelChange ────────────────────────────────────────────────────────

test('extractModelChange', async t => {
  await t.test('extracts model from settings change text', () => {
    const content = 'The user changed setting `Model Selection` from None to Gemini 3.5 Flash (Medium). No need to comment.';
    assert.equal(extractModelChange(content), 'Gemini 3.5 Flash (Medium)');
  });
  await t.test('extracts model when switching between models', () => {
    const content = 'The user changed setting `Model Selection` from Gemini 3.5 Flash (Medium) to Claude Sonnet 4.6 (Thinking). No need to comment.';
    assert.equal(extractModelChange(content), 'Claude Sonnet 4.6 (Thinking)');
  });
  await t.test('returns null when no model change present', () => {
    assert.equal(extractModelChange('Just a regular message.'), null);
  });
  await t.test('returns null for null input', () => {
    assert.equal(extractModelChange(null), null);
  });
});

// ── extractUserMessage ────────────────────────────────────────────────────────

test('extractUserMessage', async t => {
  await t.test('extracts text from USER_REQUEST block', () => {
    const content = '<USER_REQUEST>\nHello, do the thing\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nsome metadata\n</ADDITIONAL_METADATA>';
    assert.equal(extractUserMessage(content), 'Hello, do the thing');
  });
  await t.test('strips XML blocks from content', () => {
    const content = '<USER_REQUEST>\nDo the thing\n</USER_REQUEST>';
    assert.equal(extractUserMessage(content), 'Do the thing');
  });
  await t.test('returns null when message is too short (< 8 chars)', () => {
    const content = '<USER_REQUEST>\nhi\n</USER_REQUEST>';
    assert.equal(extractUserMessage(content), null);
  });
  await t.test('caps at 200 chars', () => {
    const long = 'x'.repeat(300);
    const content = `<USER_REQUEST>\n${long}\n</USER_REQUEST>`;
    assert.equal(extractUserMessage(content)?.length, 200);
  });
  await t.test('returns null for null input', () => {
    assert.equal(extractUserMessage(null), null);
  });
});

// ── detectWorkspace ───────────────────────────────────────────────────────────

test('detectWorkspace', async t => {
  await t.test('returns most common Cwd from run_command tool calls', () => {
    const records = [
      rec.plannerResponse([
        rec.tc.runCommand('git status', 'D:\\src\\ebrain'),
        rec.tc.runCommand('npm test', 'D:\\src\\ebrain'),
      ]),
    ];
    const ws = detectWorkspace(records);
    assert.equal(ws, 'D:\\src\\ebrain');
  });

  await t.test('falls back to directory of view_file AbsolutePath', () => {
    const records = [
      rec.plannerResponse([
        rec.tc.viewFile('D:/src/proj/README.md'),
      ]),
    ];
    const ws = detectWorkspace(records);
    assert.equal(ws, 'D:/src/proj');
  });

  await t.test('uses list_dir DirectoryPath as workspace candidate', () => {
    const records = [
      rec.plannerResponse([
        rec.tc.listDir('D:/src/myproject'),
      ]),
    ];
    const ws = detectWorkspace(records);
    assert.equal(ws, 'D:/src/myproject');
  });

  await t.test('votes for most frequent path across multiple planner responses', () => {
    const records = [
      rec.plannerResponse([rec.tc.runCommand('git log', 'D:\\src\\ebrain')]),
      rec.plannerResponse([rec.tc.runCommand('ls', 'D:\\src\\other')], '2026-06-07T00:16:00Z'),
      rec.plannerResponse([rec.tc.runCommand('git status', 'D:\\src\\ebrain')], '2026-06-07T00:17:00Z'),
    ];
    assert.equal(detectWorkspace(records), 'D:\\src\\ebrain');
  });

  await t.test('returns null when no tool calls present', () => {
    assert.equal(detectWorkspace([]), null);
    assert.equal(detectWorkspace([rec.userInput('hello'), rec.viewFile()]), null);
  });
});

// ── parseAntigravityRecords — identity ────────────────────────────────────────

test('parseAntigravityRecords — session identity', async t => {
  const session = parseAntigravityRecords([], SESSION_ID);

  await t.test('sets session_id', () => {
    assert.equal(session.session_id, SESSION_ID);
  });
  await t.test('slug is first 8 chars of session_id', () => {
    assert.equal(session.slug, SESSION_ID.slice(0, 8));
  });
  await t.test('harness field is antigravity', () => {
    assert.equal(session.harness, 'antigravity');
  });
  await t.test('project_id defaults to antigravity-unknown when no workspace', () => {
    assert.equal(session.project_id, 'antigravity-unknown');
  });
  await t.test('project_label defaults to unknown when no workspace', () => {
    assert.equal(session.project_label, 'unknown');
  });
});

// ── parseAntigravityRecords — project derivation ──────────────────────────────

test('parseAntigravityRecords — project derivation', async t => {
  await t.test('derives project from run_command Cwd', () => {
    const records = [
      rec.plannerResponse([rec.tc.runCommand('git status', 'D:\\src\\ebrain')]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.project_id, 'D--src-ebrain');
    assert.equal(session.project_label, 'ebrain');
    assert.equal(session.cwd, 'D:\\src\\ebrain');
  });

  await t.test('derives project from view_file path when no run_command', () => {
    const records = [
      rec.plannerResponse([rec.tc.viewFile('D:/src/myproj/README.md')]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.project_id, 'D--src-myproj');
    assert.equal(session.project_label, 'myproj');
  });
});

// ── parseAntigravityRecords — user turns ──────────────────────────────────────

test('parseAntigravityRecords — user turns', async t => {
  await t.test('counts USER_INPUT records as user turns', () => {
    const records = [
      rec.userInput('Do the thing'),
      { ...rec.userInput('Do another thing'), step_index: 10, created_at: '2026-06-07T00:20:00Z' },
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.user_turns, 2);
  });

  await t.test('ignores SYSTEM source records for user_turns', () => {
    const records = [
      rec.conversationHistory(),
      rec.userInput('Hello world request'),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.user_turns, 1);
  });

  await t.test('captures first_user_message from USER_INPUT', () => {
    const records = [rec.userInput('Set up the database connection pool')];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.first_user_message, 'Set up the database connection pool');
  });

  await t.test('does not override first_user_message on subsequent turns', () => {
    const records = [
      rec.userInput('First message to keep'),
      { ...rec.userInput('Second message ignored'), step_index: 10, created_at: '2026-06-07T00:20:00Z' },
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.first_user_message, 'First message to keep');
  });

  await t.test('skips first_user_message when text is too short', () => {
    const records = [
      rec.userInput('hi'),
      { ...rec.userInput('This is a longer message'), step_index: 10, created_at: '2026-06-07T00:20:00Z' },
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.first_user_message, 'This is a longer message');
  });
});

// ── parseAntigravityRecords — model tracking ──────────────────────────────────

test('parseAntigravityRecords — model tracking', async t => {
  await t.test('extracts model from USER_SETTINGS_CHANGE', () => {
    const records = [rec.userInput('Do something', 'Gemini 3.5 Flash (Medium)')];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.model, 'Gemini 3.5 Flash (Medium)');
  });

  await t.test('last model change wins', () => {
    const records = [
      rec.userInput('First message', 'Claude Sonnet 4.6'),
      { ...rec.userInput('Second message', 'Gemini 3.5 Flash (Medium)'), step_index: 10, created_at: '2026-06-07T00:20:00Z' },
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.model, 'Gemini 3.5 Flash (Medium)');
  });

  await t.test('model is null when no settings change present', () => {
    const records = [rec.userInput('Hello there friend')];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.model, null);
  });
});

// ── parseAntigravityRecords — assistant turns ─────────────────────────────────

test('parseAntigravityRecords — assistant turns', async t => {
  await t.test('counts PLANNER_RESPONSE records as assistant turns', () => {
    const records = [
      rec.plannerResponse([]),
      { ...rec.plannerResponse([]), step_index: 10, created_at: '2026-06-07T00:16:00Z' },
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.assistant_turns, 2);
  });

  await t.test('counts tool calls from PLANNER_RESPONSE', () => {
    const records = [
      rec.plannerResponse([
        rec.tc.viewFile('D:/src/proj/README.md'),
        rec.tc.listDir('D:/src/proj'),
      ]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.tool_calls, 2);
  });

  await t.test('accumulates tool_calls across multiple planner responses', () => {
    const records = [
      rec.plannerResponse([rec.tc.viewFile('D:/src/proj/a.js')]),
      { ...rec.plannerResponse([rec.tc.viewFile('D:/src/proj/b.js'), rec.tc.listDir('D:/src/proj')]), step_index: 5, created_at: '2026-06-07T00:16:00Z' },
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.tool_calls, 3);
  });

  await t.test('message_count equals user_turns + assistant_turns', () => {
    const records = [
      rec.userInput('Do the thing'),
      rec.plannerResponse([rec.tc.viewFile('D:/proj/a.js')]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.message_count, session.user_turns + session.assistant_turns);
  });
});

// ── parseAntigravityRecords — file ops ────────────────────────────────────────

test('parseAntigravityRecords — file ops', async t => {
  await t.test('tracks read op from view_file tool call', () => {
    const records = [
      rec.plannerResponse([rec.tc.viewFile('D:/src/proj/README.md')]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.file_ops['d:/src/proj/readme.md']?.read, 1);
  });

  await t.test('tracks write op from write_to_file tool call', () => {
    const records = [
      rec.plannerResponse([rec.tc.writeFile('D:/src/proj/index.js')]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.file_ops['d:/src/proj/index.js']?.write, 1);
  });

  await t.test('tracks edit op from replace_file_content tool call', () => {
    const records = [
      rec.plannerResponse([rec.tc.replaceFile('D:/src/proj/app.js')]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.file_ops['d:/src/proj/app.js']?.edit, 1);
  });

  await t.test('tracks edit op from multi_replace_file_content tool call', () => {
    const records = [
      rec.plannerResponse([rec.tc.multiReplaceFile('D:/src/proj/utils.js')]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.file_ops['d:/src/proj/utils.js']?.edit, 1);
  });

  await t.test('normalises Windows backslash paths to forward slashes', () => {
    const records = [
      rec.plannerResponse([rec.tc.viewFile('D:\\src\\proj\\README.md')]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.ok('d:/src/proj/readme.md' in session.file_ops, 'key should use forward slashes');
  });

  await t.test('accumulates ops on the same path', () => {
    const records = [
      rec.plannerResponse([
        rec.tc.viewFile('D:/src/proj/a.js'),
        rec.tc.replaceFile('D:/src/proj/a.js'),
      ]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.file_ops['d:/src/proj/a.js'].read, 1);
    assert.equal(session.file_ops['d:/src/proj/a.js'].edit, 1);
  });
});

// ── parseAntigravityRecords — bash categories ─────────────────────────────────

test('parseAntigravityRecords — bash categories', async t => {
  const makeBash = (cmd, cwd = 'D:\\src\\proj') => [
    rec.plannerResponse([rec.tc.runCommand(cmd, cwd)]),
  ];

  await t.test('categorizes git commands', () => {
    const session = parseAntigravityRecords(makeBash('git status'), SESSION_ID);
    assert.equal(session.bash_categories['git'], 1);
  });
  await t.test('categorizes npm commands', () => {
    const session = parseAntigravityRecords(makeBash('npm install'), SESSION_ID);
    assert.equal(session.bash_categories['npm'], 1);
  });
  await t.test('categorizes npx commands', () => {
    const session = parseAntigravityRecords(makeBash('npx tsc --noEmit'), SESSION_ID);
    assert.equal(session.bash_categories['npx'], 1);
  });
  await t.test('categorizes node commands', () => {
    const session = parseAntigravityRecords(makeBash('node serve.mjs'), SESSION_ID);
    assert.equal(session.bash_categories['node'], 1);
  });
  await t.test('categorizes python commands', () => {
    const session = parseAntigravityRecords(makeBash('python main.py'), SESSION_ID);
    assert.equal(session.bash_categories['python'], 1);
  });
  await t.test('categorizes other commands as other', () => {
    const session = parseAntigravityRecords(makeBash('echo hello'), SESSION_ID);
    assert.equal(session.bash_categories['other'], 1);
  });
});

// ── parseAntigravityRecords — tool errors ─────────────────────────────────────

test('parseAntigravityRecords — tool errors', async t => {
  await t.test('counts ERROR-status tool result records', () => {
    const records = [rec.viewFileError()];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.tool_errors, 1);
  });

  await t.test('does not count DONE-status tool result records', () => {
    const records = [rec.viewFile()];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.tool_errors, 0);
  });

  await t.test('does not count PLANNER_RESPONSE records as errors', () => {
    const records = [rec.plannerResponse([])];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.tool_errors, 0);
  });
});

// ── parseAntigravityRecords — timestamps ──────────────────────────────────────

test('parseAntigravityRecords — timestamps', async t => {
  const records = [
    rec.userInput('hello', null, '2026-06-07T00:15:33Z'),
    rec.plannerResponse([], '2026-06-07T00:15:34Z'),
    rec.viewFile('D:/proj/a.js', '2026-06-07T00:15:40Z'),
  ];
  const session = parseAntigravityRecords(records, SESSION_ID);

  await t.test('first_timestamp is earliest created_at', () => {
    assert.equal(session.first_timestamp, '2026-06-07T00:15:33Z');
  });
  await t.test('last_timestamp is latest created_at', () => {
    assert.equal(session.last_timestamp, '2026-06-07T00:15:40Z');
  });
  await t.test('duration_ms is computed from timestamps', () => {
    const expected = new Date('2026-06-07T00:15:40Z') - new Date('2026-06-07T00:15:33Z');
    assert.equal(session.duration_ms, expected);
  });
});

// ── parseAntigravityRecords — empty records ───────────────────────────────────

test('parseAntigravityRecords — empty records', async t => {
  const session = parseAntigravityRecords([], SESSION_ID);

  await t.test('initialises zero counters', () => {
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
    assert.deepEqual(session.skills,           []);
    assert.deepEqual(session.builtin_commands, []);
  });
  await t.test('first_timestamp and last_timestamp are null', () => {
    assert.equal(session.first_timestamp, null);
    assert.equal(session.last_timestamp,  null);
  });
});

// ── parseAntigravityRecords — tools map ───────────────────────────────────────

test('parseAntigravityRecords — tools map', async t => {
  await t.test('populates tools map with call counts', () => {
    const records = [
      rec.plannerResponse([
        rec.tc.viewFile('D:/src/proj/a.js'),
        rec.tc.viewFile('D:/src/proj/b.js'),
        rec.tc.runCommand('git status', 'D:\\src\\proj'),
      ]),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.tools['view_file'].calls,  2);
    assert.equal(session.tools['run_command'].calls, 1);
  });

  await t.test('increments errors on the matching tool entry', () => {
    const records = [
      rec.plannerResponse([rec.tc.viewFile('D:/src/proj/a.js')]),
      rec.viewFileError(),
    ];
    const session = parseAntigravityRecords(records, SESSION_ID);
    assert.equal(session.tools['view_file'].errors, 1);
  });
});
