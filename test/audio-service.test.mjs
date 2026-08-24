/**
 * test/audio-service.test.mjs → surface/audio-service.mjs
 *
 * Session → simulateSession payload for /api/audio (DAW replay).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createAudioService } from '../surface/audio-service.mjs';

function withTempJsonl(records, fn) {
  const dir = join(tmpdir(), 'kaaro-audio-svc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, 's.jsonl');
  writeFileSync(fp, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  try { return fn(fp); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const READ_REC = {
  type: 'assistant', timestamp: '2026-06-09T10:00:00.000Z',
  message: { content: [
    { type: 'tool_use', name: 'Read', input: { file_path: 'src/index.mjs' } },
  ]},
};

test('buildAudio — CC Read tool_use becomes a serialisable tool_call event', () => {
  withTempJsonl([READ_REC], (fp) => {
    const { buildAudio } = createAudioService();
    const out = buildAudio(fp, 'proj', 'sess-id-full', 'claude-code');
    assert.ok(out);
    assert.equal(out.session_id, 'sess-id-full');
    assert.equal(out.slug, 'sess-id-');
    assert.equal(out.harness, 'claude-code');
    assert.equal(out.preset, 'cognitive-flow');
    assert.ok(out.summary.tool_call >= 1);
    const ev = out.events.find(e => e.event === 'tool_call');
    assert.ok(ev);
    assert.equal(typeof ev.relMs, 'number');
    assert.equal(typeof ev.hz, 'number');
    assert.equal(typeof ev.sonic.instrument, 'string');
    assert.equal(typeof ev.sonic.key, 'string');
    JSON.stringify(out); // must be JSON-safe for the HTTP surface
  });
});

test('buildAudio — unknown preset falls back to cognitive-flow', () => {
  withTempJsonl([READ_REC], (fp) => {
    const { buildAudio } = createAudioService();
    const out = buildAudio(fp, 'p', 's', 'claude-code', { preset: 'not-a-preset' });
    assert.equal(out.preset, 'cognitive-flow');
  });
});

test('buildAudio — missing file returns null (not throw)', () => {
  const { buildAudio } = createAudioService();
  assert.equal(buildAudio('Z:/nope/missing.jsonl', 'p', 's', 'claude-code'), null);
});
