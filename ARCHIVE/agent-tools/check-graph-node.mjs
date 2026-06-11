const res = await fetch(`http://localhost:${process.argv[2] || 3334}/graph-data.json`);
const g = await res.json();
const slug = process.argv[3] || '019ea1c9';
const n = g.nodes.find(x => x.type === 'session' && x.id?.startsWith(slug));
console.log(JSON.stringify(n ? {
  id: n.id, label: n.label, harness: n.harness,
  project_id: n.project_id, tool_calls: n.tool_calls,
  in_flight: n.in_flight, git_branch: n.git_branch,
} : null, null, 2));