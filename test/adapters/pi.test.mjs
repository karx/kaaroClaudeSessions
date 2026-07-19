import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToNormalized } from '../../hooks/adapters/pi.mjs';
import { reduceSession } from '../../hooks/session-reducer.mjs';
import { enrichSession } from '../../hooks/enrich-session.mjs';
import { parsePiRecords, derivePiLabel } from '../../hooks/analyzers/analyze-pi.mjs';

const SESSION_ID = '019dca2b-f4f5-7609-96ae-fe883f7a03db';
const PROJECT_ID = '--D--src-ebrain--';

const GOLDEN_RECORDS = [
  {
    type: 'session', version: 3, id: SESSION_ID,
    timestamp: '2026-04-26T14:22:51.638Z', cwd: 'D:\\src\\ebrain',
  },
  {
    type: 'model_change', id: 'mc01', timestamp: '2026-04-26T14:22:52.000Z',
    provider: 'openai', modelId: 'gpt-5.4',
  },
  {
    type: 'message', id: 'u01', timestamp: '2026-04-26T14:23:00.000Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'setup pi to leverage a new LLM provider' }],
    },
  },
  {
    type: 'message', id: 'a01', timestamp: '2026-04-26T14:23:05.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc01', name: 'read', arguments: { path: 'D:/src/ebrain/foo.js' } },
        { type: 'toolCall', id: 'tc02', name: 'bash', arguments: { command: 'git status' } },
      ],
      provider: 'google-antigravity',
      model: 'gemini-3.1-pro-low',
      usage: { input: 100, output: 40, cacheRead: 10, cacheWrite: 5 },
      stopReason: 'toolUse',
    },
  },
];

test('recordsToNormalized — emits expected kinds', () => {
  const norm = recordsToNormalized(GOLDEN_RECORDS);
  const kinds = norm.map(r => r.kind);
  assert.ok(kinds.includes('session_meta'));
  assert.ok(kinds.includes('user_turn'));
  assert.ok(kinds.includes('assistant_turn'));
  assert.ok(kinds.includes('tokens'));
  assert.ok(kinds.filter(k => k === 'tool_use').length >= 2);
});

test('tool_use NR has category for bash tools; key is NOT set by adapter', () => {
  const records = [{
    type: 'message', id: 'a01', timestamp: '2026-06-09T10:00:00.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tc01', name: 'read', arguments: { path: 'a.mjs' } },
        { type: 'toolCall', id: 'tc02', name: 'bash', arguments: { command: 'git status' } },
        { type: 'toolCall', id: 'tc03', name: 'bash', arguments: { command: 'npm install' } },
      ],
    },
  }];
  const nrs = recordsToNormalized(records).filter(r => r.kind === 'tool_use');
  assert.equal(nrs[0].category, null);       // read — not bash
  assert.equal(nrs[1].category, 'git');       // bash + git status
  assert.equal(nrs[2].category, 'npm'); // bash + npm install
  // Sonic key is NOT derived by adapters
  assert.equal(nrs[0].key, undefined);
  assert.equal(nrs[1].key, undefined);
});

test('assistant text + thinking blocks → content_block NRs for thr-turn-text', () => {
  const records = [{
    type: 'message', id: 'a02', timestamp: '2026-06-09T10:00:00.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'plan the approach' },
        { type: 'text', text: 'I will update the provider config next.' },
        { type: 'toolCall', id: 'tc01', name: 'read', arguments: { path: 'models.json' } },
      ],
      stopReason: 'toolUse',
    },
  }];
  const nrs = recordsToNormalized(records);
  const blocks = nrs.filter(r => r.kind === 'content_block');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].block_type, 'thinking');
  assert.equal(blocks[1].block_type, 'text');
  assert.equal(blocks[1].text, 'I will update the provider config next.');
  const tool = nrs.find(r => r.kind === 'tool_use');
  assert.equal(tool.tool, 'read');
  assert.equal(tool.tool_id, 'tc01');
});

test('thinking_level_change → mode_shift NR, not unknown_record', () => {
  const records = [
    { type: 'thinking_level_change', id: '4dfee7f7', parentId: null,
      timestamp: '2026-07-09T17:33:20.083Z', thinkingLevel: 'medium' },
  ];
  const nrs = recordsToNormalized(records);
  assert.equal(nrs.length, 1);
  assert.equal(nrs[0].kind, 'mode_shift');
  assert.equal(nrs[0].harness, 'pi');
  assert.equal(nrs[0].ts, '2026-07-09T17:33:20.083Z');
  assert.equal(nrs[0].mode, 'thinking:medium');
});

test('unknown_record emitted for unrecognised record types', () => {
  const records = [
    { type: 'some_future_type', timestamp: '2026-06-09T10:00:00.000Z' },
  ];
  const nrs = recordsToNormalized(records);
  const unknowns = nrs.filter(r => r.kind === 'unknown_record');
  assert.equal(unknowns.length, 1);
  assert.equal(unknowns[0].raw_type, 'some_future_type');
  assert.equal(unknowns[0].harness, 'pi');
});

test('adapter + reducer golden regression matches parsePiRecords', () => {
  const viaParse = parsePiRecords(GOLDEN_RECORDS, SESSION_ID, PROJECT_ID);
  enrichSession(viaParse);
  const viaPipeline = reduceSession(recordsToNormalized(GOLDEN_RECORDS), {
    session_id:      SESSION_ID,
    project_id:      PROJECT_ID,
    project_label:   derivePiLabel(PROJECT_ID),
    harness:         'pi',
    capabilities:    { size_proxy: 'tokens_work' },
  });
  enrichSession(viaPipeline);

  const fields = [
    'session_id', 'project_id', 'project_label', 'harness', 'cwd', 'model',
    'user_turns', 'assistant_turns', 'tool_calls', 'slug', 'message_count',
    'tokens', 'tools', 'file_ops', 'bash_categories', 'stop_reasons',
    'first_user_message', 'first_timestamp', 'last_timestamp',
  ];
  for (const f of fields) {
    assert.deepEqual(viaParse[f], viaPipeline[f], `mismatch on ${f}`);
  }
});