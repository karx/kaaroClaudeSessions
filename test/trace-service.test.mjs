/**
 * test/trace-service.test.mjs → surface/trace-service.mjs
 *
 * /api/trace production path: registry readSessionRecords → adapter →
 * reconstructTraceFromNRs, with an mtime cache. Per-harness smoke fixtures
 * gate the capabilities.trace flips.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
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

test('buildTrace — claude-code nests three Explore subagents via meta.toolUseId', () => {
  const dir = tempDir();
  const parentId = 'parent-uuid-1';
  const fp = join(dir, `${parentId}.jsonl`);
  writeFileSync(fp, [
    JSON.stringify({ type: 'user', timestamp: 't0', message: { content: 'plan layout mode please' } }),
    JSON.stringify({ type: 'assistant', timestamp: 't1', message: {
      model: 'm', stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 5 },
      content: [
        { type: 'tool_use', id: 'toolu_01A', name: 'Agent',
          input: { description: 'Explore template.html', subagent_type: 'Explore' } },
        { type: 'tool_use', id: 'toolu_01B', name: 'Agent',
          input: { description: 'Explore build.mjs', subagent_type: 'Explore' } },
        { type: 'tool_use', id: 'toolu_01C', name: 'Agent',
          input: { description: 'Explore client-core', subagent_type: 'Explore' } },
      ],
    } }),
  ].join('\n'), 'utf8');

  const sub = join(dir, parentId, 'subagents');
  mkdirSync(sub, { recursive: true });
  function writeChild(agentId, toolUseId, desc, tools) {
    writeFileSync(join(sub, `agent-${agentId}.meta.json`), JSON.stringify({
      agentType: 'Explore', description: desc, toolUseId, spawnDepth: 1,
    }), 'utf8');
    writeFileSync(join(sub, `agent-${agentId}.jsonl`), [
      JSON.stringify({ type: 'user', timestamp: 'c0', isSidechain: true, agentId,
        sessionId: parentId, message: { content: desc } }),
      JSON.stringify({ type: 'assistant', timestamp: 'c1', isSidechain: true, agentId,
        sessionId: parentId, message: {
          model: 'm', stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 2 },
          content: tools.map((name, i) => ({
            type: 'tool_use', id: `c${i}`, name, input: name === 'Read' ? { file_path: 'x.mjs' } : { pattern: 'y' },
          })),
        } }),
    ].join('\n'), 'utf8');
  }
  writeChild('aaa111', 'toolu_01A', 'Explore template.html', ['Read', 'Grep']);
  writeChild('bbb222', 'toolu_01B', 'Explore build.mjs', ['Grep', 'Grep', 'Read']);
  writeChild('ccc333', 'toolu_01C', 'Explore client-core', ['Read']);

  try {
    const tree = createTraceService().buildTrace(fp, 'P', parentId, 'claude-code');
    assert.ok(tree);
    assert.equal(tree.subagents.length, 3);
    assert.ok(tree.subagents.every(s => s.linked && s.agent_type === 'Explore'));
    assert.equal(tree.subagents.find(s => s.tool_use_id === 'toolu_01A').agent_id, 'aaa111');
    assert.equal(tree.subagents.find(s => s.tool_use_id === 'toolu_01B').tree.segments[0].tool_summary.Grep, 2);
    assert.equal(tree.subagents.find(s => s.tool_use_id === 'toolu_01C').tree.segments[0].tool_summary.Read, 1);

    const asst = tree.segments[0].turns.find(t => t.role === 'assistant');
    assert.equal(asst.spawned_subagents.length, 3);
    assert.equal(asst.spawned_subagents[0].description, 'Explore template.html');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildTrace — subagent fingerprint invalidates when child meta changes', () => {
  const dir = tempDir();
  const parentId = 'parent-uuid-2';
  const fp = join(dir, `${parentId}.jsonl`);
  writeFileSync(fp, [
    JSON.stringify({ type: 'user', timestamp: 't0', message: { content: 'spawn one agent please' } }),
    JSON.stringify({ type: 'assistant', timestamp: 't1', message: {
      model: 'm', stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [
        { type: 'tool_use', id: 'toolu_X', name: 'Agent',
          input: { description: 'first', subagent_type: 'Explore' } },
      ],
    } }),
  ].join('\n'), 'utf8');
  const sub = join(dir, parentId, 'subagents');
  mkdirSync(sub, { recursive: true });
  const metaPath = join(sub, 'agent-zzz.meta.json');
  writeFileSync(metaPath, JSON.stringify({
    agentType: 'Explore', description: 'first', toolUseId: 'toolu_X', spawnDepth: 1,
  }), 'utf8');
  writeFileSync(join(sub, 'agent-zzz.jsonl'),
    JSON.stringify({ type: 'user', timestamp: 'c0', message: { content: 'hi agent child' } }) + '\n', 'utf8');

  try {
    const svc = createTraceService();
    const t1 = svc.buildTrace(fp, 'P', parentId, 'claude-code');
    assert.equal(t1.subagents[0].description, 'first');
    assert.equal(svc.buildTrace(fp, 'P', parentId, 'claude-code'), t1); // cache hit

    // Touch meta so fingerprint + description change
    writeFileSync(metaPath, JSON.stringify({
      agentType: 'Explore', description: 'updated desc', toolUseId: 'toolu_X', spawnDepth: 1,
    }), 'utf8');
    const future = new Date(Date.now() + 5000);
    utimesSync(metaPath, future, future);

    const t2 = svc.buildTrace(fp, 'P', parentId, 'claude-code');
    assert.notEqual(t2, t1);
    assert.equal(t2.subagents[0].description, 'updated desc');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildTrace — public subagent refs omit jsonl_path', () => {
  const dir = tempDir();
  const parentId = 'parent-uuid-no-path';
  const fp = join(dir, `${parentId}.jsonl`);
  writeFileSync(fp, [
    JSON.stringify({ type: 'user', timestamp: 't0', message: { content: 'spawn for path strip test' } }),
    JSON.stringify({ type: 'assistant', timestamp: 't1', message: {
      model: 'm', stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [
        { type: 'tool_use', id: 'toolu_P', name: 'Agent',
          input: { description: 'path strip', subagent_type: 'Explore' } },
      ],
    } }),
  ].join('\n'), 'utf8');
  const sub = join(dir, parentId, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-path1.meta.json'), JSON.stringify({
    agentType: 'Explore', description: 'path strip', toolUseId: 'toolu_P', spawnDepth: 1,
  }), 'utf8');
  writeFileSync(join(sub, 'agent-path1.jsonl'),
    JSON.stringify({ type: 'user', timestamp: 'c0', message: { content: 'child body text here' } }) + '\n', 'utf8');
  try {
    const tree = createTraceService().buildTrace(fp, 'P', parentId, 'claude-code');
    assert.ok(tree.subagents?.length >= 1);
    for (const s of tree.subagents) {
      assert.equal(s.jsonl_path, undefined, 'no host paths in API payload');
      assert.equal(s.meta_path, undefined);
    }
    const asst = tree.segments[0].turns.find(t => t.spawned_subagents?.length);
    if (asst) {
      for (const s of asst.spawned_subagents)
        assert.equal(s.jsonl_path, undefined);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildTrace — empty toolUseId still attaches child tree via agent id', () => {
  const dir = tempDir();
  const parentId = 'parent-uuid-empty-tu';
  const fp = join(dir, `${parentId}.jsonl`);
  writeFileSync(fp, [
    JSON.stringify({ type: 'user', timestamp: 't0', message: { content: 'spawn unlinked agent please' } }),
    JSON.stringify({ type: 'assistant', timestamp: 't1', message: {
      model: 'm', stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [
        { type: 'tool_use', id: 'toolu_maybe', name: 'Agent',
          input: { description: 'orphan explore', subagent_type: 'Explore' } },
      ],
    } }),
  ].join('\n'), 'utf8');
  const sub = join(dir, parentId, 'subagents');
  mkdirSync(sub, { recursive: true });
  // Meta with empty toolUseId — real CC data sometimes lacks the link
  writeFileSync(join(sub, 'agent-zzzempty.meta.json'), JSON.stringify({
    agentType: 'Explore', description: 'orphan explore', toolUseId: '', spawnDepth: 1,
  }), 'utf8');
  writeFileSync(join(sub, 'agent-zzzempty.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: 'c0', message: { content: 'child user turn text here' } }),
    JSON.stringify({ type: 'assistant', timestamp: 'c1', message: {
      model: 'm', stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [{ type: 'tool_use', id: 'c0', name: 'Read', input: { file_path: 'a.mjs' } }],
    } }),
  ].join('\n'), 'utf8');

  try {
    const tree = createTraceService().buildTrace(fp, 'P', parentId, 'claude-code');
    const orphan = (tree.subagents || []).find(s => s.agent_id === 'zzzempty');
    assert.ok(orphan, 'orphan agent stub present');
    assert.ok(orphan.tree, 'child tree attached despite empty toolUseId');
    assert.equal(orphan.tree.segments[0].tool_summary.Read, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildTrace — maxSubagentDepth 0 yields stubs without nested trees', () => {
  const dir = tempDir();
  const parentId = 'parent-uuid-3';
  const fp = join(dir, `${parentId}.jsonl`);
  writeFileSync(fp, [
    JSON.stringify({ type: 'user', timestamp: 't0', message: { content: 'spawn depth zero' } }),
    JSON.stringify({ type: 'assistant', timestamp: 't1', message: {
      model: 'm', stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [
        { type: 'tool_use', id: 'toolu_Z', name: 'Agent',
          input: { description: 'deep', subagent_type: 'Explore' } },
      ],
    } }),
  ].join('\n'), 'utf8');
  const sub = join(dir, parentId, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-d1.meta.json'), JSON.stringify({
    agentType: 'Explore', description: 'deep', toolUseId: 'toolu_Z', spawnDepth: 1,
  }), 'utf8');
  writeFileSync(join(sub, 'agent-d1.jsonl'),
    JSON.stringify({ type: 'user', timestamp: 'c0', message: { content: 'child body text here' } }) + '\n', 'utf8');

  try {
    const tree = createTraceService().buildTrace(fp, 'P', parentId, 'claude-code', {
      maxSubagentDepth: 0,
    });
    assert.equal(tree.subagents.length, 1);
    assert.equal(tree.subagents[0].agent_id, 'd1');
    assert.equal(tree.subagents[0].linked, true);
    assert.equal(tree.subagents[0].tree, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildTrace — harness without subagent_tree does not nest (pi)', () => {
  const dir = tempDir();
  const fp = join(dir, 'p.jsonl');
  // Even if a subagents dir exists beside a pi file, capability false → no nesting
  mkdirSync(join(dir, 'p', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 'p', 'subagents', 'agent-x.meta.json'), JSON.stringify({
    agentType: 'Explore', description: 'x', toolUseId: 'tu', spawnDepth: 1,
  }), 'utf8');
  writeFileSync(join(dir, 'p', 'subagents', 'agent-x.jsonl'), '{}\n', 'utf8');
  writeFileSync(fp, [
    JSON.stringify({ type: 'message', id: 'u1', timestamp: 't1',
      message: { role: 'user', content: [{ type: 'text', text: 'hello pi world' }] } }),
  ].join('\n'), 'utf8');
  try {
    const tree = createTraceService().buildTrace(fp, 'proj', 'p', 'pi');
    assert.equal(tree.subagents, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

