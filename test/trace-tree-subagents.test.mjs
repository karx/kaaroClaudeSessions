/**
 * test/trace-tree-subagents.test.mjs → hooks/trace-tree.mjs spawn attach
 *
 * Pure reconstruction: opts.spawns + opts.childTrees attach SubagentRefs
 * without filesystem I/O. Default (no opts) stays count-only / parity-safe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructTraceFromNRs } from '../hooks/trace-tree.mjs';

function nrsWithAgent(toolId = 'toolu_01A', desc = 'Explore template.html') {
  return [
    { kind: 'user_turn', harness: 'claude-code', ts: 't0', text: 'plan layout', display_text: 'plan layout' },
    { kind: 'assistant_turn', harness: 'claude-code', ts: 't1', model: 'm', stop_reason: 'tool_use' },
    { kind: 'tokens', harness: 'claude-code', ts: 't1', tokens: { output: 10, cache_read: 0, input: 1, cache_create: 0 } },
    {
      kind: 'tool_use', harness: 'claude-code', ts: 't1',
      tool: 'Agent', tool_id: toolId, category: null,
      input: { description: desc, subagent_type: 'Explore' },
    },
  ];
}

test('without spawns opts — no tree.subagents; subagent_count still works', () => {
  const tree = reconstructTraceFromNRs(nrsWithAgent());
  assert.equal(tree.segments[0].subagent_count, 1);
  assert.equal(tree.subagents, undefined);
  const asst = tree.segments[0].turns.find(t => t.role === 'assistant');
  assert.equal(asst.spawned_subagents, undefined);
});

test('with spawns — tree.subagents filled; turn.spawned_subagents linked by tool_use_id', () => {
  const spawns = [{
    agent_id: 'aaa111',
    tool_use_id: 'toolu_01A',
    description: 'Explore template.html',
    agent_type: 'Explore',
    spawn_depth: 1,
    jsonl_path: '/tmp/agent-aaa111.jsonl',
    linked: true,
  }];
  const tree = reconstructTraceFromNRs(nrsWithAgent(), { spawns });
  assert.equal(tree.subagents.length, 1);
  assert.equal(tree.subagents[0].agent_id, 'aaa111');
  assert.equal(tree.subagents[0].tree, undefined);

  const asst = tree.segments[0].turns.find(t => t.role === 'assistant');
  assert.equal(asst.spawned_subagents.length, 1);
  assert.equal(asst.spawned_subagents[0].agent_id, 'aaa111');
  assert.equal(asst.spawned_subagents[0].description, 'Explore template.html');
});

test('childTrees map attaches nested tree on matching spawn', () => {
  const childTree = {
    ai_title: null,
    segments: [{
      index: 0, tool_summary: { Grep: 2, Read: 1 }, tool_calls: 3,
      subagent_count: 0, turns: [],
    }],
  };
  const spawns = [{
    agent_id: 'aaa111',
    tool_use_id: 'toolu_01A',
    description: 'Explore template.html',
    agent_type: 'Explore',
    spawn_depth: 1,
    jsonl_path: '/tmp/agent-aaa111.jsonl',
    linked: true,
  }];
  const tree = reconstructTraceFromNRs(nrsWithAgent(), {
    spawns,
    childTrees: { toolu_01A: childTree },
  });
  assert.equal(tree.subagents[0].tree, childTree);
  const asst = tree.segments[0].turns.find(t => t.role === 'assistant');
  assert.equal(asst.spawned_subagents[0].tree, childTree);
});

test('Task tool name also attaches spawns', () => {
  const nrs = [
    { kind: 'assistant_turn', harness: 'grok', ts: 't1', model: 'm', stop_reason: null },
    {
      kind: 'tool_use', harness: 'grok', ts: 't1',
      tool: 'Task', tool_id: 'task_1', category: null,
      input: { description: 'explore' },
    },
  ];
  const spawns = [{
    agent_id: 't1', tool_use_id: 'task_1', description: 'explore',
    agent_type: null, spawn_depth: 1, jsonl_path: null, linked: true,
  }];
  const tree = reconstructTraceFromNRs(nrs, { spawns });
  const asst = tree.segments[0].turns.find(t => t.role === 'assistant');
  assert.equal(asst.spawned_subagents[0].tool_use_id, 'task_1');
});

test('spawns without matching tool_use still appear on tree.subagents', () => {
  const spawns = [{
    agent_id: 'orphan', tool_use_id: null, description: 'lost',
    agent_type: 'Explore', spawn_depth: 1, jsonl_path: '/x', linked: false,
  }];
  const tree = reconstructTraceFromNRs(nrsWithAgent('other_id'), { spawns });
  assert.equal(tree.subagents.length, 1);
  assert.equal(tree.subagents[0].agent_id, 'orphan');
  const asst = tree.segments[0].turns.find(t => t.role === 'assistant');
  assert.equal(asst.spawned_subagents, undefined);
});
