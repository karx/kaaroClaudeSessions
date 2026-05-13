import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeBash, parseJsonlFile } from '../analyze.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── categorizeBash ────────────────────────────────────────────────────────────

test('categorizeBash', async t => {
  await t.test('git command', () => {
    assert.equal(categorizeBash('git status'), 'git');
  });
  await t.test('git with subcommand and flags', () => {
    assert.equal(categorizeBash('git commit -m "msg"'), 'git');
  });

  await t.test('npm command', () => {
    assert.equal(categorizeBash('npm install'), 'npm');
  });
  await t.test('npm run script', () => {
    assert.equal(categorizeBash('npm run build'), 'npm');
  });

  await t.test('npx command', () => {
    assert.equal(categorizeBash('npx tsc --noEmit'), 'npx');
  });

  await t.test('node command', () => {
    assert.equal(categorizeBash('node serve.mjs'), 'node');
  });
  await t.test('near-miss: nodejs does not start with "node "', () => {
    assert.equal(categorizeBash('nodejs --version'), 'other');
  });

  await t.test('py command', () => {
    assert.equal(categorizeBash('py script.py'), 'python');
  });
  await t.test('python command', () => {
    assert.equal(categorizeBash('python main.py'), 'python');
  });
  await t.test('python3 starts with "python"', () => {
    assert.equal(categorizeBash('python3 main.py'), 'python');
  });

  await t.test('ls command', () => {
    assert.equal(categorizeBash('ls -la'), 'fs');
  });
  await t.test('cat command', () => {
    assert.equal(categorizeBash('cat file.txt'), 'fs');
  });
  await t.test('head command', () => {
    assert.equal(categorizeBash('head -n 20 file.txt'), 'fs');
  });
  await t.test('tail command', () => {
    assert.equal(categorizeBash('tail -f log.txt'), 'fs');
  });
  await t.test('mkdir command', () => {
    assert.equal(categorizeBash('mkdir -p src/lib'), 'fs');
  });
  await t.test('rm command (with space)', () => {
    assert.equal(categorizeBash('rm -rf dist'), 'fs');
  });
  await t.test('cp command', () => {
    assert.equal(categorizeBash('cp foo.js bar.js'), 'fs');
  });
  await t.test('mv command', () => {
    assert.equal(categorizeBash('mv old.js new.js'), 'fs');
  });

  await t.test('curl command', () => {
    assert.equal(categorizeBash('curl https://example.com'), 'curl');
  });
  await t.test('curl with flags', () => {
    assert.equal(categorizeBash('curl -s -o out.json https://api.example.com'), 'curl');
  });

  await t.test('other fallback for unknown command', () => {
    assert.equal(categorizeBash('docker build .'), 'other');
  });
  await t.test('other fallback for empty string', () => {
    assert.equal(categorizeBash(''), 'other');
  });
  await t.test('null input returns other', () => {
    assert.equal(categorizeBash(null), 'other');
  });
  await t.test('undefined input returns other', () => {
    assert.equal(categorizeBash(undefined), 'other');
  });

  await t.test('leading whitespace is trimmed: "  git status" → git', () => {
    assert.equal(categorizeBash('  git status'), 'git');
  });
  await t.test('leading whitespace is trimmed: "  npm test" → npm', () => {
    assert.equal(categorizeBash('  npm test'), 'npm');
  });
  await t.test('leading whitespace is trimmed: "  curl url" → curl', () => {
    assert.equal(categorizeBash('  curl https://example.com'), 'curl');
  });
  await t.test('leading whitespace is trimmed: "  python3 x.py" → python', () => {
    assert.equal(categorizeBash('  python3 x.py'), 'python');
  });
});

// ── parseJsonlFile ────────────────────────────────────────────────────────────

test('parseJsonlFile', async t => {
  const dir = join(tmpdir(), `kaaro-test-${process.pid}`);
  mkdirSync(dir, { recursive: true });

  const filePath = p => join(dir, p);

  try {
    await t.test('happy path: multiple valid JSON lines', () => {
      const records = [{ type: 'user', id: 1 }, { type: 'assistant', id: 2 }, { tokens: 42 }];
      const content = records.map(r => JSON.stringify(r)).join('\n');
      writeFileSync(filePath('happy.jsonl'), content, 'utf8');

      const result = parseJsonlFile(filePath('happy.jsonl'));

      assert.deepEqual(result.records, records);
      assert.ok(result.sizeBytes > 0, 'sizeBytes should be positive');
    });

    await t.test('sizeBytes matches Buffer.byteLength of written content', () => {
      const content = '{"a":1}\n{"b":"hello"}\n';
      writeFileSync(filePath('size.jsonl'), content, 'utf8');

      const result = parseJsonlFile(filePath('size.jsonl'));

      assert.equal(result.sizeBytes, Buffer.byteLength(content, 'utf8'));
    });

    await t.test('sizeBytes is correct for multi-byte UTF-8 characters', () => {
      const content = '{"emoji":"🎉"}\n';
      writeFileSync(filePath('utf8.jsonl'), content, 'utf8');

      const result = parseJsonlFile(filePath('utf8.jsonl'));

      assert.equal(result.sizeBytes, Buffer.byteLength(content, 'utf8'));
      assert.ok(result.sizeBytes > content.length, 'byte length should exceed char count for non-ASCII');
    });

    await t.test('empty file returns empty records and sizeBytes 0', () => {
      writeFileSync(filePath('empty.jsonl'), '', 'utf8');

      const result = parseJsonlFile(filePath('empty.jsonl'));

      assert.deepEqual(result.records, []);
      assert.equal(result.sizeBytes, 0);
    });

    await t.test('blank lines between records are ignored', () => {
      const content = '{"a":1}\n\n   \n{"b":2}\n\n';
      writeFileSync(filePath('blanks.jsonl'), content, 'utf8');

      const result = parseJsonlFile(filePath('blanks.jsonl'));

      assert.deepEqual(result.records, [{ a: 1 }, { b: 2 }]);
    });

    await t.test('malformed JSON line is skipped, valid lines are parsed', () => {
      const content = '{"good":1}\nNOT_JSON{{{bad\n{"also":"good"}\n';
      writeFileSync(filePath('malformed.jsonl'), content, 'utf8');

      const result = parseJsonlFile(filePath('malformed.jsonl'));

      assert.deepEqual(result.records, [{ good: 1 }, { also: 'good' }]);
    });

    await t.test('malformed-only file returns empty records with non-zero sizeBytes', () => {
      const content = 'not json at all\n{broken}\n';
      writeFileSync(filePath('all-bad.jsonl'), content, 'utf8');

      const result = parseJsonlFile(filePath('all-bad.jsonl'));

      assert.deepEqual(result.records, []);
      assert.equal(result.sizeBytes, Buffer.byteLength(content, 'utf8'));
    });

    await t.test('single valid JSON line with no trailing newline', () => {
      const content = '{"single":true}';
      writeFileSync(filePath('single.jsonl'), content, 'utf8');

      const result = parseJsonlFile(filePath('single.jsonl'));

      assert.deepEqual(result.records, [{ single: true }]);
      assert.equal(result.sizeBytes, Buffer.byteLength(content, 'utf8'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
