import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { analyzeSession } from '../analyze.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

const TS = '2026-05-01T10:00:00.000Z';

function writeTempJsonl(records, sessionId = 'testsession') {
  const dir = join(tmpdir(), 'kaaro-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, sessionId + '.jsonl');
  writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n'), 'utf8');
  return { dir, filePath };
}

function makeAssistantRec(toolBlocks, ts = TS) {
  return {
    type: 'assistant',
    timestamp: ts,
    message: {
      model: 'm',
      usage: {},
      content: toolBlocks,
    },
  };
}

function toolUse(name, input = {}) {
  return { type: 'tool_use', name, input };
}

function makeUserRec(content, ts = TS) {
  return {
    type: 'user',
    timestamp: ts,
    message: { content },
  };
}

// ── file_ops ──────────────────────────────────────────────────────────────────

test('file_ops — Read increments read counter', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Read', { file_path: 'src/foo.js' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('creates entry for file', () => {
      assert.ok(session.file_ops['src/foo.js'], 'entry should exist');
    });
    await t.test('read count is 1', () => {
      assert.equal(session.file_ops['src/foo.js'].read, 1);
    });
    await t.test('write count is 0', () => {
      assert.equal(session.file_ops['src/foo.js'].write, 0);
    });
    await t.test('edit count is 0', () => {
      assert.equal(session.file_ops['src/foo.js'].edit, 0);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file_ops — Write increments write counter', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Write', { file_path: 'src/bar.js' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('write count is 1', () => {
      assert.equal(session.file_ops['src/bar.js'].write, 1);
    });
    await t.test('read count is 0', () => {
      assert.equal(session.file_ops['src/bar.js'].read, 0);
    });
    await t.test('edit count is 0', () => {
      assert.equal(session.file_ops['src/bar.js'].edit, 0);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file_ops — Edit increments edit counter', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Edit', { file_path: 'src/baz.js' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('edit count is 1', () => {
      assert.equal(session.file_ops['src/baz.js'].edit, 1);
    });
    await t.test('read count is 0', () => {
      assert.equal(session.file_ops['src/baz.js'].read, 0);
    });
    await t.test('write count is 0', () => {
      assert.equal(session.file_ops['src/baz.js'].write, 0);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file_ops — same file Read twice accumulates read count', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([
      toolUse('Read', { file_path: 'src/foo.js' }),
      toolUse('Read', { file_path: 'src/foo.js' }),
    ]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('read count is 2', () => {
      assert.equal(session.file_ops['src/foo.js'].read, 2);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file_ops — Read and Write on same file accumulate on same key', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Read', { file_path: 'src/foo.js' })]),
    makeAssistantRec([toolUse('Write', { file_path: 'src/foo.js' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('has exactly one key for the file', () => {
      assert.equal(Object.keys(session.file_ops).length, 1);
    });
    await t.test('read count is 1', () => {
      assert.equal(session.file_ops['src/foo.js'].read, 1);
    });
    await t.test('write count is 1', () => {
      assert.equal(session.file_ops['src/foo.js'].write, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file_ops — backslash path normalised to forward slashes', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Read', { file_path: 'C:\\Users\\foo\\bar.js' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('key uses forward slashes', () => {
      assert.ok(session.file_ops['C:/Users/foo/bar.js'], 'normalised key should exist');
    });
    await t.test('original backslash key does not exist', () => {
      assert.equal(session.file_ops['C:\\Users\\foo\\bar.js'], undefined);
    });
    await t.test('read count is 1 on normalised key', () => {
      assert.equal(session.file_ops['C:/Users/foo/bar.js'].read, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file_ops — non-file tool (Bash) does not create a file_ops entry', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Bash', { command: 'git status' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('file_ops is empty', () => {
      assert.deepEqual(session.file_ops, {});
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file_ops — tool_use with empty file_path creates no entry', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Read', { file_path: '' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('file_ops is empty', () => {
      assert.deepEqual(session.file_ops, {});
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file_ops — tool_use with missing file_path creates no entry', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Read', {})]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('file_ops is empty', () => {
      assert.deepEqual(session.file_ops, {});
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── bash_categories ───────────────────────────────────────────────────────────

test('bash_categories — git command', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Bash', { command: 'git status' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('git count is 1', () => {
      assert.equal(session.bash_categories.git, 1);
    });
    await t.test('no other categories present', () => {
      assert.equal(Object.keys(session.bash_categories).length, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bash_categories — npm command', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Bash', { command: 'npm install' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('npm count is 1', () => {
      assert.equal(session.bash_categories.npm, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bash_categories — node command', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Bash', { command: 'node server.mjs' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('node count is 1', () => {
      assert.equal(session.bash_categories.node, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bash_categories — other command', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Bash', { command: 'echo hello' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('other count is 1', () => {
      assert.equal(session.bash_categories.other, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bash_categories — multiple Bash calls accumulate per category', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([
      toolUse('Bash', { command: 'git status' }),
      toolUse('Bash', { command: 'git commit -m "x"' }),
      toolUse('Bash', { command: 'npm test' }),
    ]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('git count is 2', () => {
      assert.equal(session.bash_categories.git, 2);
    });
    await t.test('npm count is 1', () => {
      assert.equal(session.bash_categories.npm, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bash_categories — non-Bash tool_use does not add to bash_categories', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Read', { file_path: 'src/foo.js' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('bash_categories is empty', () => {
      assert.deepEqual(session.bash_categories, {});
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── skills and builtin_commands ───────────────────────────────────────────────

test('skills — non-builtin skill goes into skills array', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('<command-name>/my-custom-skill</command-name> please run this'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('skills includes my-custom-skill', () => {
      assert.ok(session.skills.includes('my-custom-skill'));
    });
    await t.test('builtin_commands does not include my-custom-skill', () => {
      assert.ok(!session.builtin_commands.includes('my-custom-skill'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills — builtin command goes into builtin_commands array', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('<command-name>/compact</command-name>'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('builtin_commands includes compact', () => {
      assert.ok(session.builtin_commands.includes('compact'));
    });
    await t.test('skills does not include compact', () => {
      assert.ok(!session.skills.includes('compact'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills — review is a builtin command', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('<command-name>/review</command-name> please review this'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('builtin_commands includes review', () => {
      assert.ok(session.builtin_commands.includes('review'));
    });
    await t.test('skills does not include review', () => {
      assert.ok(!session.skills.includes('review'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills — same skill in two user turns appears only once', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('<command-name>/my-custom-skill</command-name> first use'),
    makeUserRec('<command-name>/my-custom-skill</command-name> second use'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('skills has exactly one entry for my-custom-skill', () => {
      const count = session.skills.filter(s => s === 'my-custom-skill').length;
      assert.equal(count, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills — skill and builtin in same session are correctly split', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('<command-name>/my-custom-skill</command-name> something'),
    makeUserRec('<command-name>/compact</command-name>'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('skills includes my-custom-skill', () => {
      assert.ok(session.skills.includes('my-custom-skill'));
    });
    await t.test('builtin_commands includes compact', () => {
      assert.ok(session.builtin_commands.includes('compact'));
    });
    await t.test('compact is not in skills', () => {
      assert.ok(!session.skills.includes('compact'));
    });
    await t.test('my-custom-skill is not in builtin_commands', () => {
      assert.ok(!session.builtin_commands.includes('my-custom-skill'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills — tag without leading slash also recognised', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('<command-name>my-custom-skill</command-name> something'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('skills includes my-custom-skill', () => {
      assert.ok(session.skills.includes('my-custom-skill'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── first_user_message ────────────────────────────────────────────────────────

test('first_user_message — valid message captured', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('Please fix the bug in the login form'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('first_user_message is set', () => {
      assert.equal(session.first_user_message, 'Please fix the bug in the login form');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — message shorter than 8 chars is skipped', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('hi'),
    makeUserRec('This is a longer valid message for the session'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('first short message skipped; next valid one used', () => {
      assert.equal(session.first_user_message, 'This is a longer valid message for the session');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — message starting with "Base directory for this skill" is skipped', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('Base directory for this skill is /some/path here'),
    makeUserRec('Write a test for the auth module'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('skips Base directory message; uses next valid one', () => {
      assert.equal(session.first_user_message, 'Write a test for the auth module');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — message starting with "Caveat:" is skipped', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('Caveat: this tool has limitations'),
    makeUserRec('Refactor the database module please'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('skips Caveat message; uses next valid one', () => {
      assert.equal(session.first_user_message, 'Refactor the database module please');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — XML tags stripped before length check and storage', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('<system-reminder>long system content here that is ignored</system-reminder>hello world fix the bug'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('stored message has no XML tags', () => {
      assert.ok(!session.first_user_message.includes('<system-reminder>'));
    });
    await t.test('stored message contains the plain text part', () => {
      assert.ok(session.first_user_message.includes('hello world fix the bug'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — message with only XML tags (stripped content < 8 chars) is skipped', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('<system-reminder>some long reminder text</system-reminder>'),
    makeUserRec('Implement the new feature request'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('XML-only message skipped; next valid one used', () => {
      assert.equal(session.first_user_message, 'Implement the new feature request');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — subsequent user turns do not overwrite first valid message', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('First valid user message here'),
    makeUserRec('Second user message should not overwrite'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('first_user_message is from the first valid turn', () => {
      assert.equal(session.first_user_message, 'First valid user message here');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — long message truncated to 200 chars', async t => {
  const longMsg = 'A'.repeat(300);
  const { dir, filePath } = writeTempJsonl([
    makeUserRec(longMsg),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('message is truncated to 200 chars', () => {
      assert.equal(session.first_user_message.length, 200);
    });
    await t.test('truncated message is the first 200 chars', () => {
      assert.equal(session.first_user_message, 'A'.repeat(200));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — null when no valid user message exists', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeAssistantRec([toolUse('Read', { file_path: 'src/foo.js' })]),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('first_user_message is null', () => {
      assert.equal(session.first_user_message, null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first_user_message — null when all user messages are too short', async t => {
  const { dir, filePath } = writeTempJsonl([
    makeUserRec('hi'),
    makeUserRec('ok'),
    makeUserRec('yes'),
  ]);
  try {
    const session = analyzeSession('proj', filePath);
    await t.test('first_user_message is null', () => {
      assert.equal(session.first_user_message, null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
