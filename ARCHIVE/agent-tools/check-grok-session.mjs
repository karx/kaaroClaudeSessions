import fs from 'fs';
const d = JSON.parse(fs.readFileSync('sessions-data.json', 'utf8'));
const s = d.sessions.find(x => x.session_id.startsWith('019ea1c9'));
console.log(JSON.stringify({
  id: s?.session_id?.slice(0, 8),
  harness: s?.harness,
  tool_calls: s?.tool_calls,
  project: s?.project_label,
  title: s?.ai_title,
  branch: s?.git_branch,
}, null, 2));