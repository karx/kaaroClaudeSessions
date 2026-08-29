/**
 * test/adapters/codex.test.mjs -> hooks/adapters/codex.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToNormalized } from '../../hooks/adapters/codex.mjs';
import { reconstructTraceFromNRs } from '../../hooks/trace-tree.mjs';

test('Codex adapter maps messages, tools, results, and token counts', () => {
  const nrs = recordsToNormalized([
    {
      timestamp: '2026-08-21T19:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: '01abc',
        cwd: '/Users/vinayakarora/Documents/GitHub/kaaroSessions',
        cli_version: '0.148.0-alpha.9',
        git: { branch: 'main' },
      },
    },
    {
      timestamp: '2026-08-21T19:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Please make the sessions easier to hear' }],
      },
    },
    {
      timestamp: '2026-08-21T19:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'I will inspect the audio path.' }],
      },
    },
    {
      timestamp: '2026-08-21T19:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call_1',
        arguments: '{"cmd":"node --test","workdir":"/tmp/app"}',
      },
    },
    {
      timestamp: '2026-08-21T19:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'Process exited with code 1\nError: boom',
      },
    },
    {
      timestamp: '2026-08-21T19:00:05.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 10,
            output_tokens: 4,
            cached_input_tokens: 2,
            cache_write_input_tokens: 1,
          },
        },
      },
    },
  ]);

  assert.ok(nrs.some(r => r.kind === 'session_meta' && r.cwd?.endsWith('kaaroSessions')));
  assert.ok(nrs.some(r => r.kind === 'user_turn' && r.text === 'Please make the sessions easier to hear'));
  assert.ok(nrs.some(r => r.kind === 'assistant_turn' && r.model === null));
  assert.ok(nrs.some(r => r.kind === 'content_block' && r.block_type === 'text' && r.text.includes('audio path')));
  assert.ok(nrs.some(r => r.kind === 'tool_use' && r.tool === 'exec_command' && r.input.command === 'node --test'));
  assert.ok(nrs.some(r => r.kind === 'tool_result' && r.tool_id === 'call_1' && r.error === true));
  assert.ok(nrs.some(r => r.kind === 'tokens' && r.tokens.input === 0 && r.tokens.output === 4 && r.tokens.cache_read === 0));

  const tree = reconstructTraceFromNRs(nrs);
  assert.equal(tree.segments[0].turns.some(t => t.role === 'assistant' && t.text.includes('audio path')), true);
});

test('Codex adapter ignores cumulative token totals as per-event signal', () => {
  const nrs = recordsToNormalized([{
    timestamp: '2026-08-21T19:00:05.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 999999,
          output_tokens: 999999,
          cached_input_tokens: 999999,
          cache_write_input_tokens: 999999,
        },
      },
    },
  }]);

  assert.equal(nrs.some(r => r.kind === 'tokens'), false);
});

test('Codex adapter categorizes real CLI shell_command tool name as bash (git)', () => {
  // Real local Codex CLI (v0.147.0+) emits function_call name "shell_command",
  // not "exec_command" — verified against live ~/.codex rollout transcripts.
  const nrs = recordsToNormalized([
    {
      timestamp: '2026-08-29T10:49:30.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        call_id: 'call_1',
        arguments: '{"command":"git status --short --branch","workdir":"D:\\\\src\\\\x"}',
      },
    },
  ]);

  const toolUse = nrs.find(r => r.kind === 'tool_use');
  assert.equal(toolUse.tool, 'shell_command');
  assert.equal(toolUse.category, 'git');
});

test('Codex adapter populates user_turn text on every qualifying turn, not just the first', () => {
  const nrs = recordsToNormalized([
    {
      timestamp: '2026-08-29T10:49:21.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'First prompt here' }] },
    },
    {
      timestamp: '2026-08-29T10:55:59.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Second prompt here too' }] },
    },
  ]);

  const userTurns = nrs.filter(r => r.kind === 'user_turn');
  assert.equal(userTurns.length, 2);
  assert.equal(userTurns[0].text, 'First prompt here');
  assert.equal(userTurns[1].text, 'Second prompt here too');
});
