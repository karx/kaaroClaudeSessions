import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resolveClaudeCodeSession,
  resolvePiSession,
  resolveAntigravitySession,
  resolveSessionFile,
} from '../lib/session-resolver.mjs';

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