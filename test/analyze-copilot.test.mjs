/**
 * test/analyze-copilot.test.mjs → analyze-copilot.mjs
 *
 * Temp VS Code workspaceStorage tree: <hash>/workspace.json +
 * <hash>/chatSessions/*.jsonl|*.json + state.vscdb (real SQLite via node:sqlite).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readCopilotSession,
  analyzeCopilotSession,
  scanCopilotSessions,
  readChatSessionIndex,
  workspaceFolderPath,
} from '../hooks/analyzers/analyze-copilot.mjs';

let root;
const WS = 'e07ec4b76ec1cba51ba84e69683d85e4';
const SES_LIVE = '052d579c-9e9f-4c40-989b-b6923159f2dd';
const SES_OLD  = '1b583887-c3b9-4af6-906e-7a3b85131b0c';

const T_CREATE = 1779124637563;
const T_REQ    = 1780942410161;

function opLines(ops) { return ops.map(o => JSON.stringify(o)).join('\n') + '\n'; }

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-ws-'));
  const wsDir = path.join(root, WS);
  fs.mkdirSync(path.join(wsDir, 'chatSessions'), { recursive: true });

  fs.writeFileSync(path.join(wsDir, 'workspace.json'),
    JSON.stringify({ folder: 'file:///d%3A/src/kaaroSessions' }), 'utf8');

  fs.writeFileSync(path.join(wsDir, 'chatSessions', `${SES_LIVE}.jsonl`), opLines([
    { kind: 0, v: { version: 3, sessionId: SES_LIVE, creationDate: T_CREATE, requests: [] } },
    { kind: 2, k: ['requests'], v: [{
      requestId: 'r1', timestamp: T_REQ, modelId: 'copilot/oswe-vscode-prime',
      message: { text: 'What is the ontology used here?' }, response: [],
    }] },
    { kind: 2, k: ['requests', 0, 'response'], v: [{
      kind: 'toolInvocationSerialized', toolId: 'copilot_readFile', toolCallId: 'c1',
      invocationMessage: { value: 'Reading [](file:///d%3A/src/kaaroSessions/README.md)',
        uris: { 'file:///d%3A/src/kaaroSessions/README.md': { path: '/d:/src/kaaroSessions/README.md', scheme: 'file' } } },
    }] },
    { kind: 1, k: ['requests', 0, 'completionTokens'], v: 1092 },
    { kind: 1, k: ['customTitle'], v: 'Ontology Q&A' },
  ]), 'utf8');

  fs.writeFileSync(path.join(wsDir, 'chatSessions', `${SES_OLD}.json`), JSON.stringify({
    version: 3, sessionId: SES_OLD, creationDate: T_CREATE,
    lastMessageDate: T_REQ, customTitle: 'Old chat',
    requests: [{ requestId: 'r1', timestamp: T_REQ, message: { text: 'hello from the old format' }, response: [] }],
  }), 'utf8');

  // junk that must be skipped
  fs.writeFileSync(path.join(wsDir, 'chatSessions', 'notes.txt'), 'noise', 'utf8');

  // workspace without chatSessions
  fs.mkdirSync(path.join(root, 'aaaa0000'), { recursive: true });
  fs.writeFileSync(path.join(root, 'aaaa0000', 'workspace.json'),
    JSON.stringify({ folder: 'file:///c%3A/other' }), 'utf8');
});

after(() => { fs.rmSync(root, { recursive: true, force: true }); });

// ── workspace attribution ─────────────────────────────────────────────────────

test('workspaceFolderPath — decodes folder URI; null when absent', () => {
  assert.equal(workspaceFolderPath({ folder: 'file:///d%3A/src/kaaroSessions' }), 'd:/src/kaaroSessions');
  assert.equal(workspaceFolderPath({}), null);
  assert.equal(workspaceFolderPath(null), null);
});

// ── readCopilotSession ────────────────────────────────────────────────────────

test('readCopilotSession — jsonl op-log → ops; json dump → wrapped', () => {
  const live = readCopilotSession(path.join(root, WS, 'chatSessions', `${SES_LIVE}.jsonl`));
  assert.equal(live.records.length, 5);
  assert.equal(live.records[0].kind, 0);

  const old = readCopilotSession(path.join(root, WS, 'chatSessions', `${SES_OLD}.json`));
  assert.equal(old.records.length, 1);
  assert.equal(old.records[0].customTitle, 'Old chat');
});

test('readCopilotSession — throws (not crashes) on a file over the size cap, instead of reading it into memory', () => {
  const fp = path.join(root, WS, 'chatSessions', `${SES_LIVE}.jsonl`);
  assert.throws(() => readCopilotSession(fp, { maxBytes: 4 }), /too large/i);
});

// ── analyzeCopilotSession ─────────────────────────────────────────────────────

test('analyzeCopilotSession — canonical session shape', () => {
  const session = analyzeCopilotSession(
    path.join(root, WS, 'chatSessions', `${SES_LIVE}.jsonl`),
    { project_id: 'D--src-kaaroSessions', project_label: 'kaaroSessions' },
  );
  assert.equal(session.session_id, SES_LIVE);
  assert.equal(session.harness, 'copilot');
  assert.equal(session.source, 'copilot');
  assert.equal(session.project_id, 'D--src-kaaroSessions');
  assert.equal(session.slug, '052d579c');
  assert.equal(session.ai_title, 'Ontology Q&A');
  assert.equal(session.user_turns, 1);
  assert.equal(session.tool_calls, 1);
  assert.equal(session.tokens.output, 1092);
  assert.equal(session.model, 'copilot/oswe-vscode-prime');
  assert.ok(session.first_timestamp);
  assert.ok(session.file_size_bytes > 0);
});

// ── scan ──────────────────────────────────────────────────────────────────────

test('scanCopilotSessions — both formats found, junk + empty workspaces skipped', () => {
  const result = scanCopilotSessions(root);
  assert.equal(result.harness, 'copilot');
  assert.equal(result.sessions.length, 2);
  const ids = result.sessions.map(s => s.session_id).sort();
  assert.deepEqual(ids, [SES_LIVE, SES_OLD].sort());
  const live = result.sessions.find(s => s.session_id === SES_LIVE);
  assert.equal(live.project_label, 'kaaroSessions'); // from workspace.json
});

test('scanCopilotSessions — null when root missing', () => {
  assert.equal(scanCopilotSessions(path.join(root, 'nope')), null);
});

// ── SQLite session index (node:sqlite, optional) ──────────────────────────────

test('readChatSessionIndex — reads entries from a real state.vscdb', async () => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { return; } // environment without node:sqlite — enrichment is optional by design

  const dbPath = path.join(root, WS, 'state.vscdb');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
    'chat.ChatSessionStore.index',
    JSON.stringify({ version: 1, entries: {
      [SES_LIVE]: { sessionId: SES_LIVE, title: 'Indexed Title', lastMessageDate: T_REQ, isEmpty: false },
      'dead-beef': { sessionId: 'dead-beef', title: 'New Chat', isEmpty: true },
    } }),
  );
  db.close();

  const idx = readChatSessionIndex(dbPath);
  assert.equal(idx[SES_LIVE].title, 'Indexed Title');
  assert.equal(idx['dead-beef'].isEmpty, true);
});

test('readChatSessionIndex — graceful {} when db missing or unreadable', () => {
  assert.deepEqual(readChatSessionIndex(path.join(root, 'no.vscdb')), {});
});
