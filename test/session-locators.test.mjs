/**
 * test/session-locators.test.mjs → hooks/session-locators.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { locateClaudeCodeSession } from '../hooks/session-locators.mjs';

function tempRoot() {
  const dir = join(tmpdir(), 'kaaro-locate-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('locateClaudeCodeSession — parent uuid at project root', () => {
  const root = tempRoot();
  const proj = join(root, 'D--src-demo');
  mkdirSync(proj);
  const sid = '1b043708-e48c-4567-8e76-e060ea5dbe14';
  writeFileSync(join(proj, `${sid}.jsonl`), '{}\n');
  try {
    const hit = locateClaudeCodeSession(sid, root);
    assert.ok(hit);
    assert.equal(hit.sessionId, sid);
    assert.equal(hit.projectId, 'D--src-demo');
    assert.ok(hit.filePath.endsWith(`${sid}.jsonl`) || hit.filePath.replace(/\\/g, '/').endsWith(`${sid}.jsonl`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('locateClaudeCodeSession — nested subagents/agent-<id>.jsonl', () => {
  const root = tempRoot();
  const proj = join(root, 'D--src-demo');
  const parent = '1b043708-e48c-4567-8e76-e060ea5dbe14';
  const agentId = 'a3e11a292d609acd8';
  const subDir = join(proj, parent, 'subagents');
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, `agent-${agentId}.jsonl`), '{}\n');
  try {
    const hit = locateClaudeCodeSession(agentId, root);
    assert.ok(hit);
    assert.equal(hit.sessionId, agentId);
    assert.ok(hit.filePath.replace(/\\/g, '/').includes(`/subagents/agent-${agentId}.jsonl`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('locateClaudeCodeSession — legacy proj/subagents/<id>.jsonl still works', () => {
  const root = tempRoot();
  const proj = join(root, 'P');
  mkdirSync(join(proj, 'subagents'), { recursive: true });
  writeFileSync(join(proj, 'subagents', 'old-style.jsonl'), '{}\n');
  try {
    const hit = locateClaudeCodeSession('old-style', root);
    assert.ok(hit);
    assert.ok(hit.filePath.replace(/\\/g, '/').endsWith('subagents/old-style.jsonl'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('locateClaudeCodeSession — missing → null', () => {
  const root = tempRoot();
  try {
    assert.equal(locateClaudeCodeSession('nope', root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
