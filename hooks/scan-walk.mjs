/**
 * hooks/scan-walk.mjs — the shared scanner skeleton.
 *
 * Every harness scan follows the same outer shape:
 *   1. readdir the root (ENOENT → null: harness not installed, not an error)
 *   2. iterate session entries (harness-specific — supplied as a generator)
 *   3. analyze each entry with per-entry error isolation (one corrupt
 *      session must never abort the scan)
 *   4. return the { harness, source_dir, sessions } envelope
 *
 * The iterate generator receives the root's Dirent[] and yields
 * { id, analyze } pairs; analyze() returns a session object or null to skip.
 */
import fs from 'fs';

/**
 * @param {string} root
 * @param {string} harness
 * @param {(entries: import('fs').Dirent[]) => Iterable<{ id: string, analyze: () => object|null }>} iterate
 * @returns {{ harness: string, source_dir: string, sessions: object[] }|null}
 */
export function walkSessions(root, harness, iterate) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  const sessions = [];
  for (const { id, analyze } of iterate(entries)) {
    try {
      const session = analyze();
      if (session) sessions.push(session);
    } catch (err) {
      console.error(`  !! [${harness}] ${id}: ${err.message}`);
    }
  }
  return { harness, source_dir: root, sessions };
}

/**
 * Directory names from a Dirent[] — directories only, sorted.
 * @param {import('fs').Dirent[]} entries
 * @param {{ skipHidden?: boolean }} [opts] — skipHidden drops dot-dirs
 * @returns {string[]}
 */
export function dirNames(entries, opts = {}) {
  return entries
    .filter(d => d.isDirectory() && !(opts.skipHidden && d.name.startsWith('.')))
    .map(d => d.name)
    .sort();
}
