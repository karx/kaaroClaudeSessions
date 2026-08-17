/**
 * test/subagent-discover.test.mjs → hooks/helpers/subagent-discover.mjs
 *
 * On-disk CC subagent contract: parentUuid/subagents/agent-*.{jsonl,meta.json}
 * linked to parent Agent tool_use ids via meta.toolUseId.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  parentSessionDirFromLog,
  listSubagentArtifacts,
  linkSpawns,
} from '../hooks/helpers/subagent-discover.mjs';

function tempRoot() {
  const dir = join(tmpdir(), 'kaaro-subagent-disc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgent(subDir, agentId, meta, jsonlBody = '') {
  writeFileSync(join(subDir, `agent-${agentId}.meta.json`), JSON.stringify(meta), 'utf8');
  writeFileSync(join(subDir, `agent-${agentId}.jsonl`), jsonlBody || '{"type":"user"}\n', 'utf8');
}

test('parentSessionDirFromLog — X.jsonl → X directory path', () => {
  assert.equal(
    parentSessionDirFromLog(join('proj', 'abc-uuid.jsonl')),
    join('proj', 'abc-uuid'),
  );
});

test('listSubagentArtifacts — missing or empty dir → []', () => {
  const root = tempRoot();
  try {
    assert.deepEqual(listSubagentArtifacts(join(root, 'nope')), []);
    mkdirSync(join(root, 'parent', 'subagents'), { recursive: true });
    assert.deepEqual(listSubagentArtifacts(join(root, 'parent')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listSubagentArtifacts — three Explore metas + jsonl', () => {
  const root = tempRoot();
  const parentDir = join(root, 'parent-sess');
  const sub = join(parentDir, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeAgent(sub, 'aaa111', {
    agentType: 'Explore',
    description: 'Explore template.html',
    toolUseId: 'toolu_01A',
    spawnDepth: 1,
  });
  writeAgent(sub, 'bbb222', {
    agentType: 'Explore',
    description: 'Explore build.mjs',
    toolUseId: 'toolu_01B',
    spawnDepth: 1,
  });
  writeAgent(sub, 'ccc333', {
    agentType: 'Explore',
    description: 'Explore client-core',
    toolUseId: 'toolu_01C',
    spawnDepth: 1,
  });
  try {
    const arts = listSubagentArtifacts(parentDir);
    assert.equal(arts.length, 3);
    const byId = Object.fromEntries(arts.map(a => [a.agent_id, a]));
    assert.equal(byId.aaa111.meta.toolUseId, 'toolu_01A');
    assert.equal(byId.bbb222.meta.agentType, 'Explore');
    assert.equal(byId.ccc333.meta.spawnDepth, 1);
    assert.ok(byId.aaa111.jsonl_path.endsWith(join('subagents', 'agent-aaa111.jsonl'))
      || byId.aaa111.jsonl_path.replace(/\\/g, '/').endsWith('subagents/agent-aaa111.jsonl'));
    assert.ok(byId.aaa111.meta_path.replace(/\\/g, '/').endsWith('subagents/agent-aaa111.meta.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listSubagentArtifacts — jsonl without meta still listed (orphan)', () => {
  const root = tempRoot();
  const parentDir = join(root, 'p');
  const sub = join(parentDir, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-orphan1.jsonl'), '{}\n', 'utf8');
  try {
    const arts = listSubagentArtifacts(parentDir);
    assert.equal(arts.length, 1);
    assert.equal(arts[0].agent_id, 'orphan1');
    assert.equal(arts[0].meta, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('linkSpawns — links three Explore metas to Agent tool_use ids', () => {
  const root = tempRoot();
  const parentDir = join(root, 'parent-sess');
  const sub = join(parentDir, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeAgent(sub, 'aaa111', {
    agentType: 'Explore',
    description: 'Explore template.html',
    toolUseId: 'toolu_01A',
    spawnDepth: 1,
  });
  writeAgent(sub, 'bbb222', {
    agentType: 'Explore',
    description: 'Explore build.mjs',
    toolUseId: 'toolu_01B',
    spawnDepth: 1,
  });
  writeAgent(sub, 'ccc333', {
    agentType: 'Explore',
    description: 'Explore client-core',
    toolUseId: 'toolu_01C',
    spawnDepth: 1,
  });
  try {
    const arts = listSubagentArtifacts(parentDir);
    const toolUses = [
      { tool_id: 'toolu_01A', description: 'Explore template.html' },
      { tool_id: 'toolu_01B', description: 'Explore build.mjs' },
      { tool_id: 'toolu_01C', description: 'Explore client-core' },
    ];
    const refs = linkSpawns(toolUses, arts);
    assert.equal(refs.length, 3);
    assert.ok(refs.every(r => r.linked === true));
    assert.ok(refs.every(r => r.agent_type === 'Explore'));
    assert.equal(refs.find(r => r.tool_use_id === 'toolu_01A').agent_id, 'aaa111');
    assert.equal(refs.find(r => r.tool_use_id === 'toolu_01B').spawn_depth, 1);
    assert.equal(refs.find(r => r.tool_use_id === 'toolu_01C').description, 'Explore client-core');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('linkSpawns — orphan artifact (no meta / no tool match) → linked:false', () => {
  const root = tempRoot();
  const parentDir = join(root, 'p');
  const sub = join(parentDir, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-orphan1.jsonl'), '{}\n', 'utf8');
  writeAgent(sub, 'linked1', {
    agentType: 'general-purpose',
    description: 'do stuff',
    toolUseId: 'toolu_X',
    spawnDepth: 1,
  });
  try {
    const arts = listSubagentArtifacts(parentDir);
    const refs = linkSpawns(
      [{ tool_id: 'toolu_X', description: 'do stuff' }, { tool_id: 'toolu_UNMATCHED', description: 'ghost' }],
      arts,
    );
    // linked artifact + unmatched tool_use placeholder + orphan jsonl
    const linked = refs.filter(r => r.linked);
    const unlinked = refs.filter(r => !r.linked);
    assert.equal(linked.length, 1);
    assert.equal(linked[0].agent_id, 'linked1');
    assert.ok(unlinked.length >= 1);
    assert.ok(unlinked.some(r => r.agent_id === 'orphan1' || r.tool_use_id === 'toolu_UNMATCHED'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
