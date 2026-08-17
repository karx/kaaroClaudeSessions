/**
 * surface/sse-hub.mjs — SSE client registry for the Stream side of the
 * Observability Surface.
 *
 * Owns the /events handshake, broadcast fan-out, heartbeat, and eviction of
 * dead sockets. Transport only — event names/payloads are the callers'
 * contract (pulse-emitter, rebuild-orchestrator).
 */

export function createHub({ heartbeatMs = 25_000 } = {}) {
  const clients = new Set();

  function addClient(res, req) {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(':\n\n');
    res.write('event: connected\ndata: ok\n\n');
    clients.add(res);
    const hb = setInterval(() => {
      try { res.write(':\n\n'); } catch { clearInterval(hb); clients.delete(res); }
    }, heartbeatMs);
    hb.unref?.(); // never hold the process open for heartbeats
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
  }

  function notify(event, data = '') {
    const payload = `event: ${event}\ndata: ${data}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch { clients.delete(res); }
    }
  }

  return { addClient, notify, get size() { return clients.size; } };
}
