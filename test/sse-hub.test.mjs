/**
 * test/sse-hub.test.mjs → surface/sse-hub.mjs
 *
 * SSE client registry: handshake, broadcast, eviction on dead sockets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHub } from '../surface/sse-hub.mjs';

function fakeClient() {
  const req = new EventEmitter();
  const res = {
    chunks: [],
    headers: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(s) { if (this.dead) throw new Error('EPIPE'); this.chunks.push(s); },
  };
  return { req, res };
}

test('addClient — SSE handshake: headers, comment ping, connected event', () => {
  const hub = createHub();
  const { req, res } = fakeClient();
  hub.addClient(res, req);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.ok(res.chunks[0].startsWith(':'));
  assert.ok(res.chunks.some(c => c.includes('event: connected')));
  assert.equal(hub.size, 1);
  req.emit('close');
  assert.equal(hub.size, 0);
});

test('notify — broadcasts event payload to all clients', () => {
  const hub = createHub();
  const a = fakeClient(); const b = fakeClient();
  hub.addClient(a.res, a.req);
  hub.addClient(b.res, b.req);
  hub.notify('updated', '2026-06-12T00:00:00Z');
  const last = a.res.chunks.at(-1);
  assert.equal(last, 'event: updated\ndata: 2026-06-12T00:00:00Z\n\n');
  assert.equal(b.res.chunks.at(-1), last);
});

test('notify — evicts clients whose socket throws', () => {
  const hub = createHub();
  const a = fakeClient(); const b = fakeClient();
  hub.addClient(a.res, a.req);
  hub.addClient(b.res, b.req);
  a.res.dead = true;
  hub.notify('status', 'rebuilding');
  assert.equal(hub.size, 1);
  assert.ok(b.res.chunks.at(-1).includes('rebuilding'));
});

test('heartbeat — evicts dead client on ping failure', async () => {
  const hub = createHub({ heartbeatMs: 5 });
  const { req, res } = fakeClient();
  hub.addClient(res, req);
  res.dead = true;
  await new Promise(r => setTimeout(r, 25));
  assert.equal(hub.size, 0);
});
