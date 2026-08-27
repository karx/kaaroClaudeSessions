import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  DEFAULT_BOX_STAGING,
  detectSide,
  parsePipeArgs,
  initPlan,
  boxPack,
} from '../scripts/grok-bot-pipe.mjs';
import { DEFAULT_DEST, DEFAULT_SRC } from '../scripts/sync-grok-bot.mjs';

function makeSrc() {
  const root = join(tmpdir(), 'gb-pipe-src-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  mkdirSync(join(root, 'agent-transcripts', sid), { recursive: true });
  mkdirSync(join(root, 'agents', sid), { recursive: true });
  mkdirSync(join(root, 'agent-transcripts', 'sand-subagent-ffff'), { recursive: true });
  writeFileSync(join(root, 'agent-transcripts', sid, sid + '.jsonl'), '{"role":"user"}\n');
  writeFileSync(join(root, 'agent-transcripts', 'sand-subagent-ffff', 'sand-subagent-ffff.jsonl'), '{"role":"user"}\n');
  writeFileSync(join(root, 'agents', sid, 'profile.json'), '{"name":"T"}');
  writeFileSync(join(root, 'box-secrets.json'), '{"token":"nope"}');
  writeFileSync(join(root, 'search-index.db'), 'x');
  return { root, sid };
}

test('detectSide: agent-data exists → box', () => {
  assert.equal(detectSide({ existsFn: () => true }), 'box');
  const custom = '/tmp/fake-agent-data';
  assert.equal(detectSide({ agentData: custom, existsFn: (p) => p === custom }), 'box');
});

test('detectSide: agent-data missing → pc', () => {
  assert.equal(detectSide({ existsFn: () => false }), 'pc');
});

test('parsePipeArgs: default / init / box --watch / pc', () => {
  assert.equal(parsePipeArgs([]).cmd, 'init');
  const boxWatch = parsePipeArgs(['box', '--watch']);
  assert.equal(boxWatch.cmd, 'box');
  assert.equal(boxWatch.watch, true);
  assert.equal(parsePipeArgs(['pc']).cmd, 'pc');
  assert.equal(parsePipeArgs(['init']).cmd, 'init');
});

test('initPlan on box: copy onto DEFAULT_BOX_STAGING', () => {
  const plan = initPlan({ existsFn: () => true });
  assert.equal(plan.side, 'box');
  assert.equal(plan.next, 'box');
  assert.equal(plan.dest, DEFAULT_BOX_STAGING);
  assert.equal(plan.src, DEFAULT_SRC);
  assert.equal(plan.mode, 'copy');
});

test('initPlan on pc: dest is .local grok-bot-agent-data, not box staging', () => {
  const plan = initPlan({ existsFn: () => false });
  assert.equal(plan.side, 'pc');
  assert.equal(plan.next, 'pc');
  assert.equal(plan.dest, DEFAULT_DEST);
  assert.notEqual(plan.dest, DEFAULT_BOX_STAGING);
  assert.ok(!String(plan.dest).includes('kaaro-grok-bot-pipe'));
});

test('boxPack: copies jsonl+profile, writes status, skips secrets', () => {
  const { root, sid } = makeSrc();
  const dest = join(tmpdir(), 'gb-pipe-dest-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  try {
    const stats = boxPack(root, dest);
    assert.notEqual(stats.ok, false);
    assert.equal(stats.mode, 'copy');
    assert.ok(stats.copied >= 2);
    assert.ok(existsSync(join(dest, 'agent-transcripts', sid, sid + '.jsonl')));
    assert.ok(existsSync(join(dest, 'agents', sid, 'profile.json')));
    assert.ok(existsSync(join(dest, 'agent-transcripts', 'sand-subagent-ffff', 'sand-subagent-ffff.jsonl')));
    assert.equal(existsSync(join(dest, 'box-secrets.json')), false);
    assert.equal(existsSync(join(dest, 'search-index.db')), false);
    const statusPath = stats.statusPath || join(dest, 'pipe-status.json');
    assert.ok(existsSync(statusPath));
    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    assert.equal(status.side, 'box');
    assert.equal(typeof status.copied, 'number');
    assert.equal(typeof status.skipped, 'number');
    assert.equal(typeof status.jobs, 'number');
    assert.ok(status.src);
    assert.ok(status.dest);
    assert.ok(status.ts);
    assert.ok(Array.isArray(status.files));
    assert.ok(status.files.length >= 2);
    for (const f of status.files) {
      assert.equal(typeof f.rel, 'string');
      assert.equal(typeof f.size, 'number');
      assert.ok(!String(f.rel).includes('box-secrets'));
      assert.ok(!String(f.rel).includes('search-index'));
    }
    const again = boxPack(root, dest);
    assert.ok(again.copied === 0 || again.skipped >= stats.jobs);
    assert.equal(existsSync(join(dest, 'box-secrets.json')), false);
    assert.equal(existsSync(join(dest, 'search-index.db')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

test('boxPack refuses to pack onto src itself (direct)', () => {
  const { root } = makeSrc();
  try {
    let threw = false;
    let result;
    try {
      result = boxPack(root, root);
    } catch (e) {
      threw = true;
      assert.ok(e);
    }
    if (!threw) {
      assert.equal(result.ok, false);
      assert.equal(result.mode, 'direct');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
