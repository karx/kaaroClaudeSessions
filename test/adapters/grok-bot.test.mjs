/**
 * test/adapters/grok-bot.test.mjs → hooks/adapters/grok-bot.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToNormalized } from '../../hooks/adapters/grok-bot.mjs';
import { reconstructTraceFromNRs } from '../../hooks/trace-tree.mjs';
import { reduceSession } from '../../hooks/session-reducer.mjs';
import { validateNormalizedRecord } from '../../hooks/normalized-record.mjs';

const GOLDEN = [
  {"role":"user","message":{"content":[{"type":"text","text":"Check D:/src/kaaroSessions and add grok-bot harness support"}]}},
  {"role":"assistant","message":{"content":[{"type":"text","text":"Looking at the harness layout first."}]}},
  {"role":"assistant","message":{"content":[{"type":"tool_use","name":"send_message","input":{"text":{"content":"On it. Looking at kaaroSessions first."}}}]}},
  {"role":"tool","message":{"content":[{"type":"tool_result","name":"send_message","result":{"success":{"timestamp":"1787860893175","messageId":"t0s0"}}}]}},
  {"role":"assistant","message":{"content":[{"type":"tool_use","name":"shell","input":{"command":"git status -sb","workingDirectory":"D:/src/kaaroSessions","description":"Check git status"}}]}},
  {"role":"tool","message":{"content":[{"type":"tool_result","name":"shell","result":{"success":{"command":"git status -sb","workingDirectory":"D:/src/kaaroSessions","stdout":"## kaaro/feat/add-grok-bot","executionTime":200},"isBackground":false}}]}},
  {"role":"assistant","message":{"content":[{"type":"tool_use","name":"read","input":{"path":"docs/harnesses.md"}}]}},
  {"role":"tool","message":{"content":[{"type":"tool_result","name":"read","result":{"error":{"errorMessage":"Path is outside the allowed local-exec root"}}}]}},
];

function kinds(nrs) {
  return nrs.map(r => r.kind);
}

test('golden session — send_message is visible text, scratchpad is thinking', () => {
  const nrs = recordsToNormalized(GOLDEN);
  for (const nr of nrs) {
    const { ok, errors } = validateNormalizedRecord(nr);
    assert.ok(ok, `${nr.kind}: ${errors.join('; ')}`);
    assert.equal(nr.harness, 'grok-bot');
  }

  const ut = nrs.find(r => r.kind === 'user_turn');
  assert.ok(ut.display_text.includes('add grok-bot harness support'));
  assert.ok(ut.text.includes('add grok-bot harness support'));

  assert.equal(nrs.filter(r => r.kind === 'assistant_turn').length, 1,
    'one assistant_turn per burst, not one per scratchpad line');

  const thinking = nrs.filter(r => r.kind === 'content_block' && r.block_type === 'thinking');
  assert.equal(thinking.length, 1);
  assert.ok(thinking[0].text.includes('harness layout'));

  const text = nrs.filter(r => r.kind === 'content_block' && r.block_type === 'text');
  assert.equal(text.length, 1);
  assert.equal(text[0].text, 'On it. Looking at kaaroSessions first.');

  assert.ok(!nrs.some(r => r.kind === 'tool_use' && r.tool === 'send_message'),
    'send_message is not a tool_use');
  assert.ok(!nrs.some(r => r.kind === 'tool_result' && r.tool === 'send_message'));

  const shell = nrs.find(r => r.kind === 'tool_use' && r.tool === 'shell');
  assert.equal(shell.category, 'git');
  assert.equal(shell.input.command, 'git status -sb');

  const read = nrs.find(r => r.kind === 'tool_use' && r.tool === 'read');
  assert.equal(read.input.path, 'docs/harnesses.md');
  assert.equal(read.input.file_path, 'docs/harnesses.md');

  const err = nrs.find(r => r.kind === 'tool_result' && r.tool === 'read');
  assert.equal(err.error, true);
  assert.ok(err.error_text.includes('outside the allowed local-exec root'));

  const iso = new Date(Number('1787860893175')).toISOString();
  const withTs = nrs.filter(r => r.ts);
  assert.ok(withTs.length >= 1, 'send_message result timestamp is carried forward');
  assert.ok(withTs.every(r => r.ts === iso), `expected ISO ${iso}, got ${withTs.map(r => r.ts).join(',')}`);
});

test('golden session — reducer stats and trace text', () => {
  const nrs = recordsToNormalized(GOLDEN);
  const session = reduceSession(nrs, {
    session_id: 'golden', project_id: 'grok-bot', project_label: 'Grok Bot',
    harness: 'grok-bot', capabilities: { size_proxy: 'tool_calls' },
  });
  assert.equal(session.user_turns, 1);
  assert.equal(session.assistant_turns, 1);
  assert.equal(session.tool_calls, 2);
  assert.equal(session.tool_errors, 1);
  assert.equal(session.tools.shell.calls, 1);
  assert.equal(session.tools.read.calls, 1);
  assert.equal(session.bash_categories.git, 1);
  assert.equal(session.file_ops['docs/harnesses.md']?.read, 1);
  assert.equal(session.subagent_count, 0);
  assert.equal(session.context_resets, 0);

  const tree = reconstructTraceFromNRs(nrs);
  const asst = tree.segments[0].turns.find(t => t.role === 'assistant');
  assert.equal(asst.has_thinking, true);
  assert.equal(asst.text, 'On it. Looking at kaaroSessions first.');
  assert.ok(asst.tool_calls.some(t => t.name === 'shell'));
  assert.ok(asst.tool_calls.some(t => t.name === 'read'));
});

test('hidden [SAND_HIDDEN_PROMPT] is still a user_turn with no display_text', () => {
  const nrs = recordsToNormalized([
    { role: 'user', message: { content: [{ type: 'text', text: '[SAND_HIDDEN_PROMPT][first run] secret chrome' }] } },
    { role: 'user', message: { content: [{ type: 'text', text: 'Check D:/src/kaaroSessions please' }] } },
  ]);
  const users = nrs.filter(r => r.kind === 'user_turn');
  assert.equal(users.length, 2);
  assert.equal(users[0].display_text, null);
  assert.equal(users[0].text, null);
  assert.equal(users[1].display_text, 'Check D:/src/kaaroSessions please');
  assert.equal(users[1].text, 'Check D:/src/kaaroSessions please');
});

test('communicate_update is skipped as pulse noise', () => {
  const nrs = recordsToNormalized([
    { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'communicate_update', input: { currentStep: 'scanning' } }] } },
    { role: 'tool', message: { content: [{ type: 'tool_result', name: 'communicate_update', result: { success: { currentStep: 'scanning' } } }] } },
    { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'send_message', input: { text: { content: 'Still looking.' } } }] } },
  ]);
  assert.deepEqual(kinds(nrs), ['assistant_turn', 'content_block']);
  assert.equal(nrs[1].block_type, 'text');
  assert.equal(nrs[1].text, 'Still looking.');
});

test('rejected tool_result maps to error', () => {
  const nrs = recordsToNormalized([
    { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'shell', input: { command: 'git status' } }] } },
    { role: 'tool', message: { content: [{ type: 'tool_result', name: 'shell', result: { rejected: true } }] } },
  ]);
  const tr = nrs.find(r => r.kind === 'tool_result');
  assert.equal(tr.error, true);
  assert.equal(tr.tool, 'shell');
});

test('unknown role becomes unknown_record', () => {
  const nrs = recordsToNormalized([{ role: 'system', message: { content: [] } }]);
  assert.equal(nrs[0].kind, 'unknown_record');
  assert.equal(nrs[0].raw_type, 'system');
});