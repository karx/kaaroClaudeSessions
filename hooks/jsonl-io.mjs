/**
 * hooks/jsonl-io.mjs — the single JSONL file reader for all analyzers.
 *
 * One JSONL file = one session transcript (or transcript fragment).
 * Malformed lines are skipped, never fatal — harnesses occasionally write
 * partial lines while a session is live.
 */
import fs from 'fs';

// Guards against runaway/corrupt logs (observed: a Grok session's
// updates.jsonl grew to 3.15GB, and a synchronous readFileSync of that
// size hard-crashes the process — an unrecoverable OOM abort, not a
// catchable JS error, so per-session try/catch upstream can't save us).
// 512MB comfortably covers legitimate long-running sessions.
export const MAX_JSONL_BYTES = 512 * 1024 * 1024;

/**
 * @param {string} filePath
 * @param {{ maxBytes?: number }} [opts] — test seam for the size cap
 * @returns {{ records: object[], sizeBytes: number }}
 */
export function parseJsonlFile(filePath, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_JSONL_BYTES;
  const { size } = fs.statSync(filePath);
  if (size > maxBytes) {
    throw new Error(
      `JSONL file too large to parse (${(size / 1024 / 1024).toFixed(1)}MB > ${(maxBytes / 1024 / 1024).toFixed(1)}MB cap): ${filePath}`
    );
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return { records, sizeBytes: Buffer.byteLength(raw, 'utf8') };
}
