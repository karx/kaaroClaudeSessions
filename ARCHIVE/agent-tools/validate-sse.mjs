/** One-shot SSE probe: collect tool_call/words events for a session slug. */
const PORT = Number(process.argv[2] || 3334);
const SLUG = process.argv[3] || '019ea1c9';
const MS   = Number(process.argv[4] || 12000);

const res = await fetch(`http://localhost:${PORT}/events`);
if (!res.ok) throw new Error(`SSE connect failed: ${res.status}`);

const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
const hits = { tool_call: [], words: [], updated: 0 };

const timer = setTimeout(() => reader.cancel(), MS);

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const parts = buf.split('\n\n');
  buf = parts.pop() ?? '';
  for (const block of parts) {
    const lines = block.split('\n');
    const ev = lines.find(l => l.startsWith('event: '))?.slice(7);
    const dataLine = lines.find(l => l.startsWith('data: '))?.slice(6);
    if (!ev || !dataLine) continue;
    if (ev === 'updated') { hits.updated++; continue; }
    let data;
    try { data = JSON.parse(dataLine); } catch { continue; }
    if (data.slug !== SLUG) continue;
    if (ev === 'tool_call' || ev === 'words') hits[ev].push(data);
  }
}

clearTimeout(timer);
console.log(JSON.stringify({
  slug: SLUG,
  port: PORT,
  window_ms: MS,
  tool_calls: hits.tool_call.length,
  words: hits.words.length,
  rebuilds: hits.updated,
  sample_tool_calls: hits.tool_call.slice(0, 5).map(t => ({ tool: t.tool, where: t.where, harness: t.harness })),
}, null, 2));