import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readGrokSession,
  parseGrokRecords,
  scanGrokSessions,
} from '../hooks/analyzers/analyze-grok.mjs';
import {
  decodeGrokCwd, deriveGrokProjectId, deriveGrokLabel,
} from '../hooks/helpers/grok-helpers.mjs';

test('decodeGrokCwd and project derivation', async t => {
  await t.test('decodes url-encoded Windows cwd', () => {
    assert.equal(decodeGrokCwd('D%3A%5Csrc%5CkaaroSessions'), 'D:\\src\\kaaroSessions');
  });
  await t.test('deriveGrokProjectId', () => {
    assert.equal(deriveGrokProjectId('D%3A%5Csrc%5CkaaroSessions'), 'D--src-kaaroSessions');
  });
  await t.test('deriveGrokLabel', () => {
    assert.equal(deriveGrokLabel('D%3A%5Csrc%5CkaaroSessions'), 'kaaroSessions');
  });
});

test('readGrokSession — multi-file read', () => {
  const root = join(tmpdir(), 'kaaro-grok-read-' + Date.now());
  const sessionDir = join(root, 'D%3A%5Csrc%5Cfoo', '019ea1c9-46ee-77e0-bf36-f87a6403b5db');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'updates.jsonl'),
    JSON.stringify({
      method: 'session/update',
      params: { update: { sessionUpdate: 'user_message_chunk', content: { text: 'hello world test message' } } },
      _meta: { agentTimestampMs: 1780831407026 },
    }) + '\n', 'utf8');
  writeFileSync(join(sessionDir, 'summary.json'), JSON.stringify({
    info: { cwd: 'D:\\src\\foo' },
    generated_title: 'Test session',
    current_model_id: 'grok-composer-2.5-fast',
    head_branch: 'main',
  }), 'utf8');
  writeFileSync(join(sessionDir, 'signals.json'), JSON.stringify({
    toolCallCount: 0, compactionCount: 0, contextTokensUsed: 100,
  }), 'utf8');
  try {
    const data = readGrokSession(sessionDir);
    assert.equal(data.records.length, 1);
    assert.equal(data.summary.generated_title, 'Test session');
    assert.equal(data.signals.contextTokensUsed, 100);
    assert.ok(data.sizeBytes > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanGrokSessions — discovers session under encoded cwd', () => {
  const root = join(tmpdir(), 'kaaro-grok-scan-' + Date.now());
  const sessionId = '019ea1c9-46ee-77e0-bf36-f87a6403b5db';
  const sessionDir = join(root, 'D%3A%5Csrc%5Cfoo', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'updates.jsonl'),
    JSON.stringify({
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'tool_call', title: 'Grep',
          toolCallId: 'tc1',
          rawInput: { pattern: 'foo', path: 'D:\\src\\foo' },
        },
      },
      _meta: { agentTimestampMs: 1780830790407 },
    }) + '\n', 'utf8');
  writeFileSync(join(sessionDir, 'summary.json'), JSON.stringify({
    info: { cwd: 'D:\\src\\foo' },
    generated_title: 'Scan test',
    current_model_id: 'grok-composer-2.5-fast',
  }), 'utf8');
  try {
    const result = scanGrokSessions(root);
    assert.equal(result.harness, 'grok');
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].session_id, sessionId);
    assert.equal(result.sessions[0].harness, 'grok');
    assert.equal(result.sessions[0].tool_calls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parseGrokRecords — empty updates returns zeroed session shell', () => {
  const session = parseGrokRecords([], 'sess-empty', 'D%3A%5Csrc%5Cfoo');
  assert.equal(session.user_turns, 0);
  assert.equal(session.tool_calls, 0);
  assert.equal(session.harness, 'grok');
});