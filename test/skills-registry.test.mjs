/**
 * test/skills-registry.test.mjs → hooks/skills-registry.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  parseFrontmatter, discoverSkills, readSkillFile, readSkillAsset,
} from '../hooks/skills-registry.mjs';

function tmp() {
  return mkdtempSync(path.join(tmpdir(), 'kaaro-skills-'));
}

function writeSkill(root, dirName, { name, description, body = 'body text' } = {}) {
  const dir = path.join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const fm = [
    '---',
    name !== undefined ? `name: ${name}` : null,
    description !== undefined ? `description: ${description}` : null,
    '---',
  ].filter(Boolean).join('\n');
  writeFileSync(path.join(dir, 'SKILL.md'), `${fm}\n${body}\n`);
  return dir;
}

// ── parseFrontmatter ────────────────────────────────────────────────────

test('parseFrontmatter: extracts top-level scalar keys, skips nested', () => {
  const raw = '---\nname: agent-log\ndescription: Fetch and view sessions\nmetadata:\n  type: project\n---\nBody here.\n';
  const { frontmatter, body } = parseFrontmatter(raw);
  assert.equal(frontmatter.name, 'agent-log');
  assert.equal(frontmatter.description, 'Fetch and view sessions');
  assert.equal(frontmatter.metadata, ''); // nested block's own header line is captured as an empty scalar; the indented sub-keys are skipped
  assert.equal(body.trim(), 'Body here.');
});

test('parseFrontmatter: no frontmatter block → whole text as body', () => {
  const { frontmatter, body } = parseFrontmatter('just a plain file\n');
  assert.deepEqual(frontmatter, {});
  assert.equal(body, 'just a plain file\n');
});

// ── discoverSkills ──────────────────────────────────────────────────────

test('discoverSkills: lists skills sorted by name, skips non-dirs and dirs without SKILL.md', () => {
  const root = tmp();
  writeSkill(root, 'zeta', { name: 'zeta-skill', description: 'Z desc' });
  writeSkill(root, 'alpha', { name: 'alpha-skill', description: 'A desc' });
  mkdirSync(path.join(root, 'empty-dir')); // no SKILL.md
  writeFileSync(path.join(root, 'stray.txt'), 'not a dir');

  const skills = discoverSkills('claude-code', { root });
  assert.deepEqual(skills.map(s => s.name), ['alpha-skill', 'zeta-skill']);
  assert.equal(skills[0].description, 'A desc');
  assert.equal(skills[0].harness, 'claude-code');

  rmSync(root, { recursive: true, force: true });
});

test('discoverSkills: falls back to dirName when frontmatter has no name', () => {
  const root = tmp();
  writeSkill(root, 'my-skill', { description: 'no name field' });
  const skills = discoverSkills('grok', { root });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'my-skill');
  rmSync(root, { recursive: true, force: true });
});

test('discoverSkills: missing root dir → []', () => {
  assert.deepEqual(discoverSkills('claude-code', { root: 'Z:/does/not/exist' }), []);
});

test('discoverSkills: harness with no known skills root → []', () => {
  assert.deepEqual(discoverSkills('copilot'), []);
});

test('discoverSkills: follows a symlinked skill dir', { skip: process.platform === 'win32' ? 'symlink perms vary on CI Windows runners' : false }, () => {
  const root = tmp();
  const real = writeSkill(root, 'real-skill', { name: 'real-skill', description: 'd' });
  try {
    symlinkSync(real, path.join(root, 'linked-skill'), 'dir');
  } catch {
    rmSync(root, { recursive: true, force: true });
    return; // no symlink privilege — skip silently rather than fail the suite
  }
  const skills = discoverSkills('claude-code', { root });
  assert.ok(skills.some(s => s.dirName === 'linked-skill'));
  rmSync(root, { recursive: true, force: true });
});

// ── readSkillFile ───────────────────────────────────────────────────────

test('readSkillFile: returns frontmatter, body, and sibling filenames', () => {
  const root = tmp();
  const dir = writeSkill(root, 'my-skill', { name: 'my-skill', description: 'd', body: 'Full body.' });
  writeFileSync(path.join(dir, 'reference.md'), 'ref content');
  mkdirSync(path.join(dir, 'scripts'));

  const skill = readSkillFile('claude-code', 'my-skill', { root });
  assert.equal(skill.name, 'my-skill');
  assert.equal(skill.body.trim(), 'Full body.');
  assert.deepEqual(skill.files, ['reference.md']); // subdirs excluded

  rmSync(root, { recursive: true, force: true });
});

test('readSkillFile: unknown skill dir → null', () => {
  const root = tmp();
  assert.equal(readSkillFile('claude-code', 'nope', { root }), null);
  rmSync(root, { recursive: true, force: true });
});

test('readSkillFile: path traversal in dirName is rejected', () => {
  const root = tmp();
  writeSkill(root, 'a-skill', { name: 'a-skill' });
  assert.equal(readSkillFile('claude-code', '../../../etc', { root }), null);
  assert.equal(readSkillFile('claude-code', '..', { root }), null);
  rmSync(root, { recursive: true, force: true });
});

// ── readSkillAsset ──────────────────────────────────────────────────────

test('readSkillAsset: reads a sibling file', () => {
  const root = tmp();
  const dir = writeSkill(root, 'my-skill', { name: 'my-skill' });
  writeFileSync(path.join(dir, 'notes.md'), 'sibling content');

  assert.equal(readSkillAsset('claude-code', 'my-skill', 'notes.md', { root }), 'sibling content');

  rmSync(root, { recursive: true, force: true });
});

test('readSkillAsset: traversal outside the skill dir is rejected', () => {
  const root = tmp();
  writeSkill(root, 'my-skill', { name: 'my-skill' });
  writeFileSync(path.join(root, 'secret.txt'), 'top secret');

  assert.equal(readSkillAsset('claude-code', 'my-skill', '../secret.txt', { root }), null);
  assert.equal(readSkillAsset('claude-code', 'my-skill', '../../etc/passwd', { root }), null);

  rmSync(root, { recursive: true, force: true });
});

test('readSkillAsset: missing file → null', () => {
  const root = tmp();
  writeSkill(root, 'my-skill', { name: 'my-skill' });
  assert.equal(readSkillAsset('claude-code', 'my-skill', 'nope.txt', { root }), null);
  rmSync(root, { recursive: true, force: true });
});
