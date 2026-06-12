/**
 * test/trace-service.test.mjs → surface/trace-service.mjs
 *
 * /api/trace production path: registry readSessionRecords → adapter →
 * reconstructTraceFromNRs, with an mtime cache. Per-harness smoke fixtures
 * gate the capabilities.trace flips.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTraceService } from '../surface/trace-service.mjs';

function tempDir() {
  const dir = join(tmpdir(), 'kaaro-trace-svc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('buildTrace — claude-code session file → tree with session/project ids', () => {
  const dir = tempDir();
  const fp = join(dir, 's1.jsonl');
  writeFileSync(fp, [
    JSON.stringify({ type: 'user', timestamp: 't1', message: { content: 'hello there world' } }),
    JSON.stringify({ type: 'assistant', timestamp: 't2', message: {
      model: 'm', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 },
      content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.mjs' } }],
    } }),
  ].join('\n'), 'utf8');
  try {
    const svc = createTraceService();
    const tree = svc.buildTrace(fp, 'P', 's1', 'claude-code');
    assert.equal(tree.session_id, 's1');
    assert.equal(tree.project_id, 'P');
    assert.equal(tree.segments.length, 1);
    assert.equal(tree.segments[0].tool_summary.Read, 1);

    // mtime cache: same file, same mtime → identical object back
    assert.equal(svc.buildTrace(fp, 'P', 's1', 'claude-code'), tree);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildTrace — grok session dir reads summary.json side-channel', () => {
  const dir = tempDir();
  const sessDir = join(dir, 'sess-1');
  mkdirSync(sessDir);
  const fp = join(sessDir, 'updates.jsonl');
  writeFileSync(fp, JSON.stringify({
    timestamp: 1, method: 'session/update',
    params: { sessionId: 's', update: {
      sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'build the thing' } } },
  }) + '\n', 'utf8');
  writeFileSync(join(sessDir, 'summary.json'),
    JSON.stringify({ generated_title: 'Grok trace smoke', head_branch: 'feat/t' }), 'utf8');
  try {
    const tree = createTraceService().buildTrace(fp, 'proj', 's', 'grok');
    assert.equal(tree.ai_title, 'Grok trace smoke');
    assert.deepEqual(tree.segments[0].branches, ['feat/t']);
    assert.equal(tree.segments[0].user_turns, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildTrace — pi session (capability flip smoke)', () => {
  const dir = tempDir();
  const fp = join(dir, 'p.jsonl');
  writeFileSync(fp, [
    JSON.stringify({ type: 'message', id: 'u1', timestamp: 't1',
      message: { role: 'user', content: [{ type: 'text', text: 'hello pi world' }] } }),
    JSON.stringify({ type: 'message', id: 'a1', timestamp: 't2',
      message: { role: 'assistant', model: 'm', stopReason: 'end',
        usage: { input: 1, output: 2 },
        content: [{ type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: 'a.mjs' } }] } }),
  ].join('\n'), 'utf8');
  try {
    const tree = createTraceService().buildTrace(fp, 'proj', 'p', 'pi');
    assert.equal(tree.segments.length, 1);
    assert.equal(tree.segments[0].user_turns, 1);
    assert.ok(tree.segments[0].turns.length >= 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildTrace — opencode session info assembles message tree (flip smoke)', () => {
  const root = tempDir();
  mkdirSync(join(root, 'session', 'b1'), { recursive: true });
  mkdirSync(join(root, 'message', 'ses_x'), { recursive: true });
  mkdirSync(join(root, 'part', 'msg_1'), { recursive: true });
  const infoPath = join(root, 'session', 'b1', 'ses_x.json');
  writeFileSync(infoPath, JSON.stringify({
    id: 'ses_x', title: 'OC trace smoke', directory: 'D:/x', time: { created: 1, updated: 2 },
  }), 'utf8');
  writeFileSync(join(root, 'message', 'ses_x', 'msg_1.json'), JSON.stringify({
    id: 'msg_1', sessionID: 'ses_x', role: 'user', time: { created: 3 },
  }), 'utf8');
  writeFileSync(join(root, 'part', 'msg_1', 'prt_1.json'), JSON.stringify({
    id: 'prt_1', type: 'text', text: 'please fix the build',
  }), 'utf8');
  try {
    const tree = createTraceService().buildTrace(infoPath, null, 'ses_x', 'opencode');
    assert.equal(tree.ai_title, 'OC trace smoke');
    assert.equal(tree.segments[0].user_turns, 1);
    assert.ok(tree.segments[0].turns.some(t => t.role === 'user' && t.text === 'please fix the build'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('buildTrace — copilot op-log (flip smoke)', () => {
  const dir = tempDir();
  const fp = join(dir, 'c1.jsonl');
  writeFileSync(fp, JSON.stringify({ kind: 0, v: {
    version: 3, sessionId: 'c1', creationDate: 1, customTitle: 'CP trace smoke',
    requests: [{ requestId: 'r1', timestamp: 2, modelId: 'm',
      message: { text: 'what changed here' }, response: [
        { kind: 'markdownContent', content: { value: 'The build script changed.' } },
      ], completionTokens: 4 }],
  } }) + '\n', 'utf8');
  try {
    const tree = createTraceService().buildTrace(fp, null, 'c1', 'copilot');
    assert.equal(tree.ai_title, 'CP trace smoke');
    assert.equal(tree.segments[0].user_turns, 1);
    assert.ok(tree.segments[0].turns.some(t => t.role === 'assistant'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildTrace — unknown harness or missing file → null', () => {
  const svc = createTraceService();
  assert.equal(svc.buildTrace('Z:/nope/x.jsonl', 'p', 's', 'claude-code'), null);
  assert.equal(svc.buildTrace('Z:/nope/x.jsonl', 'p', 's', 'not-a-harness'), null);
});
