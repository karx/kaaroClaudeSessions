/**
 * test/grok-helpers.test.mjs — unit tests for lib/grok-helpers.mjs
 *
 * Covers: grokToolWhere (path extraction for all Grok tool shapes),
 *         grokRecordTs (timestamp conversion), grokSessionUpdate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grokToolWhere, grokToolWhy, grokRecordTs, grokSessionUpdate,
} from '../hooks/helpers/grok-helpers.mjs';

// ── grokToolWhere ─────────────────────────────────────────────────────────────

test('grokToolWhere — read_file extracts target_file', () => {
  assert.equal(
    grokToolWhere('read_file', { target_file: 'src/foo.js' }),
    'src/foo.js',
  );
});

test('grokToolWhere — read_file returns null when target_file absent', () => {
  assert.equal(grokToolWhere('read_file', {}), null);
});

test('grokToolWhere — write extracts filePath (camelCase)', () => {
  assert.equal(
    grokToolWhere('write', { filePath: 'out/app.js' }),
    'out/app.js',
  );
});

test('grokToolWhere — search_replace extracts file_path', () => {
  assert.equal(
    grokToolWhere('search_replace', { file_path: 'lib/x.mjs', old_string: 'a', new_string: 'b' }),
    'lib/x.mjs',
  );
});

test('grokToolWhere — list_dir extracts target_directory', () => {
  assert.equal(
    grokToolWhere('list_dir', { target_directory: 'src' }),
    'src',
  );
});

test('grokToolWhere — web_fetch extracts url', () => {
  assert.equal(
    grokToolWhere('web_fetch', { url: 'https://example.com/path' }),
    'https://example.com/path',
  );
});

test('grokToolWhere — Web search: returns null (no file path)', () => {
  assert.equal(
    grokToolWhere('Web search:', { variant: 'WebSearch', backend: true }),
    null,
  );
});

test('grokToolWhere — grep extracts path over pattern', () => {
  assert.equal(
    grokToolWhere('grep', { pattern: 'foo', path: 'src/lib' }),
    'src/lib',
  );
});

test('grokToolWhere — grep extracts pattern when no path', () => {
  assert.equal(
    grokToolWhere('grep', { pattern: 'parsePulse' }),
    'parsePulse',
  );
});

test('grokToolWhere — backslashes normalised to forward slashes', () => {
  assert.equal(
    grokToolWhere('read_file', { target_file: 'C:\\Users\\karx0\\src\\foo.js' }),
    'C:/Users/karx0/src/foo.js',
  );
});

test('grokToolWhere — write backslash path normalised', () => {
  assert.equal(
    grokToolWhere('write', { filePath: 'D:\\src\\out.js' }),
    'D:/src/out.js',
  );
});

test('grokToolWhere — empty rawInput returns null', () => {
  assert.equal(grokToolWhere('read_file', {}), null);
  assert.equal(grokToolWhere('list_dir',  {}), null);
  assert.equal(grokToolWhere('write',     {}), null);
});

test('grokToolWhere — Shell extracts command as where', () => {
  assert.equal(
    grokToolWhere('Shell', { command: 'node --test' }),
    'node --test',
  );
});

test('grokToolWhere — Shell command truncated to 80 chars', () => {
  const long = 'a'.repeat(100);
  const result = grokToolWhere('Shell', { command: long });
  assert.equal(result?.length, 80);
});

// ── grokRecordTs ──────────────────────────────────────────────────────────────

test('grokRecordTs — Unix epoch seconds → ISO string in 2026', () => {
  // 1781014726 seconds * 1000 = ~2026-06-09
  const iso = grokRecordTs({ timestamp: 1781014726 });
  assert.ok(typeof iso === 'string', 'should return string');
  assert.ok(iso.startsWith('2026-'), `expected 2026-... got ${iso}`);
});

test('grokRecordTs — non-number timestamp returns null', () => {
  assert.equal(grokRecordTs({ timestamp: '2026-06-09' }), null);
});

test('grokRecordTs — missing timestamp returns null', () => {
  assert.equal(grokRecordTs({}), null);
  assert.equal(grokRecordTs(null), null);
});

test('grokRecordTs — _meta.agentTimestampMs takes priority over timestamp', () => {
  const record = {
    timestamp: 0,                         // epoch 0 → 1970
    _meta: { agentTimestampMs: 1749456000000 },  // 2025-06-09 approximately
  };
  const iso = grokRecordTs(record);
  assert.ok(!iso.startsWith('1970-'), `should not use timestamp=0, got ${iso}`);
});

test('grokRecordTs — timestamp: 0 with no _meta fallback returns null, not 1970', () => {
  // 0 is a sentinel for "no timestamp available", not a real Unix time.
  assert.equal(grokRecordTs({ timestamp: 0 }), null);
});

test('grokRecordTs — negative timestamp returns null', () => {
  assert.equal(grokRecordTs({ timestamp: -1 }), null);
});

// ── grokSessionUpdate ─────────────────────────────────────────────────────────

test('grokSessionUpdate — extracts sessionUpdate from params.update', () => {
  const rec = { params: { update: { sessionUpdate: 'tool_call' } } };
  assert.equal(grokSessionUpdate(rec), 'tool_call');
});

test('grokSessionUpdate — returns null for non-update records', () => {
  assert.equal(grokSessionUpdate({ type: 'assistant' }), null);
  assert.equal(grokSessionUpdate({}), null);
  assert.equal(grokSessionUpdate(null), null);
});

test('grokSessionUpdate — agent_message_chunk recognised', () => {
  const rec = { params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hello' } } } };
  assert.equal(grokSessionUpdate(rec), 'agent_message_chunk');
});

// ── grokToolWhy ───────────────────────────────────────────────────────────────

test('grokToolWhy — returns description if present', () => {
  assert.equal(grokToolWhy({ description: 'read the file' }), 'read the file');
});

test('grokToolWhy — falls back to command slice', () => {
  assert.equal(grokToolWhy({ command: 'node --test' }), 'node --test');
});

test('grokToolWhy — returns null for empty rawInput', () => {
  assert.equal(grokToolWhy({}), null);
  assert.equal(grokToolWhy(), null);
});
