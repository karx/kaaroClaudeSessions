/**
 * test/analyze-opencode.test.mjs → analyze-opencode.mjs
 *
 * Builds a temp opencode storage tree (session/message/part) mirroring the
 * real layout and verifies read → analyze → scan.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readOpencodeSession,
  analyzeOpencodeSession,
  scanOpencodeSessions,
} from '../hooks/analyzers/analyze-opencode.mjs';

let root; // temp storage root

const SES_ID = 'ses_4a89582bbffe03xj4Y14Qtss1q';
const MSG_USER = 'msg_b5769137e0018PLt3AfBg4hv1C';
const MSG_ASST = 'msg_b5769c31f001Wjs4cv4KuecGOU';

function writeJson(rel, obj) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-storage-'));

  writeJson(`session/global/${SES_ID}.json`, {
    id: SES_ID,
    version: '1.0.201',
    projectID: 'global',
    directory: 'D:\\src\\demo',
    title: 'Demo Session',
    time: { created: 1766698000000, updated: 1766698200000 },
  });

  writeJson(`message/${SES_ID}/${MSG_USER}.json`, {
    id: MSG_USER, sessionID: SES_ID, role: 'user',
    time: { created: 1766698062733 },
  });
  writeJson(`message/${SES_ID}/${MSG_ASST}.json`, {
    id: MSG_ASST, sessionID: SES_ID, role: 'assistant',
    time: { created: 1766698107679, completed: 1766698137064 },
    modelID: 'glm-4.7-free', providerID: 'opencode', finish: 'stop',
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 30, write: 20 } },
  });

  writeJson(`part/${MSG_USER}/prt_a.json`, {
    id: 'prt_a', sessionID: SES_ID, messageID: MSG_USER,
    type: 'text', text: 'please fix the build script',
  });
  writeJson(`part/${MSG_ASST}/prt_b.json`, {
    id: 'prt_b', sessionID: SES_ID, messageID: MSG_ASST,
    type: 'tool', callID: 'call_1', tool: 'read',
    state: {
      status: 'completed',
      input: { filePath: 'D:\\src\\demo\\build.mjs' },
      output: 'file contents', title: 'build.mjs',
      time: { start: 1766698110000, end: 1766698110050 },
    },
  });

  // noise that the scanner must ignore
  writeJson('project/global.json', { id: 'global', worktree: 'D:\\src\\demo' });
  fs.writeFileSync(path.join(root, 'migration'), '5', 'utf8');
});

after(() => { fs.rmSync(root, { recursive: true, force: true }); });

// ── readOpencodeSession ───────────────────────────────────────────────────────

test('readOpencodeSession — info + messages ordered, parts embedded', () => {
  const infoPath = path.join(root, 'session', 'global', `${SES_ID}.json`);
  const { info, records, sizeBytes } = readOpencodeSession(root, infoPath);

  assert.equal(info.id, SES_ID);
  assert.equal(records.length, 3); // info + 2 messages
  assert.equal(records[1].role, 'user');             // ordered by time.created
  assert.equal(records[2].role, 'assistant');
  assert.equal(records[1]._parts.length, 1);
  assert.equal(records[2]._parts[0].tool, 'read');
  assert.ok(sizeBytes > 0);
});

// ── analyzeOpencodeSession ────────────────────────────────────────────────────

test('analyzeOpencodeSession — canonical session shape', () => {
  const infoPath = path.join(root, 'session', 'global', `${SES_ID}.json`);
  const session = analyzeOpencodeSession(root, infoPath);

  assert.equal(session.session_id, SES_ID);
  assert.equal(session.harness, 'opencode');
  assert.equal(session.source, 'opencode');
  assert.equal(session.project_id, 'D--src-demo');     // unifies with CC project ids
  assert.equal(session.project_label, 'demo');
  assert.equal(session.slug, '4a89582b');              // ses_ prefix stripped
  assert.equal(session.ai_title, 'Demo Session');
  assert.equal(session.cwd, 'D:\\src\\demo');
  assert.equal(session.user_turns, 1);
  assert.equal(session.assistant_turns, 1);
  assert.equal(session.tool_calls, 1);
  assert.deepEqual(session.tokens, { input: 100, cache_create: 20, cache_read: 30, output: 50, total: 200 }); // enrichSession adds total
  assert.equal(session.first_user_message, 'please fix the build script');
  assert.deepEqual(session.file_ops['d:/src/demo/build.mjs'], { read: 1, write: 0, edit: 0 }); // normPath lowercases
  assert.ok(session.first_timestamp);
  assert.ok(session.last_timestamp >= session.first_timestamp);
  assert.ok(session.file_size_bytes > 0);
});

// ── scanOpencodeSessions ──────────────────────────────────────────────────────

test('scanOpencodeSessions — finds sessions, skips noise', () => {
  const result = scanOpencodeSessions(root);
  assert.equal(result.harness, 'opencode');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].session_id, SES_ID);
});

test('scanOpencodeSessions — null when root missing', () => {
  assert.equal(scanOpencodeSessions(path.join(root, 'nope')), null);
});
