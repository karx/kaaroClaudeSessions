/**
 * test/rebuild-orchestrator.test.mjs → surface/rebuild-orchestrator.mjs
 *
 * Snapshot production scheduling: debounce, coalescing of overlapping
 * rebuild requests, pending-rebuild chaining, and lifecycle notifications.
 * runScript is injected — no child processes in tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRebuilder } from '../surface/rebuild-orchestrator.mjs';

function fakeHub() {
  const events = [];
  return { events, notify: (event, data = '') => events.push({ event, data }) };
}

function deferredRunner() {
  const calls = [];
  let release;
  const gate = () => new Promise(r => { release = r; });
  let current = null;
  return {
    calls,
    release: () => release?.(),
    run: (script, args = []) => {
      calls.push({ script, args });
      current = gate();
      return current;
    },
  };
}

test('rebuild — runs analyze then build, notifies status/updated', async () => {
  const hub = fakeHub();
  const calls = [];
  const rebuilder = createRebuilder({
    hub, analyzeScript: 'A', buildScript: 'B', log: { log() {}, error() {} },
    runScript: async (script, args) => calls.push({ script, args }),
  });
  await rebuilder.rebuild();
  assert.deepEqual(calls.map(c => c.script), ['A', 'B']);
  assert.deepEqual(calls[0].args, ['--all-harnesses']);
  assert.equal(hub.events[0].event, 'status');
  assert.equal(hub.events[0].data, 'rebuilding');
  assert.equal(hub.events.at(-1).event, 'updated');
  assert.ok(rebuilder.state.lastBuilt instanceof Date);
  assert.equal(rebuilder.state.rebuilding, false);
});

test('rebuild — targeted rebuildArg replaces the full scan', async () => {
  const calls = [];
  const rebuilder = createRebuilder({
    hub: fakeHub(), analyzeScript: 'A', buildScript: 'B', log: { log() {}, error() {} },
    runScript: async (script, args) => calls.push({ script, args }),
  });
  await rebuilder.rebuild({ rebuildArg: '--session=P/s1' });
  assert.deepEqual(calls[0].args, ['--session=P/s1']);
});

test('rebuild — overlapping requests coalesce into one pending follow-up', async () => {
  const hub = fakeHub();
  let resolveFirst;
  let runs = 0;
  const rebuilder = createRebuilder({
    hub, analyzeScript: 'A', buildScript: 'B', log: { log() {}, error() {} },
    runScript: (script) => {
      runs++;
      if (runs === 1) return new Promise(r => { resolveFirst = r; }); // first analyze blocks
      return Promise.resolve();
    },
  });

  const first = rebuilder.rebuild();      // starts, blocks on analyze
  await rebuilder.rebuild();              // while busy → pending
  await rebuilder.rebuild();              // still busy → coalesces into same pending
  assert.equal(rebuilder.state.rebuilding, true);

  resolveFirst();
  await first;
  // chained pending rebuild runs once: total scripts = first(2) + pending(2)
  await new Promise(r => setTimeout(r, 10));
  assert.equal(runs, 4, 'exactly one chained rebuild after the busy one');
});

test('rebuild — failure notifies error and clears rebuilding', async () => {
  const hub = fakeHub();
  const rebuilder = createRebuilder({
    hub, analyzeScript: 'A', buildScript: 'B', log: { log() {}, error() {} },
    runScript: async () => { throw new Error('analyze exploded'); },
  });
  await rebuilder.rebuild();
  assert.ok(hub.events.some(e => e.event === 'error' && e.data.includes('analyze exploded')));
  assert.equal(rebuilder.state.rebuilding, false);
});

test('scheduleRebuild — debounces bursts into a single rebuild', async () => {
  let runs = 0;
  const rebuilder = createRebuilder({
    hub: fakeHub(), analyzeScript: 'A', buildScript: 'B', log: { log() {}, error() {} },
    runScript: async () => { runs++; }, debounceMs: 10,
  });
  rebuilder.scheduleRebuild();
  rebuilder.scheduleRebuild();
  rebuilder.scheduleRebuild();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(runs, 2, 'one rebuild = analyze + build');
});
