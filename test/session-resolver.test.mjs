import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resolveClaudeCodeSession,
  resolvePiSession,
  resolveAntigravitySession,
  resolveGrokSession,
  resolveSessionFile,
} from '../surface/session-resolver.mjs';

function makeTemp(prefix) {
  const dir = join(tmpdir(), prefix + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('resolveClaudeCodeSession — finds project session file', () => {
  const root = makeTemp('kaaro-res-cc');
  try {
    const proj = join(root, 'D--src-foo');
    mkdirSync(proj);
    const sessionId = 'abc-def-123';
    writeFileSync(join(proj, `${sessionId}.jsonl`), '{"type":"user"}\n', 'utf8');

    const found = resolveClaudeCodeSession(sessionId, root);
    assert.ok(found);
    assert.equal(found.projectId, 'D--src-foo');
    assert.equal(found.sessionId, sessionId);
    assert.ok(found.filePath.endsWith(`${sessionId}.jsonl`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveClaudeCodeSession — finds subagents session file', () => {
  const root = makeTemp('kaaro-res-cc-sub');
  try {
    const sub = join(root, 'D--src-foo', 'subagents');
    mkdirSync(sub, { recursive: true });
    const sessionId = 'sub-sess-01';
    writeFileSync(join(sub, `${sessionId}.jsonl`), '{}', 'utf8');

    const found = resolveClaudeCodeSession(sessionId, root);
    assert.ok(found);
    assert.equal(found.projectId, 'D--src-foo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolvePiSession — matches UUID after timestamp prefix', () => {
  const root = makeTemp('kaaro-res-pi');
  try {
    const proj = join(root, '--D--src-ebrain--');
    mkdirSync(proj);
    const sessionId = '019dca2b-f4f5-7609-96ae-fe883f7a03db';
    const file = `2026-04-26T14-22-51-638Z_${sessionId}.jsonl`;
    writeFileSync(join(proj, file), '{}', 'utf8');

    const found = resolvePiSession(sessionId, root);
    assert.ok(found);
    assert.equal(found.projectId, '--D--src-ebrain--');
    assert.equal(found.sessionId, sessionId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveAntigravitySession — prefers transcript.jsonl', () => {
  const root = makeTemp('kaaro-res-ag');
  try {
    const sessionId = 'c7f6b422-2184-4e11-ad6d-535a069e7347';
    const logs = join(root, sessionId, '.system_generated', 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, 'transcript.jsonl'), '{}', 'utf8');
    writeFileSync(join(logs, 'overview.txt'), '{}', 'utf8');

    const found = resolveAntigravitySession(sessionId, root);
    assert.ok(found);
    assert.ok(found.filePath.endsWith('transcript.jsonl'));
    assert.equal(found.sessionId, sessionId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveAntigravitySession — falls back to overview.txt', () => {
  const root = makeTemp('kaaro-res-ag-ov');
  try {
    const sessionId = 'c7f6b422-2184-4e11-ad6d-535a069e7347';
    const logs = join(root, sessionId, '.system_generated', 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, 'overview.txt'), '{}', 'utf8');

    const found = resolveAntigravitySession(sessionId, root);
    assert.ok(found);
    assert.ok(found.filePath.endsWith('overview.txt'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveGrokSession — finds updates.jsonl under encoded cwd', () => {
  const root = makeTemp('kaaro-res-grok');
  try {
    const sessionId = '019ea1c9-46ee-77e0-bf36-f87a6403b5db';
    const sessionDir = join(root, 'D%3A%5Csrc%5CkaaroSessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'updates.jsonl'), '{}', 'utf8');

    const found = resolveGrokSession(sessionId, root);
    assert.ok(found);
    assert.ok(found.filePath.endsWith('updates.jsonl'));
    assert.equal(found.projectId, 'D%3A%5Csrc%5CkaaroSessions');

    const byPrefix = resolveGrokSession(sessionId.slice(0, 8), root);
    assert.ok(byPrefix);
    assert.equal(byPrefix.sessionId, sessionId);
    assert.ok(byPrefix.filePath.endsWith('updates.jsonl'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSessionFile — dispatches by harness order', () => {
  const ccRoot = makeTemp('kaaro-res-dispatch-cc');
  const piRoot = makeTemp('kaaro-res-dispatch-pi');
  try {
    const sessionId = 'shared-id-123';
    const ccProj = join(ccRoot, 'D--src-foo');
    mkdirSync(ccProj);
    writeFileSync(join(ccProj, `${sessionId}.jsonl`), '{}', 'utf8');

    const cc = resolveSessionFile(sessionId, {
      harness: 'claude-code',
      roots: { 'claude-code': ccRoot },
    });
    assert.equal(cc.harness, 'claude-code');

    const piProj = join(piRoot, '--proj--');
    mkdirSync(piProj);
    writeFileSync(join(piProj, `${sessionId}.jsonl`), '{}', 'utf8');
    const pi = resolvePiSession(sessionId, piRoot);
    assert.ok(pi);

    assert.equal(resolveSessionFile('missing-id', { harness: 'claude-code' }), null);
  } finally {
    rmSync(ccRoot, { recursive: true, force: true });
    rmSync(piRoot, { recursive: true, force: true });
  }
});
// ── opencode + copilot locators (N5 trace support) ────────────────────────────

test('resolveSessionFile — locates opencode session info across buckets', async () => {
  const { mkdirSync: mk, writeFileSync: wr, rmSync: rm } = await import('fs');
  const { tmpdir } = await import('os');
  const root = join(tmpdir(), 'kaaro-oc-loc-' + Date.now());
  mk(join(root, 'session', 'bucketA'), { recursive: true });
  wr(join(root, 'session', 'bucketA', 'ses_abc123.json'), '{"id":"ses_abc123"}', 'utf8');
  try {
    const found = resolveSessionFile('ses_abc123', { harness: 'opencode', roots: { opencode: root } });
    assert.ok(found, 'opencode session located');
    assert.equal(found.harness, 'opencode');
    assert.ok(found.filePath.endsWith('ses_abc123.json'));
  } finally { rm(root, { recursive: true, force: true }); }
});

test('resolveSessionFile — locates copilot chat session in workspace storage', async () => {
  const { mkdirSync: mk, writeFileSync: wr, rmSync: rm } = await import('fs');
  const { tmpdir } = await import('os');
  const root = join(tmpdir(), 'kaaro-cp-loc-' + Date.now());
  mk(join(root, 'ws-hash-1', 'chatSessions'), { recursive: true });
  wr(join(root, 'ws-hash-1', 'chatSessions', 'sess-42.jsonl'), '{"kind":0,"v":{}}', 'utf8');
  try {
    const found = resolveSessionFile('sess-42', { harness: 'copilot', roots: { copilot: root } });
    assert.ok(found, 'copilot session located');
    assert.equal(found.harness, 'copilot');
    assert.ok(found.filePath.endsWith('sess-42.jsonl'));
  } finally { rm(root, { recursive: true, force: true }); }
});
