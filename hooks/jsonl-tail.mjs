/**
 * lib/jsonl-tail.mjs
 *
 * Reads only the bytes appended since the last known byte offset.
 * Parses complete JSONL lines only — incomplete lines (no trailing \n)
 * are excluded and the offset stays at the last complete newline so the
 * next call will pick them up once they're complete.
 *
 * @param {string} filePath
 * @param {number} byteOffset  - byte position to start reading from (default 0)
 * @param {{ maxBytes?: number }} [opts] — delta size cap (shares MAX_JSONL_BYTES
 *   with parseJsonlFile by default) + test seam
 * @returns {{ records: object[], newOffset: number, skippedBytes?: number }}
 */

import fs from 'fs';
import { MAX_JSONL_BYTES } from './jsonl-io.mjs';

export function tailRead(filePath, byteOffset = 0, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_JSONL_BYTES;
  let buf;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= byteOffset) return { records: [], newOffset: byteOffset };
      const readLen = size - byteOffset;
      // Refuse to bulk-allocate an unbounded delta — e.g. the first watch
      // event after a restart, on a transcript that grew huge (or huger)
      // while unwatched. Jump straight to EOF so we don't retry the same
      // oversized delta forever; caller decides whether/how to log it.
      if (readLen > maxBytes) return { records: [], newOffset: size, skippedBytes: readLen };
      buf = Buffer.allocUnsafe(readLen);
      fs.readSync(fd, buf, 0, readLen, byteOffset);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if (e.code === 'ENOENT') return { records: [], newOffset: 0 };
    throw e;
  }

  // Find the last newline byte so we only process complete lines.
  // A file written mid-line has no trailing \n — we leave those bytes
  // unread and return them on the next call once the line is complete.
  let lastNL = -1;
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i] === 0x0a) { lastNL = i; break; }
  }
  if (lastNL === -1) return { records: [], newOffset: byteOffset };

  const completePart = buf.slice(0, lastNL + 1).toString('utf8');
  const newOffset    = byteOffset + lastNL + 1;

  const records = [];
  for (const raw of completePart.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  return { records, newOffset };
}
