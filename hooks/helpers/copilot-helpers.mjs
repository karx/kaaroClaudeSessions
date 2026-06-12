/**
 * hooks/helpers/copilot-helpers.mjs — helpers for the GitHub Copilot harness hook.
 *
 * Copilot (VS Code chat) references files two ways:
 *  - encoded URI strings:        "file:///d%3A/src/x/README.md"
 *  - VS Code UriComponents objs: { $mid: 1, path: "/d:/src/x/README.md", scheme: "file" }
 * Both normalise to a plain path ("d:/src/x/README.md"); Windows drive paths
 * drop the URI's leading slash, posix paths keep theirs.
 *
 * All helpers are pure except copilotWorkspaceLabel, which reads the
 * workspace.json next to the watched chatSessions dir (cached per ws hash).
 */
import fs   from 'node:fs';
import path from 'node:path';

export function copilotUriToPath(uri) {
  let p = null;
  if (typeof uri === 'string') {
    if (!uri.startsWith('file://')) return null;
    try { p = decodeURIComponent(uri.slice('file://'.length)); } catch { p = uri.slice(7); }
  } else if (uri && typeof uri === 'object' && typeof uri.path === 'string') {
    p = uri.path;
  }
  if (!p) return null;
  // "/d:/src/…" → "d:/src/…" (windows drive); "/home/…" stays absolute
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  return p;
}

export function copilotToolName(toolId) {
  if (!toolId) return 'unknown';
  return toolId.replace(/^copilot_/, '');
}

/** First referenced file path of a serialized tool invocation, if any. */
export function invocationFilePath(item) {
  const uris = item?.invocationMessage?.uris;
  if (uris && typeof uris === 'object') {
    const first = Object.keys(uris)[0];
    if (first) return copilotUriToPath(uris[first]) ?? copilotUriToPath(first);
  }
  return null;
}

/** workspace.json `folder` URI → plain path (null when absent/undecodable). */
export function workspaceFolderPath(ws) {
  if (!ws || typeof ws !== 'object' || typeof ws.folder !== 'string') return null;
  return copilotUriToPath(ws.folder);
}

// Copilot watch ctx lacks project attribution (it lives in <ws>/workspace.json,
// not the watched file path) — resolve + cache per workspace hash for the
// lifetime of the process (matches the old serve.mjs cache behavior).
const wsLabelCache = new Map();

export function copilotWorkspaceLabel(chatSessionPath, wsHash) {
  if (!wsHash) return null;
  if (wsLabelCache.has(wsHash)) return wsLabelCache.get(wsHash);
  let label = null;
  try {
    const wsJson = path.join(path.dirname(chatSessionPath), '..', 'workspace.json');
    const folder = workspaceFolderPath(JSON.parse(fs.readFileSync(wsJson, 'utf8')));
    if (folder) label = folder.split('/').pop();
  } catch { /* unattributed workspace */ }
  wsLabelCache.set(wsHash, label);
  return label;
}

/** Test seam: reset the per-process workspace-label cache. */
export function clearCopilotWorkspaceLabelCache() {
  wsLabelCache.clear();
}
