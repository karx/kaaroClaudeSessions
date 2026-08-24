/**
 * surface/audio-service.mjs — /api/audio production path.
 *
 * registry readSessionRecords → simulateSession → JSON for DAW replay.
 * Same resolve → read shape as trace-service; mtime+preset cached.
 */
import fs from 'fs';

import { getHarness } from '../hooks/registry.mjs';
import { simulateSession } from '../experience/audio/audio-sim.mjs';
import { AUDIO_PRESETS, getPreset, PRESET_SLUGS } from '../experience/audio/audio-presets.mjs';

function presetSlugOf(requested) {
  const preset = getPreset(requested);
  return PRESET_SLUGS.find(s => AUDIO_PRESETS[s] === preset) || 'cognitive-flow';
}

export function createAudioService() {
  const cache = new Map(); // key → { mtime, payload }

  /**
   * @param {string} filePath
   * @param {string|null} projectId
   * @param {string} sessionId
   * @param {string} harnessId
   * @param {{ preset?: string }} [opts]
   * @returns {object|null}
   */
  function buildAudio(filePath, projectId, sessionId, harnessId, opts = {}) {
    try {
      const harness = getHarness(harnessId);
      if (!harness?.readSessionRecords) return null;

      const presetSlug = presetSlugOf(opts.preset);
      const preset = getPreset(presetSlug);
      const mtime = fs.statSync(filePath).mtimeMs;
      const cacheKey = filePath + '\0' + presetSlug;
      const cached = cache.get(cacheKey);
      if (cached && cached.mtime === mtime) return cached.payload;

      const { records } = harness.readSessionRecords(filePath);
      const ctx = {
        session_id:    sessionId,
        slug:          sessionId.slice(0, 8),
        harness:       harnessId,
        project_id:    projectId,
        project_label: projectId,
      };
      const { events, summary, silentCount } = simulateSession(
        records, ctx, preset.settings, { mappings: preset.mappings },
      );

      const payload = {
        session_id: sessionId,
        slug: sessionId.slice(0, 8),
        harness: harnessId,
        project_id: projectId,
        preset: presetSlug,
        duration_ms: events.length ? events[events.length - 1].relMs : 0,
        summary,
        silentCount,
        events: events.map(e => ({
          relMs: e.relMs,
          event: e.event,
          hz: e.hz,
          sonic: {
            instrument: e.sonic.instrument,
            key: e.sonic.key,
            fam: e.sonic.fam,
            pan: e.sonic.pan,
            volMult: e.sonic.volMult,
            brightness: e.sonic.brightness,
            sendAmt: e.sonic.sendAmt,
            octave: e.sonic.octave || 0,
          },
          data: e.data,
        })),
      };
      cache.set(cacheKey, { mtime, payload });
      return payload;
    } catch {
      return null;
    }
  }

  return { buildAudio };
}
