import fs from 'fs';
import path from 'path';
import os from 'os';
import { tailRead } from '../lib/jsonl-tail.mjs';
import { normRecordsToPulses } from '../lib/pulse-transformer.mjs';
import { recordsToNormalized } from '../adapters/grok.mjs';

const sessionId = '019ea1c9-46ee-77e0-bf36-f87a6403b5db';
const filePath = path.join(
  os.homedir(), '.grok', 'sessions',
  'D%3A%5Csrc%5CkaaroSessions', sessionId, 'updates.jsonl',
);

const stat = fs.statSync(filePath);
const start = Math.max(0, stat.size - 200_000);
const { records } = tailRead(filePath, start);
const ctx = {
  harness: 'grok', session_id: sessionId,
  slug: sessionId.slice(0, 8),
  project_id: 'D--src-kaaroSessions',
  project_label: 'kaaroSessions',
};

const nrs    = recordsToNormalized(records);
const pulses = normRecordsToPulses(nrs, ctx, { tokens: false });

const toolCalls = pulses.filter(p => p.event === 'tool_call');
const words     = pulses.filter(p => p.event === 'words');
console.log(JSON.stringify({
  file: filePath,
  bytes_from: start,
  records: records.length,
  tool_call_pulses: toolCalls.length,
  words_pulses: words.length,
  recent_tools: toolCalls.slice(-8).map(p => ({ tool: p.data.tool, slug: p.data.slug, where: p.data.where })),
}, null, 2));
