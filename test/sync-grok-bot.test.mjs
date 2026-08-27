import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncOnce, resolvePaths } from '../scripts/sync-grok-bot.mjs';

function makeSrc() {
  const root = join(tmpdir(), 'gb-src-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  mkdirSync(join(root, 'agent-transcripts', sid), { recursive: true });
  mkdirSync(join(root, 'agents', sid), { recursive: true });
  mkdirSync(join(root, 'agent-transcripts', 'sand-subagent-ffff'), { recursive: true });
  writeFileSync(join(root, 'agent-transcripts', sid, sid + '.jsonl'), '{"role":"user"}\\n');
  writeFileSync(join(root, 'agent-transcripts', 'sand-subagent-ffff', 'sand-subagent-ffff.jsonl'), '{"role":"user"}\\n');
  writeFileSync(join(root, 'agents', sid, 'profile.json'), '{"name":"T"}');
  writeFileSync(join(root, 'box-secrets.json'), '{"token":"nope"}');
  writeFileSync(join(root, 'search-index.db'), 'x');
  return { root, sid };
}

test('resolvePaths: src exists and dest not set means direct watch', () => {
  const { root } = makeSrc();
  try {
    const r = resolvePaths({ src: root, destSet: false });
    assert.equal(r.mode, 'direct');
    assert.equal(r.dest, root);
    assert.equal(r.src, root);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolvePaths: explicit dest different from src means copy', () => {
  const { root } = makeSrc();
  const dest = join(tmpdir(), 'gb-dest-' + Date.now());
  try {
    const r = resolvePaths({ src: root, dest, destSet: true });
    assert.equal(r.mode, 'copy');
    assert.equal(r.dest, dest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolvePaths: dest same as src means direct', () => {
  const { root } = makeSrc();
  try {
    const r = resolvePaths({ src: root, dest: root, destSet: true });
    assert.equal(r.mode, 'direct');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('syncOnce copy: jsonl and profile only, secrets stay out', () => {
  const { root, sid } = makeSrc();
  const dest = join(tmpdir(), 'gb-out-' + Date.now());
  try {
    const stats = syncOnce(root, dest);
    assert.equal(stats.mode, 'copy');
    assert.ok(stats.copied >= 2);
    assert.ok(existsSync(join(dest, 'agent-transcripts', sid, sid + '.jsonl')));
    assert.ok(existsSync(join(dest, 'agents', sid, 'profile.json')));
    assert.ok(existsSync(join(dest, 'agent-transcripts', 'sand-subagent-ffff', 'sand-subagent-ffff.jsonl')));
    assert.equal(existsSync(join(dest, 'box-secrets.json')), false);
    assert.equal(existsSync(join(dest, 'search-index.db')), false);
    const again = syncOnce(root, dest);
    assert.equal(again.copied, 0);
    assert.ok(again.skipped >= 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

test('syncOnce direct: dest is src, do not rewrite files onto themselves', () => {
  const { root, sid } = makeSrc();
  try {
    const before = readFileSync(join(root, 'agents', sid, 'profile.json'), 'utf8');
    const stats = syncOnce(root, root);
    assert.equal(stats.mode, 'direct');
    assert.equal(stats.copied, 0);
    assert.equal(readFileSync(join(root, 'agents', sid, 'profile.json'), 'utf8'), before);
    assert.equal(existsSync(join(root, 'agents', sid, 'profile.json.tmp')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
