import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, addEntry, toggleSticky, clearEntries } from '../experience/audio/ticker-store.mjs';

// ── createStore ───────────────────────────────────────────────────────────────

test('createStore — entries defaults to []', () => {
  assert.deepEqual(createStore().entries, []);
});

test('createStore — sticky defaults to false', () => {
  assert.equal(createStore().sticky, false);
});

test('createStore — default maxEphemeral is 20', () => {
  assert.equal(createStore().maxEphemeral, 20);
});

test('createStore — default maxSticky is 500', () => {
  assert.equal(createStore().maxSticky, 500);
});

test('createStore — custom maxEphemeral is respected', () => {
  assert.equal(createStore({ maxEphemeral: 5 }).maxEphemeral, 5);
});

test('createStore — custom maxSticky is respected', () => {
  assert.equal(createStore({ maxSticky: 50 }).maxSticky, 50);
});

// ── addEntry ──────────────────────────────────────────────────────────────────

test('addEntry — prepends entry so newest is first', () => {
  const s = addEntry(createStore(), { id: 1 });
  assert.equal(s.entries[0].id, 1);
});

test('addEntry — second entry is prepended ahead of first', () => {
  let s = createStore();
  s = addEntry(s, { id: 'a' });
  s = addEntry(s, { id: 'b' });
  assert.equal(s.entries[0].id, 'b');
  assert.equal(s.entries[1].id, 'a');
});

test('addEntry — is pure (does not mutate original store)', () => {
  const s0 = createStore();
  addEntry(s0, { id: 1 });
  assert.deepEqual(s0.entries, []);
});

test('addEntry — trims to maxEphemeral when not sticky', () => {
  let s = createStore({ maxEphemeral: 3 });
  for (let i = 0; i < 5; i++) s = addEntry(s, { id: i });
  assert.equal(s.entries.length, 3);
});

test('addEntry — trims to maxSticky when sticky', () => {
  let s = toggleSticky(createStore({ maxSticky: 3 }));
  for (let i = 0; i < 5; i++) s = addEntry(s, { id: i });
  assert.equal(s.entries.length, 3);
});

test('addEntry — keeps newest entries, drops oldest (ephemeral)', () => {
  let s = createStore({ maxEphemeral: 2 });
  s = addEntry(s, { id: 'old' });
  s = addEntry(s, { id: 'mid' });
  s = addEntry(s, { id: 'new' });
  const ids = s.entries.map(e => e.id);
  assert.ok(!ids.includes('old'), 'oldest should be dropped');
  assert.ok(ids.includes('new'), 'newest should be kept');
  assert.ok(ids.includes('mid'), 'second-newest should be kept');
});

test('addEntry — sticky mode uses maxSticky, not maxEphemeral', () => {
  // maxEphemeral=2 but maxSticky=10: sticky mode should allow 10
  let s = toggleSticky(createStore({ maxEphemeral: 2, maxSticky: 10 }));
  for (let i = 0; i < 8; i++) s = addEntry(s, { id: i });
  assert.equal(s.entries.length, 8);
});

test('addEntry — preserves all entry fields', () => {
  const entry = { id: 'x', text: 'Read src/foo.js', color: '#00ff88', ts: 12345 };
  const s = addEntry(createStore(), entry);
  assert.deepEqual(s.entries[0], entry);
});

// ── toggleSticky ──────────────────────────────────────────────────────────────

test('toggleSticky — false → true', () => {
  assert.equal(toggleSticky(createStore()).sticky, true);
});

test('toggleSticky — true → false', () => {
  const s = toggleSticky(createStore());
  assert.equal(toggleSticky(s).sticky, false);
});

test('toggleSticky — is pure (does not mutate original store)', () => {
  const s0 = createStore();
  toggleSticky(s0);
  assert.equal(s0.sticky, false);
});

test('toggleSticky — preserves entries', () => {
  let s = createStore();
  s = addEntry(s, { id: 1 });
  s = addEntry(s, { id: 2 });
  const toggled = toggleSticky(s);
  assert.equal(toggled.entries.length, 2);
});

test('toggleSticky — preserves limits', () => {
  const s0 = createStore({ maxEphemeral: 7, maxSticky: 77 });
  const s1 = toggleSticky(s0);
  assert.equal(s1.maxEphemeral, 7);
  assert.equal(s1.maxSticky, 77);
});

// ── clearEntries ──────────────────────────────────────────────────────────────

test('clearEntries — removes all entries', () => {
  let s = createStore();
  s = addEntry(s, { id: 1 });
  s = addEntry(s, { id: 2 });
  assert.deepEqual(clearEntries(s).entries, []);
});

test('clearEntries — preserves sticky flag', () => {
  const s = toggleSticky(addEntry(createStore(), { id: 1 }));
  assert.equal(clearEntries(s).sticky, true);
});

test('clearEntries — preserves limits', () => {
  const s0 = createStore({ maxEphemeral: 5, maxSticky: 99 });
  const s1 = clearEntries(addEntry(s0, { id: 1 }));
  assert.equal(s1.maxEphemeral, 5);
  assert.equal(s1.maxSticky, 99);
});

test('clearEntries — is pure (does not mutate original)', () => {
  let s = createStore();
  s = addEntry(s, { id: 1 });
  clearEntries(s);
  assert.equal(s.entries.length, 1);
});
