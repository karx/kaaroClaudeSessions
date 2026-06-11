import path from 'path';
import { resolveSessionFile } from '../lib/session-resolver.mjs';
import { readGrokSession } from '../analyze-grok.mjs';
import { reconstructTraceTree } from '../lib/context-tree.mjs';

const sessionId = process.argv[2] || '019ea1c9-46ee-77e0-bf36-f87a6403b5db';
const found = resolveSessionFile(sessionId, { harness: 'grok' });
if (!found) { console.error('session not found'); process.exit(1); }

const grok = readGrokSession(path.dirname(found.filePath));
const tree = reconstructTraceTree(grok.records, 'grok', {
  ai_title:   grok.summary?.generated_title || grok.summary?.session_summary || null,
  git_branch: grok.summary?.head_branch || null,
});

console.log(JSON.stringify({
  session_id: sessionId,
  ai_title: tree.ai_title,
  segments: tree.segments.length,
  total_turns: tree.segments.reduce((n, s) => n + (s.turns?.length || 0), 0),
  tool_calls: tree.segments.reduce((n, s) => n + s.tool_calls, 0),
  first_seg: tree.segments[0] ? {
    user_turns: tree.segments[0].user_turns,
    assistant_turns: tree.segments[0].assistant_turns,
    tools: Object.keys(tree.segments[0].tool_summary || {}).slice(0, 8),
  } : null,
}, null, 2));