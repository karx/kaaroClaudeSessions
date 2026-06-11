/**
 * lib/beat-clock.mjs
 *
 * Pure beat-timing math for the rolling timeline overlay.
 * No I/O, no AudioContext — just arithmetic over ms timestamps.
 */

/**
 * Convert BPM to seconds per beat.
 * @param {number} bpm
 * @returns {number} seconds
 */
export function bpmToInterval(bpm) {
  return 60 / Math.max(1, bpm);
}

/**
 * Beat offset of an event relative to current time.
 * Negative = past, positive = future, 0 = now.
 * @param {number} eventTimeMs   - wall-clock ms when the event occurred
 * @param {number} currentTimeMs - wall-clock ms "now"
 * @param {number} bpm
 * @returns {number} beat offset
 */
export function beatPosition(eventTimeMs, currentTimeMs, bpm) {
  return (eventTimeMs - currentTimeMs) / (bpmToInterval(bpm) * 1000);
}

/**
 * Filter and position events for rendering inside a rolling window.
 * @param {{ ts: number, color: string, label: string }[]} events - ring buffer
 * @param {number} currentTimeMs - wall-clock ms "now"
 * @param {number} windowBeats   - how many beats wide the visible window is
 * @param {number} bpm
 * @returns {{ x: number, color: string, label: string }[]} sorted oldest-first (x ascending)
 */
export function eventsInWindow(events, currentTimeMs, windowBeats, bpm) {
  const intervalMs = bpmToInterval(bpm) * 1000;
  const windowMs   = windowBeats * intervalMs;
  const result     = [];
  for (const ev of events) {
    const age = currentTimeMs - ev.ts;
    if (age < 0 || age > windowMs) continue;
    result.push({ ...ev, x: 1 - age / windowMs });
  }
  return result.sort((a, b) => a.x - b.x);
}

/**
 * Append an event to the ring buffer, trimming the oldest when over maxSize.
 * @param {{ ts: number, label: string, color: string }[]} ring
 * @param {{ ts: number, label: string, color: string }} event
 * @param {number} [maxSize=1000]
 * @returns {typeof ring}
 */
export function pushBeatEvent(ring, event, maxSize = 1000) {
  const next = [...ring, event];
  return next.length > maxSize ? next.slice(next.length - maxSize) : next;
}
