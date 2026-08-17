/**
 * test/jsonl-io.test.mjs → hooks/jsonl-io.mjs
 *
 * The single JSONL file reader for all analyzers (replaces three verbatim
 * copies in analyze.mjs / analyze-antigravity.mjs / analyze-grok.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseJsonlFile } from '../hooks/jsonl-io.mjs';

function withTempFile(content, fn) {
  const dir = join(tmpdir(), 'kaaro-jsonl-io-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, 'f.jsonl');
  writeFileSync(fp, content, 'utf8');
  try { return fn(fp); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('parseJsonlFile — parses one record per line', () => {
  withTempFile('{"a":1}\n{"b":2}\n', (fp) => {
    const { records, sizeBytes } = parseJsonlFile(fp);
    assert.deepEqual(records, [{ a: 1 }, { b: 2 }]);
    assert.equal(sizeBytes, Buffer.byteLength('{"a":1}\n{"b":2}\n', 'utf8'));
  });
});

test('parseJsonlFile — skips malformed lines and blanks', () => {
  withTempFile('{"a":1}\nnot json\n\n   \n{"b":2}', (fp) => {
    const { records } = parseJsonlFile(fp);
    assert.deepEqual(records, [{ a: 1 }, { b: 2 }]);
  });
});

test('parseJsonlFile — empty file → no records, zero bytes', () => {
  withTempFile('', (fp) => {
    const { records, sizeBytes } = parseJsonlFile(fp);
    assert.deepEqual(records, []);
    assert.equal(sizeBytes, 0);
  });
});

test('parseJsonlFile — sizeBytes counts multibyte content correctly', () => {
  const line = '{"emoji":"⟲⌨"}\n';
  withTempFile(line, (fp) => {
    const { sizeBytes } = parseJsonlFile(fp);
    assert.equal(sizeBytes, Buffer.byteLength(line, 'utf8'));
  });
});
