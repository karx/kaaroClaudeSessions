/**
 * test/analyze-codex.test.mjs -> hooks/analyzers/analyze-codex.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  analyzeCodexSession,
  readCodexSessionIndex,
  scanCodexSessions,
} from '../hooks/analyzers/analyze-codex.mjs';

let root;
const SESSION_ID = '01abc000-0000-7000-8000-000000000001';

function jsonl(records) {
  return records.map(r => JSON.stringify(r)).join('\n') + '\n';
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sessions-'));
  const dayDir = path.join(root, 'sessions', '2026', '08', '21');
  fs.mkdirSync(dayDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), jsonl([
    { id: SESSION_ID, thread_name: 'Make Kaarosessions audible', updated_at: '2026-08-21T19:00:00Z' },
  ]), 'utf8');
  fs.writeFileSync(path.join(dayDir, `rollout-2026-08-21T20-02-32-${SESSION_ID}.jsonl`), jsonl([
    {
      timestamp: '2026-08-21T19:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: SESSION_ID,
        cwd: '/Users/vinayakarora/Documents/GitHub/kaaroSessions',
        cli_version: '0.148.0-alpha.9',
        model: 'gpt-5.5',
        git: { branch: 'main' },
      },
    },
    {
      timestamp: '2026-08-21T19:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Make this visible and audible' }],
      },
    },
    {
      timestamp: '2026-08-21T19:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call_1',
        arguments: '{"cmd":"git status","workdir":"/Users/vinayakarora/Documents/GitHub/kaaroSessions"}',
      },
    },
  ]), 'utf8');
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('readCodexSessionIndex returns latest title by session id', () => {
  const index = readCodexSessionIndex(path.join(root, 'session_index.jsonl'));
  assert.equal(index[SESSION_ID].thread_name, 'Make Kaarosessions audible');
});

test('analyzeCodexSession produces canonical session shape with index title', () => {
  const filePath = path.join(root, 'sessions', '2026', '08', '21', `rollout-2026-08-21T20-02-32-${SESSION_ID}.jsonl`);
  const session = analyzeCodexSession(filePath, {
    root,
    titleIndex: readCodexSessionIndex(path.join(root, 'session_index.jsonl')),
  });

  assert.equal(session.session_id, SESSION_ID);
  assert.equal(session.harness, 'codex');
  assert.equal(session.source, 'codex');
  assert.equal(session.project_label, 'kaaroSessions');
  assert.equal(session.ai_title, 'Make Kaarosessions audible');
  assert.equal(session.user_turns, 1);
  assert.equal(session.tool_calls, 1);
  assert.equal(session.git_branch, 'main');
  assert.ok(session.file_size_bytes > 0);
});

test('scanCodexSessions walks dated rollout tree and skips non-session jsonl', () => {
  const result = scanCodexSessions(root);
  assert.equal(result.harness, 'codex');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].session_id, SESSION_ID);
});

test('scanCodexSessions returns null when root is missing', () => {
  assert.equal(scanCodexSessions(path.join(root, 'missing')), null);
});
