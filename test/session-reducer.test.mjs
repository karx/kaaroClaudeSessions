import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceSession } from '../lib/session-reducer.mjs';

const META = {
  session_id:      'sess-uuid-1234',
  project_id:      'D--src-foo',
  project_label:   'foo',
  harness:         'claude-code',
  file_size_bytes: 1024,
  capabilities:    { size_proxy: 'tokens_work' },
};

const TS1 = '2026-05-01T10:00:00.000Z';
const TS2 = '2026-05-01T10:05:00.000Z';

test('reduceSession — user and assistant turn counts', () => {
  const s = reduceSession([
    { kind: 'user_turn', harness: 'claude-code', ts: TS1, text: 'fix the bug please' },
    { kind: 'assistant_turn', harness: 'claude-code', ts: TS2, model: 'claude-sonnet-4-6' },
  ], META);
  assert.equal(s.user_turns, 1);
  assert.equal(s.assistant_turns, 1);
  assert.equal(s.first_timestamp, TS1);
  assert.equal(s.last_timestamp, TS2);
});

test('reduceSession — content_block kind populates map without affecting turn counts', () => {
  const s = reduceSession([
    { kind: 'assistant_turn', harness: 'claude-code', ts: TS1 },
    { kind: 'content_block', harness: 'claude-code', ts: TS1, block_type: 'text' },
    { kind: 'content_block', harness: 'claude-code', ts: TS1, block_type: 'tool_use' },
    { kind: 'content_block', harness: 'claude-code', ts: TS1, block_type: 'thinking' },
    { kind: 'content_block', harness: 'claude-code', ts: TS1, block_type: 'tool_use' },
  ], META);
  assert.equal(s.assistant_turns, 1, 'content_block must not increment assistant_turns');
  assert.deepEqual(s.content_blocks, { text: 1, tool_use: 2, thinking: 1 });
});

test('reduceSession — tool_use and file_ops', () => {
  const s = reduceSession([
    { kind: 'tool_use', harness: 'claude-code', ts: TS1, tool: 'Read',
      input: { file_path: 'D:/src/foo.js' } },
    { kind: 'tool_use', harness: 'claude-code', ts: TS1, tool: 'Write',
      input: { file_path: 'D:/src/foo.js' } },
    { kind: 'tool_use', harness: 'claude-code', ts: TS1, tool: 'Bash',
      input: { command: 'git status' } },
  ], META);
  assert.equal(s.tool_calls, 3);
  assert.equal(s.tools.Read.calls, 1);
  assert.equal(s.file_ops['d:/src/foo.js'].read, 1);
  assert.equal(s.file_ops['d:/src/foo.js'].write, 1);
  assert.equal(s.bash_categories.git, 1);
});

test('reduceSession — tokens accumulation', () => {
  const s = reduceSession([
    { kind: 'tokens', harness: 'claude-code', ts: TS1,
      tokens: { input: 10, output: 20, cache_create: 5, cache_read: 3 } },
    { kind: 'tokens', harness: 'claude-code', ts: TS2,
      tokens: { input: 1, output: 2, cache_create: 0, cache_read: 7 } },
  ], META);
  assert.equal(s.tokens.input, 11);
  assert.equal(s.tokens.output, 22);
  assert.equal(s.tokens.cache_create, 5);
  assert.equal(s.tokens.cache_read, 10);
});

test('reduceSession — context_reset and ai_title', () => {
  const s = reduceSession([
    { kind: 'context_reset', harness: 'claude-code', ts: TS1 },
    { kind: 'context_reset', harness: 'claude-code', ts: TS2 },
    { kind: 'session_meta', harness: 'claude-code', ts: TS1, ai_title: 'Fix parser' },
  ], META);
  assert.equal(s.context_resets, 2);
  assert.equal(s.ai_title, 'Fix parser');
});

test('reduceSession — subagent_count from Agent tool', () => {
  const s = reduceSession([
    { kind: 'tool_use', harness: 'claude-code', ts: TS1, tool: 'Agent', input: {} },
    { kind: 'tool_use', harness: 'claude-code', ts: TS1, tool: 'Agent', input: {} },
  ], META);
  assert.equal(s.subagent_count, 2);
});

test('reduceSession — branches deduped', () => {
  const s = reduceSession([
    { kind: 'branch_change', harness: 'claude-code', ts: TS1, branch: 'main' },
    { kind: 'branch_change', harness: 'claude-code', ts: TS2, branch: 'feature' },
    { kind: 'branch_change', harness: 'claude-code', ts: TS2, branch: 'main' },
  ], META);
  assert.deepEqual(s.branches, ['main', 'feature']);
  assert.equal(s.git_branch, 'main');
});

test('reduceSession — skills and builtin_commands', () => {
  const s = reduceSession([
    { kind: 'skill_invoke', harness: 'claude-code', ts: TS1, skill: 'visualize-seed' },
    { kind: 'skill_invoke', harness: 'claude-code', ts: TS1, skill: 'compact' },
    { kind: 'skill_invoke', harness: 'claude-code', ts: TS1, skill: 'visualize-seed' },
  ], META);
  assert.deepEqual(s.skills, ['visualize-seed']);
  assert.deepEqual(s.builtin_commands, ['compact']);
});

test('reduceSession — tool_result errors', () => {
  const s = reduceSession([
    { kind: 'tool_result', harness: 'claude-code', ts: TS1, error: true, tool: 'Bash' },
  ], META);
  assert.equal(s.tool_errors, 1);
});

test('reduceSession — tokenless harness sets size_proxy', () => {
  const s = reduceSession([
    { kind: 'tool_use', harness: 'antigravity', ts: TS1, tool: 'view_file', input: {} },
    { kind: 'tool_use', harness: 'antigravity', ts: TS1, tool: 'view_file', input: {} },
  ], { ...META, harness: 'antigravity', capabilities: { size_proxy: 'tool_calls' } });
  assert.equal(s.size_proxy, 'tool_calls');
  assert.equal(s.tokens.output, 0);
});

test('reduceSession — first_user_message from user_turn', () => {
  const s = reduceSession([
    { kind: 'user_turn', harness: 'claude-code', ts: TS1,
      text: 'Please refactor the session reducer module' },
  ], META);
  assert.equal(s.first_user_message, 'Please refactor the session reducer module');
});

test('reduceSession — session_meta slug and duration', () => {
  const s = reduceSession([
    { kind: 'session_meta', harness: 'claude-code', ts: TS1,
      slug: 'happy-slug', duration_ms: 60000, message_count: 4 },
  ], META);
  assert.equal(s.slug, 'happy-slug');
  assert.equal(s.duration_ms, 60000);
  assert.equal(s.message_count, 4);
});

test('reduceSession — slug fallback to session_id prefix', () => {
  const s = reduceSession([], META);
  assert.equal(s.slug, 'sess-uui');
});