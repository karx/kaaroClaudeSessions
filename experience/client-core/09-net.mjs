/**
 * experience/client-core/09-net.mjs — SSE connection and retrying fetch.
 * Part of the client-core split; see experience/client-core.mjs.
 */

// ── SSE wiring (one EventSource pattern for every page) ───────────────────────

/**
 * @param {object}   opts
 * @param {string}   [opts.url='/events']
 * @param {Object<string, (data: any, rawEvent: MessageEvent) => void>} opts.handlers
 *   — data is JSON.parse(e.data) when parseable, else null (read rawEvent.data)
 * @param {(state: 'open'|'reconnecting') => void} [opts.onStatus]
 * @param {typeof EventSource} [ES] — injectable for tests
 * @returns {EventSource}
 */
export function connectEvents(opts, ES) {
  const Ctor = ES || EventSource;
  const es = new Ctor(opts.url || '/events');
  for (const [event, fn] of Object.entries(opts.handlers || {})) {
    es.addEventListener(event, e => {
      let data = null;
      try { data = JSON.parse(e.data); } catch { /* non-JSON event payload */ }
      try { fn(data, e); } catch (err) { console.error('[connectEvents] handler for "' + event + '" threw', err); }
    });
  }
  if (opts.onStatus) {
    es.onopen  = () => opts.onStatus('open');
    es.onerror = () => opts.onStatus('reconnecting');
  }
  return es;
}

/**
 * fetch() with one retry after a short delay. Covers the transient
 * connection-reset a burst of simultaneous requests can trigger at page
 * load (observed on Windows/Firefox — Chrome silently retries these,
 * Firefox surfaces them as an immediate rejected fetch).
 * @param {string} url
 * @param {object}   [opts]
 * @param {number}   [opts.retryDelay=400]
 * @param {typeof fetch} [opts.fetchImpl] — injectable for tests
 * @param {(fn: () => void, ms: number) => void} [opts.delay] — injectable for tests
 * @returns {Promise<Response>}
 */
export function fetchRetry(url, opts = {}) {
  const retryDelay = opts.retryDelay ?? 400;
  const fetchImpl = opts.fetchImpl || fetch;
  const delay = opts.delay || ((fn, ms) => setTimeout(fn, ms));
  return fetchImpl(url).catch(() => new Promise((resolve, reject) => {
    delay(() => fetchImpl(url).then(resolve, reject), retryDelay);
  }));
}
