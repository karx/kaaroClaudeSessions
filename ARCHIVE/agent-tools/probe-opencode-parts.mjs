// Probe: opencode storage/part shapes — what part types exist, sample tool parts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const partRoot = join(homedir(), '.local/share/opencode/storage/part');
const typeCounts = {};
const samples = {};
let total = 0;

for (const msgDir of readdirSync(partRoot)) {
  const dir = join(partRoot, msgDir);
  let files;
  try { files = readdirSync(dir); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    total++;
    try {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const t = p.type ?? 'NO_TYPE';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
      // keep smallest representative sample per type (less noise)
      const size = statSync(join(dir, f)).size;
      if (!samples[t] || size < samples[t].size) samples[t] = { size, p };
    } catch {}
  }
}

console.log('total parts:', total);
console.log('type counts:', JSON.stringify(typeCounts, null, 2));
for (const [t, s] of Object.entries(samples)) {
  const str = JSON.stringify(s.p, null, 1);
  console.log(`\n=== sample part type=${t} (${s.size}b) ===`);
  console.log(str.length > 1200 ? str.slice(0, 1200) + ' …TRUNCATED' : str);
}
// also: one full 'tool' part with state, untruncated-ish
