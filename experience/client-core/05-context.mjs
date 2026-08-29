/**
 * experience/client-core/05-context.mjs — context-window pressure and the
 * live-feed session legend. Part of the client-core split; see
 * experience/client-core.mjs.
 */

/**
 * Context pressure: how full a session's context window is, from the latest
 * tokens pulse (input + cache_read ≈ current prompt context size).
 * @returns {number} 0..1
 */
export function contextPressure(inputTokens, cacheRead, windowTokens = 200_000) {
  const ctx = (inputTokens || 0) + (cacheRead || 0);
  return Math.max(0, Math.min(1, ctx / windowTokens));
}

/**
 * Distinct sessions seen in the beat ring, newest first, each with its latest
 * context pressure (null until a tokens pulse has been seen).
 * @param {object[]} ring — beat-ring entries (ts ascending)
 * @param {number} [max] — legend size cap
 */
export function sessionLegend(ring, max = 6, windowTokens = 200_000) {
  const bySlug = new Map(); // slug → entry (insertion order = recency, newest first)
  for (let i = ring.length - 1; i >= 0; i--) {
    const ev = ring[i];
    if (!ev.slug) continue;
    let entry = bySlug.get(ev.slug);
    if (!entry) {
      if (bySlug.size >= max) continue; // newer sessions already filled the legend
      entry = { slug: ev.slug, project: ev.project || null, color: ev.color || null,
                pressure: null, lastTs: ev.ts };
      bySlug.set(ev.slug, entry);
    }
    if (entry.pressure === null && ev.type === 'tokens') {
      entry.pressure = contextPressure(ev.input, ev.cache_read, windowTokens);
    }
  }
  return [...bySlug.values()];
}
