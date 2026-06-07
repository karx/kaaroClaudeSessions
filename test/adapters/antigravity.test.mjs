import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToNormalized } from '../../adapters/antigravity.mjs';
import { reduceSession } from '../../lib/session-reducer.mjs';
import { enrichSession } from '../../lib/enrich-session.mjs';
import {
  parseAntigravityRecords,
  deriveAntigravityProjectId,
  deriveAntigravityLabel,
  detectWorkspace,
} from '../../analyze-antigravity.mjs';

const SESSION_ID = 'c7f6b422-2184-4e11-ad6d-535a069e7347';

const GOLDEN_RECORDS = [
  {
    step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE',
    created_at: '2026-06-07T00:15:33Z',
    content: '<USER_REQUEST>\nSet up the database connection pool\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.5 Flash (Medium). No need to comment on this change.\n</USER_SETTINGS_CHANGE>',
  },
  {
    step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE',
    created_at: '2026-06-07T00:15:34Z',
    content: 'I will look at the files.',
    tool_calls: [
      {
        name: 'view_file',
        args: { AbsolutePath: '"D:/src/ebrain/README.md"', toolSummary: '"Viewing file"' },
      },
      {
        name: 'run_command',
        args: {
          CommandLine: '"git status"',
          Cwd: '"D:\\\\src\\\\ebrain"',
          WaitMsBeforeAsync: '2000',
        },
      },
    ],
  },
  {
    step_index: 4, source: 'MODEL', type: 'VIEW_FILE', status: 'ERROR',
    created_at: '2026-06-07T00:15:41Z',
    content: 'Permission denied.',
  },
];

function pipelineSession(records) {
  const session = reduceSession(recordsToNormalized(records), {
    session_id:      SESSION_ID,
    project_id:      null,
    project_label:   null,
    harness:         'antigravity',
    capabilities:    { size_proxy: 'tool_calls' },
  });
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

test('recordsToNormalized — emits expected kinds', () => {
  const norm = recordsToNormalized(GOLDEN_RECORDS);
  const kinds = norm.map(r => r.kind);
  assert.ok(kinds.includes('user_turn'));
  assert.ok(kinds.includes('session_meta'));
  assert.ok(kinds.includes('assistant_turn'));
  assert.ok(kinds.includes('tool_use'));
  assert.ok(kinds.includes('tool_result'));
});

test('adapter + reducer golden regression matches parseAntigravityRecords', () => {
  const viaParse = parseAntigravityRecords(GOLDEN_RECORDS, SESSION_ID);
  enrichSession(viaParse);
  const viaPipeline = pipelineSession(GOLDEN_RECORDS);

  const fields = [
    'session_id', 'project_id', 'project_label', 'harness', 'cwd', 'model',
    'user_turns', 'assistant_turns', 'tool_calls', 'tool_errors', 'slug',
    'message_count', 'tokens', 'tools', 'file_ops', 'bash_categories',
    'first_user_message', 'first_timestamp', 'last_timestamp', 'duration_ms',
  ];
  for (const f of fields) {
    assert.deepEqual(viaParse[f], viaPipeline[f], `mismatch on ${f}`);
  }
});