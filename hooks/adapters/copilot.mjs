/**
 * adapters/copilot.mjs
 *
 * Converts GitHub Copilot (VS Code) chatSessions records → NormalizedRecord[].
 *
 * Input is the session's op-log: JSONL lines of
 *   { kind: 0, v }        — full session snapshot (may carry request history)
 *   { kind: 1, k, v }     — set value at keypath
 *   { kind: 2, k, v }     — append items to array at keypath
 * The pre-op single-JSON dump format (no `kind`, has `requests`) is accepted
 * as a snapshot for back-compat with older chatSessions/*.json files.
 *
 * Signal extraction:
 *   requests append            → user_turn (+ session_meta model)
 *   requests.#.response append → assistant_turn (once per request index),
 *                                tool_use (toolInvocationSerialized / textEditGroup),
 *                                content_block text/thinking
 *   requests.#.completionTokens→ tokens (output only — Copilot exposes no
 *                                input/cache counts)
 *   customTitle                → session_meta ai_title
 * All other kind:1 sets are VS Code UI state (inputState, modelState, result
 * timings, …) — known noise, silenced. Unknown response item kinds surface
 * through the unknown_record catch-all.
 */

import { copilotToolName, copilotUriToPath, invocationFilePath } from '../helpers/copilot-helpers.mjs';

const HARNESS = 'copilot';

function toIso(ms) {
  return typeof ms === 'number' ? new Date(ms).toISOString() : null;
}

function keypath(op) {
  // k is an array of path segments in the real op-log; tolerate a bare string
  // or missing k so a malformed op degrades to unknown_record, never a throw
  const k = Array.isArray(op.k) ? op.k : (typeof op.k === 'string' ? [op.k] : []);
  return k.map(x => (typeof x === 'number' ? '#' : x)).join('.');
}

function plainText(md) {
  // IMarkdownString value with "[label](uri)" links → keep label text
  return String(md ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
}

function responseItemToNormalized(item) {
  if (!item || typeof item !== 'object') return [];

  if (item.kind === 'toolInvocationSerialized') {
    return [{
      kind: 'tool_use', harness: HARNESS, ts: null,
      tool: copilotToolName(item.toolId),
      category: null,
      input: {
        file_path:   invocationFilePath(item),
        command:     item.toolSpecificData?.command,
        description: plainText(item.invocationMessage?.value) || null,
      },
    }];
  }

  if (item.kind === 'textEditGroup') {
    return [{
      kind: 'tool_use', harness: HARNESS, ts: null,
      tool: 'editFile', category: null,
      input: { file_path: copilotUriToPath(item.uri) },
    }];
  }

  if (item.kind === 'thinking') {
    return [{
      kind: 'content_block', harness: HARNESS, ts: null,
      block_type: 'thinking', text: String(item.value ?? ''),
    }];
  }

  if (item.kind === undefined && typeof item.value === 'string') { // IMarkdownString
    return [{
      kind: 'content_block', harness: HARNESS, ts: null,
      block_type: 'text', text: item.value,
    }];
  }

  if (item.kind === 'inlineReference') return []; // reference chips — chrome

  return [{ kind: 'unknown_record', harness: HARNESS, ts: null, raw_type: `response:${item.kind}` }];
}

export function recordsToNormalized(records) {
  const out = [];
  const assistantEmitted = new Set(); // request index → assistant_turn emitted
  let requestCount = 0;               // session-order index for appended requests

  function emitResponseItems(items, reqIdx) {
    if (items.length && !assistantEmitted.has(reqIdx)) {
      assistantEmitted.add(reqIdx);
      out.push({ kind: 'assistant_turn', harness: HARNESS, ts: null });
    }
    for (const item of items) out.push(...responseItemToNormalized(item));
  }

  function emitRequest(req, reqIdx) {
    out.push({
      kind: 'user_turn', harness: HARNESS, ts: toIso(req.timestamp),
      text: req.message?.text || null,
    });
    if (req.modelId) {
      out.push({ kind: 'session_meta', harness: HARNESS, ts: toIso(req.timestamp), model: req.modelId, overwrite: true });
    }
    if (Array.isArray(req.response) && req.response.length) emitResponseItems(req.response, reqIdx);
    if (typeof req.completionTokens === 'number') {
      out.push({
        kind: 'tokens', harness: HARNESS, ts: toIso(req.timestamp),
        tokens: { input: 0, output: req.completionTokens, cache_create: 0, cache_read: 0 },
      });
    }
  }

  function emitSnapshot(v) {
    out.push({
      kind: 'session_meta', harness: HARNESS, ts: toIso(v.creationDate),
      ai_title: v.customTitle || null,
    });
    (v.requests || []).forEach((req, i) => emitRequest(req, i));
    requestCount = (v.requests || []).length;
  }

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;

    if (rec.kind === 0 && rec.v) { emitSnapshot(rec.v); continue; }
    if (rec.kind === undefined && Array.isArray(rec.requests)) { emitSnapshot(rec); continue; } // old dump

    const kp = keypath(rec);

    if (rec.kind === 2) {
      if (kp === 'requests') {
        for (const req of (Array.isArray(rec.v) ? rec.v : [])) emitRequest(req, requestCount++);
        continue;
      }
      if (kp === 'requests.#.response') {
        emitResponseItems(Array.isArray(rec.v) ? rec.v : [], rec.k[1]);
        continue;
      }
      continue; // other array appends (contentReferences, codeCitations, …) — chrome
    }

    if (rec.kind === 1) {
      if (kp === 'requests.#.completionTokens' && typeof rec.v === 'number') {
        out.push({
          kind: 'tokens', harness: HARNESS, ts: null,
          tokens: { input: 0, output: rec.v, cache_create: 0, cache_read: 0 },
        });
      } else if (kp === 'customTitle' && rec.v) {
        out.push({ kind: 'session_meta', harness: HARNESS, ts: null, ai_title: String(rec.v) });
      }
      continue; // all other sets are UI state — known noise
    }

    out.push({ kind: 'unknown_record', harness: HARNESS, ts: null, raw_type: `op:kind${rec.kind}` });
  }

  return out;
}
