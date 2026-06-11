/**
 * lib/ticker-store.mjs
 *
 * Pure state management for the pulse ticker.
 * All functions are immutable (return new store objects).
 *
 * store shape: { entries, sticky, maxEphemeral, maxSticky }
 */

export function createStore(opts = {}) {
  return {
    entries:      [],
    sticky:       false,
    maxEphemeral: opts.maxEphemeral ?? 20,
    maxSticky:    opts.maxSticky    ?? 500,
  };
}

export function addEntry(store, entry) {
  const max     = store.sticky ? store.maxSticky : store.maxEphemeral;
  const entries = [entry, ...store.entries].slice(0, max);
  return { ...store, entries };
}

export function toggleSticky(store) {
  return { ...store, sticky: !store.sticky };
}

export function clearEntries(store) {
  return { ...store, entries: [] };
}
