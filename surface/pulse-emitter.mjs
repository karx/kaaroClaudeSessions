/**
 * surface/pulse-emitter.mjs — the Stream production path.
 *
 * Watched-file change → tail new bytes (or whole-file JSON for read_mode
 * 'json' harnesses) → registry adapter → NormalizedRecords → pulses →
 * hub broadcast + active-state, plus the throttled `now` snapshot.
 *
 * Adapter + capabilities + project-label resolution all come from the
 * registry — nothing here is harness-specific.
 */
import fs from 'fs';

import { tailRead } from '../hooks/jsonl-tail.mjs';
import { normRecordsToPulses } from '../hooks/pulse-transformer.mjs';
import { getHarness } from '../hooks/registry.mjs';
import { applyPulse, snapshotActive } from './active-state.mjs';

/**
 * @param {object} deps
 * @param {{ notify: (event: string, data?: string) => void }} deps.hub
 * @param {object} deps.activeState — store from createActiveState()
 * @param {number} [deps.nowThrottleMs] — trailing-edge `now` broadcast window
 * @returns {{ tailAndPulse: (filePath: string, ctx: object) => void }}
 */
export function createPulseEmitter({ hub, activeState, nowThrottleMs = 1000 }) {
  const offsetMap = new Map(); // filePath → byte offset (jsonl) or size:mtime sig (json)
  let nowTimer = null;

  // Throttle: at most one `now` broadcast per window, trailing-edge,
  // so bursty multi-record tails collapse into a single snapshot push.
  function scheduleNowBroadcast() {
    if (nowTimer) return;
    nowTimer = setTimeout(() => {
      nowTimer = null;
      hub.notify('now', JSON.stringify(snapshotActive(activeState, Date.now())));
    }, nowThrottleMs);
    nowTimer.unref?.();
  }

  function emitPulses(records, ctx) {
    const harness = getHarness(ctx.harness);
    if (!harness) return;
    const nrs   = harness.adapter(records);
    const nowMs = Date.now();
    for (const pulse of normRecordsToPulses(nrs, ctx, harness.capabilities)) {
      applyPulse(activeState, pulse, nowMs);
      hub.notify(pulse.event, JSON.stringify(pulse.data));
    }
    scheduleNowBroadcast();
  }

  // Whole-file JSON harnesses (opencode): each watched file is one pretty-printed
  // JSON document, rewritten in place. Skip unchanged content via size+mtime
  // signature; fill session identity from the body when the path lacks it
  // (part/<messageID>/… files carry sessionID inside the JSON only).
  function jsonAndPulse(filePath, ctx) {
    const stat = fs.statSync(filePath);
    const sig = `${stat.size}:${stat.mtimeMs}`;
    if (offsetMap.get(filePath) === sig) return;
    offsetMap.set(filePath, sig);

    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const sessionId = ctx.session_id || obj.sessionID || null;
    if (!sessionId) return;
    const dir = obj.directory ? obj.directory.replace(/\\/g, '/').split('/').pop() : null;
    emitPulses([obj], {
      ...ctx,
      session_id: sessionId,
      slug: ctx.slug || sessionId.replace(/^ses_/, '').slice(0, 8),
      project_label: ctx.project_label || dir,
    });
  }

  function tailAndPulse(filePath, ctx) {
    try {
      if (ctx.read_mode === 'json') return jsonAndPulse(filePath, ctx);
      const resolveLabel = getHarness(ctx.harness)?.watch?.resolveProjectLabel;
      if (resolveLabel && !ctx.project_label) {
        ctx = { ...ctx, project_label: resolveLabel(ctx, filePath) };
      }
      const offset = offsetMap.get(filePath) ?? 0;
      const { records, newOffset } = tailRead(filePath, offset);
      offsetMap.set(filePath, newOffset);
      if (!records.length) return;
      emitPulses(records, ctx);
    } catch { /* tail errors must not affect the main rebuild flow */ }
  }

  return { tailAndPulse };
}
