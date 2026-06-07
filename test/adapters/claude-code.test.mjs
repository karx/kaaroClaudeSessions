import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { recordsToNormalized } from '../../adapters/claude-code.mjs';
import { reduceSession } from '../../lib/session-reducer.mjs';
import { enrichSession } from '../../lib/enrich-session.mjs';
import { analyzeSession, parseJsonlFile, deriveLabel } from '../../analyze.mjs';

function writeTempJsonl(records, sessionId = 'golden-sess') {
  const dir = join(tmpdir(), 'kaaro-cc-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, sessionId + '.jsonl');
  writeFileSync(filePath, records.map(r => JSON.stringify(r)).join('\n'), 'utf8');
  return { dir, filePath };
}

const GOLDEN_RECORDS = [
  {
    type: 'user', timestamp: '2026-05-01T10:00:00.000Z', gitBranch: 'main',
    message: { content: '<command-name>review</command-name> fix the auth module please' },
  },
  {
    type: 'system', subtype: 'compact_boundary', timestamp: '2026-05-01T10:01:00.000Z',
  },
  {
    type: 'ai-title', timestamp: '2026-05-01T10:01:01.000Z', aiTitle: 'Auth fix session',
  },
  {
    type: 'assistant', timestamp: '2026-05-01T10:02:00.000Z',
    message: {
      model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 },
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'D:/src/app/auth.js' } },
        { type: 'tool_use', name: 'Agent', input: { description: 'review sub' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'git status' } },
      ],
    },
  },
  {
    type: 'system', subtype: 'turn_duration', timestamp: '2026-05-01T10:03:00.000Z',
    slug: 'auth-fix-slug', durationMs: 180000, messageCount: 2, gitBranch: 'main',
  },
];

test('recordsToNormalized — emits expected kinds', () => {
  const norm = recordsToNormalized(GOLDEN_RECORDS);
  const kinds = norm.map(r => r.kind);
  assert.ok(kinds.includes('user_turn'));
  assert.ok(kinds.includes('context_reset'));
  assert.ok(kinds.includes('skill_invoke'));
  assert.ok(kinds.includes('tool_use'));
  assert.ok(kinds.includes('tokens'));
  assert.ok(kinds.filter(k => k === 'tool_use').length >= 3);
});

test('adapter + reducer golden regression matches analyzeSession', () => {
  const projectId = 'D--src-myapp';
  const { dir, filePath } = writeTempJsonl(GOLDEN_RECORDS);
  try {
    const viaAnalyze = analyzeSession(projectId, filePath);
    const { records, sizeBytes } = parseJsonlFile(filePath);
    const viaPipeline = reduceSession(recordsToNormalized(records), {
      session_id:      'golden-sess',
      project_id:      projectId,
      project_label:   deriveLabel(projectId),
      harness:         'claude-code',
      file_size_bytes: sizeBytes,
      capabilities:    { size_proxy: 'tokens_work' },
    });
    enrichSession(viaPipeline);

    const fields = [
      'session_id', 'project_id', 'harness', 'user_turns', 'assistant_turns',
      'tool_calls', 'context_resets', 'ai_title', 'subagent_count', 'slug',
      'skills', 'git_branch', 'branches', 'tokens', 'tools', 'file_ops',
      'bash_categories', 'first_user_message', 'cache_hit_rate', 'duration_min',
    ];
    for (const f of fields) {
      assert.deepEqual(viaAnalyze[f], viaPipeline[f], `mismatch on ${f}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});