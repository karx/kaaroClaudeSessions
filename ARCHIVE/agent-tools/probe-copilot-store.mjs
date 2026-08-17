// Probe: VS Code Copilot chat storage — JSONL op-log shapes + state.vscdb chat keys
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const wsRoot = join(process.env.APPDATA, 'Code/User/workspaceStorage');

// --- Part A: the live JSONL op-log ---
const f = join(wsRoot, 'e07ec4b76ec1cba51ba84e69683d85e4/chatSessions/052d579c-9e9f-4c40-989b-b6923159f2dd.jsonl');
const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
console.log('=== A. JSONL op-log:', lines.length, 'ops ===');
const kindCounts = {};
const keyPaths = {};
for (const line of lines) {
  let op; try { op = JSON.parse(line); } catch { continue; }
  kindCounts[op.kind] = (kindCounts[op.kind] || 0) + 1;
  if (op.kind !== 0) {
    const kp = (op.k || []).map(x => typeof x === 'number' ? '#' : x).join('.');
    keyPaths[`k${op.kind}:${kp}`] = (keyPaths[`k${op.kind}:${kp}`] || 0) + 1;
  }
}
console.log('kind counts:', JSON.stringify(kindCounts));
console.log('top keypaths:');
Object.entries(keyPaths).sort((a, b) => b[1] - a[1]).slice(0, 30)
  .forEach(([k, c]) => console.log(`  ${c}  ${k}`));

// sample: a request append op (new user request) and a response-part op
for (const line of lines) {
  const op = JSON.parse(line);
  const kp = (op.k || []).map(x => typeof x === 'number' ? '#' : x).join('.');
  if (kp === 'requests.#' && op.v?.message) {
    console.log('\n=== sample requests.# append op (truncated 1500) ===');
    console.log(JSON.stringify(op).slice(0, 1500));
    break;
  }
}
const respOps = lines.map(l => JSON.parse(l)).filter(op => {
  const kp = (op.k || []).map(x => typeof x === 'number' ? '#' : x).join('.');
  return kp.includes('response') && JSON.stringify(op.v || '').includes('toolId');
});
if (respOps.length) {
  console.log('\n=== sample response op containing toolId (truncated 1500) ===');
  console.log(JSON.stringify(respOps[0]).slice(0, 1500));
}

// --- Part B: state.vscdb chat-related keys across workspaces ---
console.log('\n=== B. state.vscdb chat keys (3 newest workspaces) ===');
const wsDirs = readdirSync(wsRoot)
  .map(d => join(wsRoot, d))
  .filter(d => existsSync(join(d, 'state.vscdb')))
  .slice(-3);
for (const d of wsDirs) {
  console.log('\n--', d.split(/[\\/]/).pop());
  try {
    const db = new DatabaseSync(join(d, 'state.vscdb'), { readOnly: true });
    const rows = db.prepare(
      "SELECT key, length(value) AS len FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%interactive%' OR key LIKE '%copilot%'"
    ).all();
    rows.forEach(r => console.log(`  ${String(r.len).padStart(8)}  ${r.key}`));
    db.close();
  } catch (e) { console.log('  ERR', e.message); }
}
