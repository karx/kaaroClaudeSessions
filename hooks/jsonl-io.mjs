/**
 * hooks/jsonl-io.mjs — the single JSONL file reader for all analyzers.
 *
 * One JSONL file = one session transcript (or transcript fragment).
 * Malformed lines are skipped, never fatal — harnesses occasionally write
 * partial lines while a session is live.
 */
import fs from 'fs';

/**
 * @param {string} filePath
 * @returns {{ records: object[], sizeBytes: number }}
 */
export function parseJsonlFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return { records, sizeBytes: Buffer.byteLength(raw, 'utf8') };
}
