/**
 * test/adapters/command-code.test.mjs → hooks/adapters/command-code.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToNormalized } from '../../hooks/adapters/command-code.mjs';
import { reconstructTraceFromNRs } from '../../hooks/trace-tree.mjs';

test('reasoning blocks map to content_block thinking (not raw reasoning)', () => {
  const nrs = recordsToNormalized([{
    id: 'a1', timestamp: 't1', sessionId: 's1', parentId: null,
    role: 'assistant', gitBranch: 'main',
    content: [
      { type: 'reasoning', text: 'planning the edit' },
      { type: 'text', text: 'I will open the file.' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: { absolutePath: '/a.mjs' } },
    ],
  }]);
  const blocks = nrs.filter(r => r.kind === 'content_block');
  assert.ok(blocks.some(b => b.block_type === 'thinking'), 'reasoning → thinking');
  assert.ok(!blocks.some(b => b.block_type === 'reasoning'), 'no raw reasoning block_type');
  assert.ok(blocks.some(b => b.block_type === 'tool_use'), 'tool-call → tool_use (duplicate of tool_use NR)');
  assert.ok(!blocks.some(b => b.block_type === 'tool-call'), 'no raw tool-call block_type');
  assert.ok(blocks.some(b => b.block_type === 'text' && b.text.includes('open the file')));

  const tree = reconstructTraceFromNRs(nrs);
  const asst = tree.segments[0].turns.find(t => t.role === 'assistant');
  assert.equal(asst.has_thinking, true);
  assert.equal(asst.text, 'I will open the file.');
  assert.equal(tree.segments[0].thinking_count, 1);
});

test('hybrid user text + tool-result keeps display_text', () => {
  const nrs = recordsToNormalized([{
    id: 'u2', timestamp: 't4', sessionId: 's1', parentId: 't1',
    role: 'user', gitBranch: 'feat/auth',
    content: [
      { type: 'text', text: 'Also add test coverage please' },
      { type: 'tool-result', toolCallId: 'call_1', toolName: 'read_file',
        output: { type: 'text', value: 'ok' } },
    ],
  }]);
  const ut = nrs.find(r => r.kind === 'user_turn');
  assert.equal(ut.display_text, 'Also add test coverage please');
  assert.ok(nrs.some(r => r.kind === 'tool_result' && r.tool_id === 'call_1'));
});

test('tool-result-only user carries no display_text', () => {
  const nrs = recordsToNormalized([{
    id: 'u3', timestamp: 't5', sessionId: 's1', parentId: 'a1',
    role: 'user', gitBranch: 'main',
    content: [
      { type: 'tool-result', toolCallId: 'c2', toolName: 'shell_command',
        output: { type: 'text', value: 'done' } },
    ],
  }]);
  const ut = nrs.find(r => r.kind === 'user_turn');
  assert.equal(ut.display_text, null);
});
