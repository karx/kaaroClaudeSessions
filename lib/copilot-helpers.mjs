/**
 * lib/copilot-helpers.mjs — pure helpers for the GitHub Copilot harness hook.
 *
 * Copilot (VS Code chat) references files two ways:
 *  - encoded URI strings:        "file:///d%3A/src/x/README.md"
 *  - VS Code UriComponents objs: { $mid: 1, path: "/d:/src/x/README.md", scheme: "file" }
 * Both normalise to a plain path ("d:/src/x/README.md"); Windows drive paths
 * drop the URI's leading slash, posix paths keep theirs.
 */

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
