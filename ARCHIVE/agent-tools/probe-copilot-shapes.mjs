// Probe 2: Copilot chatSessions semantics — request/response/token op shapes
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const wsRoot = join(process.env.APPDATA, 'Code/User/workspaceStorage');

// scan scale: all chatSessions files across workspaces
let jsonlFiles = [], jsonFiles = [];
for (const ws of readdirSync(wsRoot)) {
  const dir = join(wsRoot, ws, 'chatSessions');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f.endsWith('.jsonl')) jsonlFiles.push(p);
    else if (f.endsWith('.json')) jsonFiles.push(p);
  }
}
console.log(`scale: ${jsonlFiles.length} .jsonl + ${jsonFiles.length} .json session files`);

// the big live session
const f = jsonlFiles.sort((a, b) => statSync(b).size - statSync(a).size)[0];
console.log('probing:', f);
const ops = readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// 1. kind:0 snapshot — top keys + creationDate + requester
const snap = ops.find(o => o.kind === 0);
console.log('\n== kind0 keys:', Object.keys(snap.v).join(', '));
console.log('creationDate:', snap.v.creationDate, '→', new Date(snap.v.creationDate).toISOString());

// 2. requests append op — message shape
const reqOp = ops.find(o => o.kind === 2 && o.k.length === 1 && o.k[0] === 'requests');
if (reqOp) {
  const r = reqOp.v[0];
  console.log('\n== request append: keys:', Object.keys(r).join(', '));
  console.log('message keys:', Object.keys(r.message || {}).join(', '));
  console.log('message.text:', JSON.stringify((r.message?.text || '').slice(0, 100)));
  console.log('timestamp:', r.timestamp, r.timestamp ? new Date(r.timestamp).toISOString() : '');
  console.log('modelId:', r.modelId);
}

// 3. response item kinds across all response ops
const respKinds = {};
for (const op of ops) {
  const kp = (op.k || []).map(x => typeof x === 'number' ? '#' : x).join('.');
  if (op.kind === 2 && kp === 'requests.#.response') {
    for (const item of op.v) {
      const kind = item?.kind ?? (typeof item === 'string' ? 'STRING' : 'NO_KIND:' + Object.keys(item || {}).slice(0, 4).join(','));
      respKinds[kind] = (respKinds[kind] || 0) + 1;
    }
  }
}
console.log('\n== response item kinds:', JSON.stringify(respKinds, null, 1));

// 4. sample one toolInvocationSerialized: toolId + uris extraction
for (const op of ops) {
  if (op.kind !== 2) continue;
  const items = Array.isArray(op.v) ? op.v : [];
  const ti = items.find(i => i?.kind === 'toolInvocationSerialized');
  if (ti) {
    console.log('\n== toolInvocation: toolId:', ti.toolId, '| toolCallId:', ti.toolCallId);
    console.log('invocationMessage.value:', JSON.stringify((ti.invocationMessage?.value || '').slice(0, 120)));
    console.log('uris keys:', Object.keys(ti.invocationMessage?.uris || {}));
    break;
  }
}
// all distinct toolIds
const toolIds = {};
for (const op of ops) {
  if (op.kind !== 2 || !Array.isArray(op.v)) continue;
  for (const i of op.v) if (i?.kind === 'toolInvocationSerialized') toolIds[i.toolId] = (toolIds[i.toolId] || 0) + 1;
}
console.log('toolIds:', JSON.stringify(toolIds));

// 5. completionTokens + result + modelState set-ops
for (const op of ops) {
  const kp = (op.k || []).map(x => typeof x === 'number' ? '#' : x).join('.');
  if (op.kind === 1 && kp === 'requests.#.completionTokens')
    console.log('\n== completionTokens op: k=', JSON.stringify(op.k), 'v=', op.v);
  if (op.kind === 1 && kp === 'requests.#.result')
    console.log('== result op keys:', Object.keys(op.v || {}).join(', '), JSON.stringify(op.v?.timings || ''));
  if (op.kind === 1 && kp === 'customTitle')
    console.log('== customTitle:', JSON.stringify(op.v));
}

// 6. markdownContent sample (assistant text)
for (const op of ops) {
  if (op.kind !== 2 || !Array.isArray(op.v)) continue;
  const md = op.v.find(i => i?.kind === 'markdownContent');
  if (md) { console.log('\n== markdownContent keys:', Object.keys(md).join(','), 'value:', JSON.stringify(String(md.content?.value ?? md.value ?? '').slice(0, 80))); break; }
}

// 7. old .json format head
if (jsonFiles.length) {
  const old = JSON.parse(readFileSync(jsonFiles.sort((a, b) => statSync(b).size - statSync(a).size)[0], 'utf8'));
  console.log('\n== old .json format: top keys:', Object.keys(old).join(', '));
  console.log('version:', old.version, 'requests:', Array.isArray(old.requests) ? old.requests.length : typeof old.requests);
}
