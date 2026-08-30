/**
 * hooks/skills-registry.mjs — per-harness skill file discovery + reading.
 *
 * Sibling concern to hooks/mcp-config.mjs: reads each harness's skills
 * directory (`<root>/<name>/SKILL.md`, YAML-frontmatter + Markdown body —
 * same convention Claude Code and Grok both already use on disk). A harness
 * with no known/existing skills root just yields [] — this is data-driven,
 * not a hardcoded "only these harnesses support skills" list, so a future
 * harness that grows a skills dir is picked up without a code change here.
 *
 * All file access is fail-soft (missing dir/file → [] or null, never throws)
 * and path-contained: readSkillFile/readSkillAsset reject any resolved path
 * that escapes the skill's own directory.
 */
import fs   from 'node:fs';
import path from 'node:path';

import {
  CLAUDE_SKILLS_ROOT, CODEX_SKILLS_ROOT, PI_SKILLS_ROOT, ANTIGRAVITY_SKILLS_ROOT,
  GROK_SKILLS_ROOT, OPENCODE_SKILLS_ROOT, COMMANDCODE_SKILLS_ROOT,
} from './harness-paths.mjs';

// VS Code/Copilot has no analogous "skills" directory concept — omitted
// deliberately rather than guessed.
const SKILLS_ROOTS = {
  'claude-code': CLAUDE_SKILLS_ROOT,
  codex: CODEX_SKILLS_ROOT,
  pi: PI_SKILLS_ROOT,
  antigravity: ANTIGRAVITY_SKILLS_ROOT,
  grok: GROK_SKILLS_ROOT,
  opencode: OPENCODE_SKILLS_ROOT,
  copilot: null,
  'command-code': COMMANDCODE_SKILLS_ROOT,
};

function rootFor(harnessId, root) {
  return root ?? SKILLS_ROOTS[harnessId] ?? null;
}

/** target is root itself, or strictly contained within it. */
function isContained(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Minimal `---\nkey: value\n---\nbody` reader — only top-level scalar keys. */
export function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw };
  const [, fmText, body] = m;
  const frontmatter = {};
  for (const line of fmText.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue; // skip nested/indented keys
    const kv = line.match(/^([\w.-]+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.length >= 2 && ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    frontmatter[kv[1]] = val;
  }
  return { frontmatter, body };
}

function isDirEntryDir(entry, parentDir) {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try { return fs.statSync(path.join(parentDir, entry.name)).isDirectory(); } catch { return false; }
  }
  return false;
}

/** List skills for one harness: [{ harness, name, dirName, path, description }]. */
export function discoverSkills(harnessId, { root } = {}) {
  const skillsRoot = rootFor(harnessId, root);
  if (!skillsRoot) return [];
  let entries;
  try { entries = fs.readdirSync(skillsRoot, { withFileTypes: true }); } catch { return []; }

  const out = [];
  for (const entry of entries) {
    if (!isDirEntryDir(entry, skillsRoot)) continue;
    const dirName = entry.name;
    const skillMdPath = path.join(skillsRoot, dirName, 'SKILL.md');
    let raw;
    try { raw = fs.readFileSync(skillMdPath, 'utf8'); } catch { continue; }
    const { frontmatter } = parseFrontmatter(raw);
    out.push({
      harness: harnessId,
      name: frontmatter.name || dirName,
      dirName,
      path: path.join(skillsRoot, dirName),
      description: frontmatter.description || '',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Full SKILL.md content + sibling filenames for one skill. null if not found/escapes root. */
export function readSkillFile(harnessId, dirName, { root } = {}) {
  const skillsRoot = rootFor(harnessId, root);
  if (!skillsRoot || !dirName) return null;
  const skillsRootAbs = path.resolve(skillsRoot);
  const skillDir = path.resolve(skillsRootAbs, dirName);
  if (skillDir === skillsRootAbs || !isContained(skillsRootAbs, skillDir)) return null;

  const skillMdPath = path.join(skillDir, 'SKILL.md');
  let raw;
  try { raw = fs.readFileSync(skillMdPath, 'utf8'); } catch { return null; }
  const { frontmatter, body } = parseFrontmatter(raw);

  let files = [];
  try {
    files = fs.readdirSync(skillDir, { withFileTypes: true })
      .filter(d => d.name !== 'SKILL.md' && (d.isFile() || d.isSymbolicLink()))
      .map(d => d.name);
  } catch { files = []; }

  return { harness: harnessId, dirName, name: frontmatter.name || dirName, frontmatter, body, files };
}

/** Raw content of one file living alongside a skill's SKILL.md. null if missing/escapes root. */
export function readSkillAsset(harnessId, dirName, filename, { root } = {}) {
  const skillsRoot = rootFor(harnessId, root);
  if (!skillsRoot || !dirName || !filename) return null;
  const skillsRootAbs = path.resolve(skillsRoot);
  const skillDir = path.resolve(skillsRootAbs, dirName);
  if (skillDir === skillsRootAbs || !isContained(skillsRootAbs, skillDir)) return null;

  const filePath = path.resolve(skillDir, filename);
  if (!isContained(skillDir, filePath) || filePath === skillDir) return null;

  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}
