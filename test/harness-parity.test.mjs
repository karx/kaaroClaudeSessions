/**
 * test/harness-parity.test.mjs
 *
 * Ensures each harness's "legacy" entry point and the normalized pipeline
 * (recordsToNormalized + reduceSession) produce identical Session objects.
 *
 * IMPORTANT (per CODE-REVIEW-FINDINGS.md #5 and plan):
 *   - This is an *internal consistency* check per harness.
 *   - It does NOT prove absolute correctness against raw JSONL intent or
 *     historical single-increment behavior.
 *   - For CC, the legacy path (analyzeSession) was refactored to use the same
 *     normalized functions as the pipeline, making the comparison circular
 *     for counts like assistant_turns.
 *   - Independent correctness is covered by dedicated tests, e.g.
 *     "assistant_turns counts assistant records, not per-block" in
 *     analyze-session-tokens.test.mjs (the multi-block TDD case).
 *
 * When adding a new harness, extend the registry + adapter + scanner,
 * then add a parity test here (or mark as N/A if no legacy direct parser).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToNormalized as ccToNorm } from '../adapters/claude-code.mjs';
import { recordsToNormalized as piToNorm } from '../adapters/pi.mjs';
import { recordsToNormalized as agToNorm } from '../adapters/antigravity.mjs';
import { reduceSession } from '../lib/session-reducer.mjs';
import { enrichSession } from '../lib/enrich-session.mjs';
import { analyzeSession, parseJsonlFile, deriveLabel } from '../analyze.mjs';
import { parsePiRecords, derivePiLabel } from '../analyze-pi.mjs';
import {
  parseAntigravityRecords,
  deriveAntigravityProjectId,
  deriveAntigravityLabel,
  detectWorkspace,
} from '../analyze-antigravity.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PARITY_FIELDS = [
  'harness', 'user_turns', 'assistant_turns', 'tool_calls', 'tool_errors',
  'tokens', 'tools', 'file_ops', 'bash_categories', 'first_user_message',
  'model', 'message_count', 'slug',
];

function assertParity(legacy, pipeline, harness) {
  for (const f of PARITY_FIELDS) {
    assert.deepEqual(legacy[f], pipeline[f], `[${harness}] mismatch on ${f}`);
  }
}

function finalizeAntigravity(session, records) {
  for (const rec of records) {
    const ts = rec.created_at;
    if (!ts) continue;
    if (!session.first_timestamp || ts < session.first_timestamp) session.first_timestamp = ts;
    if (!session.last_timestamp  || ts > session.last_timestamp)  session.last_timestamp  = ts;
  }
  const cwd = detectWorkspace(records);
  session.cwd           = cwd;
  session.project_id    = deriveAntigravityProjectId(cwd);
  session.project_label = deriveAntigravityLabel(cwd);
  if (session.first_timestamp && session.last_timestamp) {
    session.duration_ms =
      new Date(session.last_timestamp).getTime() -
      new Date(session.first_timestamp).getTime();
  }
  enrichSession(session);
  return session;
}

test('harness parity — claude-code', () => {
  // Note: CC parity is the most sensitive due to historical refactoring of
  // analyzeSession into the normalized path. The independent multi-block
  // correctness test (in analyze-session-tokens) is the real guard for
  // assistant_turns === 1 per assistant JSONL record.

  const records = [
    {
      type: 'user', timestamp: '2026-05-01T10:00:00.000Z', gitBranch: 'feat/x',
      message: { content: 'Please review the auth module changes' },
    },
    {
      type: 'assistant', timestamp: '2026-05-01T10:02:00.000Z',
      message: {
        model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 25 },
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/auth.js' } }],
      },
    },
  ];
  const projectId = 'D--src-myapp';
  const dir = join(tmpdir(), 'kaaro-parity-cc-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'parity-sess.jsonl');
  writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n'), 'utf8');
  try {
    const legacy = analyzeSession(projectId, filePath);
    const { records: parsed, sizeBytes } = parseJsonlFile(filePath);
    const pipeline = reduceSession(ccToNorm(parsed), {
      session_id: 'parity-sess', project_id: projectId,
      project_label: deriveLabel(projectId), harness: 'claude-code',
      file_size_bytes: sizeBytes, capabilities: { size_proxy: 'tokens_work' },
    });
    enrichSession(pipeline);
    assertParity(legacy, pipeline, 'claude-code');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness parity — pi', () => {
  const records = [
    {
      type: 'session', timestamp: '2026-04-26T14:22:51.638Z', cwd: 'D:\\src\\ebrain',
    },
    {
      type: 'message', timestamp: '2026-04-26T14:23:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'run the integration tests please' }],
      },
    },
    {
      type: 'message', timestamp: '2026-04-26T14:23:05.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'npm test' } }],
        provider: 'openai', model: 'gpt-5.4',
        usage: { input: 20, output: 10 },
        stopReason: 'stop',
      },
    },
  ];
  const sessionId = '019dca2b-f4f5-7609-96ae-fe883f7a03db';
  const projectId = '--D--src-ebrain--';
  const legacy = parsePiRecords(records, sessionId, projectId);
  enrichSession(legacy);
  const pipeline = reduceSession(piToNorm(records), {
    session_id: sessionId, project_id: projectId,
    project_label: derivePiLabel(projectId), harness: 'pi',
    capabilities: { size_proxy: 'tokens_work' },
  });
  enrichSession(pipeline);
  assertParity(legacy, pipeline, 'pi');
});

test('harness parity — antigravity', () => {
  const records = [
    {
      source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-06-07T00:15:33Z',
      content: '<USER_REQUEST>\nDeploy the staging environment\n</USER_REQUEST>',
    },
    {
      source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-06-07T00:15:34Z',
      tool_calls: [{
        name: 'run_command',
        args: {
          CommandLine: '"npm run build"',
          Cwd: '"D:\\\\src\\\\ebrain"',
        },
      }],
    },
  ];
  const sessionId = 'c7f6b422-2184-4e11-ad6d-535a069e7347';
  const legacy = parseAntigravityRecords(records, sessionId);
  enrichSession(legacy);
  const pipeline = finalizeAntigravity(
    reduceSession(agToNorm(records), {
      session_id: sessionId, project_id: null, project_label: null,
      harness: 'antigravity', capabilities: { size_proxy: 'tool_calls' },
    }),
    records,
  );
  assertParity(legacy, pipeline, 'antigravity');
});