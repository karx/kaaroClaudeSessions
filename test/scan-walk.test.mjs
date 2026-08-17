/**
 * test/scan-walk.test.mjs → hooks/scan-walk.mjs
 *
 * The shared scanner skeleton: ENOENT-tolerant root listing, error-isolated
 * per-session analysis, and the { harness, source_dir, sessions } envelope.
 * Harness specifics stay in each analyzer's iterate generator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { walkSessions, dirNames } from '../hooks/scan-walk.mjs';

function withTempDir(fn) {
  const dir = join(tmpdir(), 'kaaro-scan-walk-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('walkSessions — missing root returns null', () => {
  const result = walkSessions('Z:/definitely/not/here', 'pi', function* () {});
  assert.equal(result, null);
});

test('walkSessions — envelope carries harness, source_dir, sessions', () => {
  withTempDir((root) => {
    mkdirSync(join(root, 'proj-a'));
    const result = walkSessions(root, 'pi', function* (entries) {
      for (const name of dirNames(entries)) {
        yield { id: name, analyze: () => ({ session_id: name }) };
      }
    });
    assert.equal(result.harness, 'pi');
    assert.equal(result.source_dir, root);
    assert.deepEqual(result.sessions, [{ session_id: 'proj-a' }]);
  });
});

test('walkSessions — analyze errors are isolated per entry', () => {
  withTempDir((root) => {
    mkdirSync(join(root, 'bad'));
    mkdirSync(join(root, 'good'));
    const result = walkSessions(root, 'grok', function* (entries) {
      for (const name of dirNames(entries)) {
        yield {
          id: name,
          analyze: () => {
            if (name === 'bad') throw new Error('corrupt');
            return { session_id: name };
          },
        };
      }
    });
    assert.deepEqual(result.sessions, [{ session_id: 'good' }]);
  });
});

test('walkSessions — analyze returning null/undefined is skipped silently', () => {
  withTempDir((root) => {
    mkdirSync(join(root, 'empty'));
    const result = walkSessions(root, 'copilot', function* (entries) {
      for (const name of dirNames(entries)) {
        yield { id: name, analyze: () => null };
      }
    });
    assert.deepEqual(result.sessions, []);
  });
});

test('dirNames — directories only, sorted, files excluded', () => {
  withTempDir((root) => {
    mkdirSync(join(root, 'b-dir'));
    mkdirSync(join(root, 'a-dir'));
    writeFileSync(join(root, 'file.jsonl'), '{}', 'utf8');
    const result = walkSessions(root, 'x', function* (entries) {
      yield { id: 'names', analyze: () => ({ names: dirNames(entries) }) };
    });
    assert.deepEqual(result.sessions[0].names, ['a-dir', 'b-dir']);
  });
});

test('dirNames — skipHidden filters dot-directories', () => {
  withTempDir((root) => {
    mkdirSync(join(root, '.hidden'));
    mkdirSync(join(root, 'visible'));
    const result = walkSessions(root, 'antigravity', function* (entries) {
      yield { id: 'names', analyze: () => ({ names: dirNames(entries, { skipHidden: true }) }) };
    });
    assert.deepEqual(result.sessions[0].names, ['visible']);
  });
});
