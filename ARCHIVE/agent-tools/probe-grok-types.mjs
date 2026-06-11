import fs from 'fs';
const p = process.argv[2];
const types = new Map();
let n = 0;
for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try {
    const r = JSON.parse(line);
    const t = r.params?.update?.sessionUpdate ?? '(none)';
    types.set(t, (types.get(t) || 0) + 1);
    n++;
  } catch {}
}
console.log('records', n);
for (const [t, c] of [...types.entries()].sort((a, b) => b[1] - a[1]))
  console.log(c, t);