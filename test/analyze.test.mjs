import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveLabel,
  normPath,
  extractTextFromContent,
  extractSkills,
  buildProjectSummary,
  buildGlobalRollup,
} from '../analyze.mjs';

// ── deriveLabel ───────────────────────────────────────────────────────────────

test('deriveLabel', async t => {
  await t.test('strips D--src- prefix', () => {
    assert.equal(deriveLabel('D--src-kaaroViewer'), 'kaaroViewer');
  });
  await t.test('strips D--src- prefix preserving hyphens in name', () => {
    assert.equal(deriveLabel('D--src-karx-github-io'), 'karx-github-io');
  });
  await t.test('strips C--Users-<username>- prefix', () => {
    assert.equal(deriveLabel('C--Users-karx0-foo'), 'foo');
  });
  await t.test('passes through unrecognised id unchanged', () => {
    assert.equal(deriveLabel('my-project'), 'my-project');
  });
  await t.test('handles lowercase drive letter', () => {
    assert.equal(deriveLabel('d--src-myapp'), 'myapp');
  });
});

// ── normPath ──────────────────────────────────────────────────────────────────

test('normPath', async t => {
  await t.test('converts backslashes to forward slashes', () => {
    assert.equal(normPath('C:\\Users\\foo\\bar.js'), 'C:/Users/foo/bar.js');
  });
  await t.test('collapses double forward slashes', () => {
    assert.equal(normPath('//foo//bar'), '/foo/bar');
  });
  await t.test('returns null for null input', () => {
    assert.equal(normPath(null), null);
  });
  await t.test('returns null for non-string input', () => {
    assert.equal(normPath(42), null);
  });
  await t.test('returns null for empty string', () => {
    assert.equal(normPath(''), null);
  });
  await t.test('returns null for whitespace-only string', () => {
    assert.equal(normPath('   '), null);
  });
  await t.test('trims leading and trailing whitespace', () => {
    assert.equal(normPath('  src/foo.js  '), 'src/foo.js');
  });
});

// ── extractTextFromContent ────────────────────────────────────────────────────

test('extractTextFromContent', async t => {
  await t.test('returns string input as-is', () => {
    assert.equal(extractTextFromContent('hello world'), 'hello world');
  });
  await t.test('joins text blocks from content array', () => {
    const content = [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }];
    assert.equal(extractTextFromContent(content), 'hello world');
  });
  await t.test('ignores non-text blocks', () => {
    const content = [{ type: 'tool_use', id: 'x' }, { type: 'text', text: 'hi' }];
    assert.equal(extractTextFromContent(content), 'hi');
  });
  await t.test('returns empty string for empty array', () => {
    assert.equal(extractTextFromContent([]), '');
  });
  await t.test('returns empty string for number input', () => {
    assert.equal(extractTextFromContent(42), '');
  });
  await t.test('handles missing text property gracefully', () => {
    const content = [{ type: 'text' }, { type: 'text', text: 'ok' }];
    assert.equal(extractTextFromContent(content), ' ok');
  });
});

// ── extractSkills ─────────────────────────────────────────────────────────────

test('extractSkills', async t => {
  await t.test('extracts skill name with leading slash', () => {
    assert.deepEqual(extractSkills('<command-name>/foo</command-name>'), ['foo']);
  });
  await t.test('extracts skill name without leading slash', () => {
    assert.deepEqual(extractSkills('<command-name>bar</command-name>'), ['bar']);
  });
  await t.test('extracts multiple skills', () => {
    assert.deepEqual(
      extractSkills('<command-name>/a</command-name> text <command-name>/b</command-name>'),
      ['a', 'b']
    );
  });
  await t.test('returns empty array when no command-name tags present', () => {
    assert.deepEqual(extractSkills('no skills here'), []);
  });
  await t.test('handles hyphenated skill names', () => {
    assert.deepEqual(extractSkills('<command-name>/web-seo</command-name>'), ['web-seo']);
  });
});

// ── buildProjectSummary ───────────────────────────────────────────────────────

test('buildProjectSummary', async t => {
  const sessions = [
    {
      tokens: { input: 100, cache_create: 20, cache_read: 50, output: 80 },
      tool_calls: 5, tool_errors: 1, file_size_bytes: 1000, duration_ms: 60000,
      skills: ['foo', 'bar'], builtin_commands: ['compact'],
      model: 'claude-opus-4', git_branch: 'main',
    },
    {
      tokens: { input: 200, cache_create: 30, cache_read: 60, output: 90 },
      tool_calls: 8, tool_errors: 0, file_size_bytes: 2000, duration_ms: 90000,
      skills: ['bar', 'baz'], builtin_commands: ['compact', 'review'],
      model: 'claude-opus-4', git_branch: 'feat',
    },
  ];
  const summary = buildProjectSummary('D--src-kaaroSessions', sessions);

  await t.test('sets correct label', () => {
    assert.equal(summary.label, 'kaaroSessions');
  });
  await t.test('reports correct session count', () => {
    assert.equal(summary.session_count, 2);
  });
  await t.test('aggregates input tokens', () => {
    assert.equal(summary.tokens.input, 300);
  });
  await t.test('aggregates output tokens', () => {
    assert.equal(summary.tokens.output, 170);
  });
  await t.test('aggregates tool calls', () => {
    assert.equal(summary.tool_calls, 13);
  });
  await t.test('aggregates tool errors', () => {
    assert.equal(summary.tool_errors, 1);
  });
  await t.test('deduplicates and sorts skills', () => {
    assert.deepEqual(summary.skills, ['bar', 'baz', 'foo']);
  });
  await t.test('deduplicates and sorts builtin_commands', () => {
    assert.deepEqual(summary.builtin_commands, ['compact', 'review']);
  });
  await t.test('deduplicates and sorts git branches', () => {
    assert.deepEqual(summary.git_branches, ['feat', 'main']);
  });
  await t.test('sums total bytes', () => {
    assert.equal(summary.total_bytes, 3000);
  });
  await t.test('sums duration', () => {
    assert.equal(summary.duration_ms, 150000);
  });
  await t.test('counts models', () => {
    assert.equal(summary.models['claude-opus-4'], 2);
  });
});

// ── buildGlobalRollup ─────────────────────────────────────────────────────────

test('buildGlobalRollup', async t => {
  const sessions = [
    {
      session_id: 's1',
      tokens: { input: 100, cache_create: 20, cache_read: 50, output: 80 },
      tool_errors: 1,
      tools: { Read: { calls: 3, errors: 0 }, Write: { calls: 1, errors: 0 } },
      skills: ['foo'],
      model: 'claude-opus-4',
      file_ops: { 'src/a.js': { read: 2, write: 1, edit: 0 } },
    },
    {
      session_id: 's2',
      tokens: { input: 200, cache_create: 30, cache_read: 60, output: 90 },
      tool_errors: 0,
      tools: { Read: { calls: 5, errors: 0 } },
      skills: ['foo', 'bar'],
      model: 'claude-sonnet-4-6',
      file_ops: { 'src/a.js': { read: 1, write: 0, edit: 2 } },
    },
  ];
  const rollup = buildGlobalRollup(sessions);

  await t.test('aggregates input tokens', () => {
    assert.equal(rollup.tokens.input, 300);
  });
  await t.test('aggregates output tokens', () => {
    assert.equal(rollup.tokens.output, 170);
  });
  await t.test('sums tool calls across sessions', () => {
    const read = rollup.tools.find(t => t.name === 'Read');
    assert.equal(read.calls, 8);
  });
  await t.test('counts skill occurrences', () => {
    const foo = rollup.skills.find(s => s.name === 'foo');
    assert.equal(foo.count, 2);
    const bar = rollup.skills.find(s => s.name === 'bar');
    assert.equal(bar.count, 1);
  });
  await t.test('sorts skills by count descending', () => {
    assert.equal(rollup.skills[0].name, 'foo');
  });
  await t.test('merges file read counts', () => {
    const f = rollup.files.find(f => f.path === 'src/a.js');
    assert.equal(f.read, 3);
  });
  await t.test('merges file write counts', () => {
    const f = rollup.files.find(f => f.path === 'src/a.js');
    assert.equal(f.write, 1);
  });
  await t.test('merges file edit counts', () => {
    const f = rollup.files.find(f => f.path === 'src/a.js');
    assert.equal(f.edit, 2);
  });
  await t.test('tracks contributing sessions per file', () => {
    const f = rollup.files.find(f => f.path === 'src/a.js');
    assert.deepEqual([...f.sessions].sort(), ['s1', 's2']);
  });
  await t.test('totals tool errors', () => {
    assert.equal(rollup.total_errors, 1);
  });
});
