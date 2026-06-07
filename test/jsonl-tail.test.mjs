import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { tailRead } from '../lib/jsonl-tail.mjs';

// ── Temp file helpers ─────────────────────────────────────────────────────────

let dir;
function setup() {
  dir = join(tmpdir(), `kaaro-tail-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return p => join(dir, p);
}
function teardown() { rmSync(dir, { recursive: true, force: true }); }

function write(fp, content) { writeFileSync(fp, content, 'utf8'); }
function append(fp, content) { appendFileSync(fp, content, 'utf8'); }

// ── From offset 0 ─────────────────────────────────────────────────────────────

test('tailRead — from offset 0 reads all records', async t => {
  const p = setup();
  try {
    const fp = p('a.jsonl');
    write(fp, '{"a":1}\n{"b":2}\n');
    const { records, newOffset } = tailRead(fp, 0);
    await t.test('two records returned', () => assert.equal(records.length, 2));
    await t.test('first record correct', () => assert.deepEqual(records[0], { a: 1 }));
    await t.test('second record correct', () => assert.deepEqual(records[1], { b: 2 }));
    await t.test('newOffset equals file byte length', () => {
      const expected = Buffer.byteLength('{"a":1}\n{"b":2}\n', 'utf8');
      assert.equal(newOffset, expected);
    });
  } finally { teardown(); }
});

test('tailRead — empty file returns no records and offset 0', async t => {
  const p = setup();
  try {
    const fp = p('empty.jsonl');
    write(fp, '');
    const { records, newOffset } = tailRead(fp, 0);
    await t.test('no records', () => assert.equal(records.length, 0));
    await t.test('newOffset is 0', () => assert.equal(newOffset, 0));
  } finally { teardown(); }
});

// ── Incremental reads ─────────────────────────────────────────────────────────

test('tailRead — incremental: given offset at end of first line, returns only second record', async t => {
  const p = setup();
  try {
    const fp = p('inc.jsonl');
    const line1 = '{"first":1}\n';
    const line2 = '{"second":2}\n';
    write(fp, line1 + line2);
    const offset1 = Buffer.byteLength(line1, 'utf8');
    const { records, newOffset } = tailRead(fp, offset1);
    await t.test('one record', () => assert.equal(records.length, 1));
    await t.test('correct record', () => assert.deepEqual(records[0], { second: 2 }));
    await t.test('newOffset advanced', () => assert.equal(newOffset, offset1 + Buffer.byteLength(line2, 'utf8')));
  } finally { teardown(); }
});

test('tailRead — no growth since last read returns no records and same offset', async t => {
  const p = setup();
  try {
    const fp = p('nochange.jsonl');
    write(fp, '{"x":1}\n');
    const { newOffset: off1 } = tailRead(fp, 0);
    const { records, newOffset: off2 } = tailRead(fp, off1);
    await t.test('no records', () => assert.equal(records.length, 0));
    await t.test('offset unchanged', () => assert.equal(off2, off1));
  } finally { teardown(); }
});

test('tailRead — sequential appends each captured independently', async t => {
  const p = setup();
  try {
    const fp = p('seq.jsonl');
    write(fp, '{"turn":1}\n');

    const { records: r1, newOffset: o1 } = tailRead(fp, 0);
    await t.test('first read: one record', () => assert.equal(r1.length, 1));

    append(fp, '{"turn":2}\n');
    const { records: r2, newOffset: o2 } = tailRead(fp, o1);
    await t.test('second read: one new record', () => assert.equal(r2.length, 1));
    await t.test('second record correct', () => assert.deepEqual(r2[0], { turn: 2 }));

    append(fp, '{"turn":3}\n{"turn":4}\n');
    const { records: r3 } = tailRead(fp, o2);
    await t.test('third read: two new records', () => assert.equal(r3.length, 2));
  } finally { teardown(); }
});

// ── Partial line at EOF ───────────────────────────────────────────────────────

test('tailRead — partial line at EOF is excluded', async t => {
  const p = setup();
  try {
    const fp = p('partial.jsonl');
    write(fp, '{"complete":1}\n{"incomplete":2');  // no trailing \n
    const { records, newOffset } = tailRead(fp, 0);
    await t.test('only complete line returned', () => assert.equal(records.length, 1));
    await t.test('correct record', () => assert.deepEqual(records[0], { complete: 1 }));
    await t.test('offset stops at last \\n', () => {
      const expected = Buffer.byteLength('{"complete":1}\n', 'utf8');
      assert.equal(newOffset, expected);
    });
  } finally { teardown(); }
});

test('tailRead — after partial line is completed next read picks it up', async t => {
  const p = setup();
  try {
    const fp = p('complete.jsonl');
    write(fp, '{"a":1}\n{"partial":2');
    const { newOffset: off1 } = tailRead(fp, 0);

    append(fp, '}\n');  // complete the second line
    const { records, newOffset: off2 } = tailRead(fp, off1);
    await t.test('picks up newly completed line', () => assert.equal(records.length, 1));
    await t.test('correct record', () => assert.deepEqual(records[0], { partial: 2 }));
    await t.test('offset advanced', () => assert.ok(off2 > off1));
  } finally { teardown(); }
});

test('tailRead — file with no newlines at all returns no records and offset 0', async t => {
  const p = setup();
  try {
    const fp = p('nonewline.jsonl');
    write(fp, '{"alone":true}');
    const { records, newOffset } = tailRead(fp, 0);
    await t.test('no records', () => assert.equal(records.length, 0));
    await t.test('offset stays 0', () => assert.equal(newOffset, 0));
  } finally { teardown(); }
});

// ── UTF-8 byte safety ─────────────────────────────────────────────────────────

test('tailRead — multi-byte UTF-8: byte offset not char offset', async t => {
  const p = setup();
  try {
    const fp = p('utf8.jsonl');
    const line1 = '{"emoji":"🎉"}\n';     // 🎉 is 4 bytes
    const line2 = '{"ascii":"ok"}\n';
    write(fp, line1 + line2);

    const byteLen1 = Buffer.byteLength(line1, 'utf8');
    assert.ok(byteLen1 > line1.length, 'sanity: byte len > char len for emoji line');

    const { records: r1, newOffset: o1 } = tailRead(fp, 0);
    await t.test('offset advanced by bytes not chars', () => assert.equal(o1, Buffer.byteLength(line1 + line2, 'utf8')));

    // Read only line2 starting at byte boundary
    const { records: r2 } = tailRead(fp, byteLen1);
    await t.test('only second record returned from byte offset', () => assert.equal(r2.length, 1));
    await t.test('correct second record', () => assert.deepEqual(r2[0], { ascii: 'ok' }));
  } finally { teardown(); }
});

// ── Malformed lines ───────────────────────────────────────────────────────────

test('tailRead — malformed JSON line is skipped, valid lines returned', async t => {
  const p = setup();
  try {
    const fp = p('malformed.jsonl');
    write(fp, '{"good":1}\nNOT_JSON{{bad\n{"also":"good"}\n');
    const { records } = tailRead(fp, 0);
    await t.test('two valid records', () => assert.equal(records.length, 2));
    await t.test('first valid', () => assert.deepEqual(records[0], { good: 1 }));
    await t.test('second valid', () => assert.deepEqual(records[1], { also: 'good' }));
  } finally { teardown(); }
});

test('tailRead — blank lines between records are skipped', async t => {
  const p = setup();
  try {
    const fp = p('blanks.jsonl');
    write(fp, '{"a":1}\n\n   \n{"b":2}\n');
    const { records } = tailRead(fp, 0);
    await t.test('two records', () => assert.equal(records.length, 2));
  } finally { teardown(); }
});

// ── Missing file ──────────────────────────────────────────────────────────────

test('tailRead — non-existent file returns empty records and offset 0', async t => {
  const { records, newOffset } = tailRead('/nonexistent/path/session.jsonl', 0);
  await t.test('no records', () => assert.equal(records.length, 0));
  await t.test('offset is 0', () => assert.equal(newOffset, 0));
});

test('tailRead — offset beyond file size returns empty records and same offset', async t => {
  const p = setup();
  try {
    const fp = p('short.jsonl');
    write(fp, '{"x":1}\n');
    const { records, newOffset } = tailRead(fp, 9999);
    await t.test('no records', () => assert.equal(records.length, 0));
    await t.test('offset unchanged', () => assert.equal(newOffset, 9999));
  } finally { teardown(); }
});
