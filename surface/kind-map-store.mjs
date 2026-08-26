/**
 * surface/kind-map-store.mjs — live golden overlay.
 *
 * Baseline = goldens + samples. Pulses from the existing Stream only set
 * additional emit bits when they carry nr_kind.
 */

import { applyKindMapPulse } from '../hooks/kind-map.mjs';
import { buildKindMap } from './kind-map-build.mjs';

export function createKindMapStore({ buildBaseline = buildKindMap } = {}) {
  let payload = buildBaseline();

  return {
    applyPulse(pulse) {
      if (!pulse || !pulse.event) return;
      payload = applyKindMapPulse(payload, pulse.event, pulse.data || {});
    },
    snapshot() {
      return payload;
    },
    reset() {
      payload = buildBaseline();
    },
  };
}
