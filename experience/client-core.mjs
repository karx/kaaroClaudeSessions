/**
 * experience/client-core.mjs — barrel for the shared browser core used by
 * every page (graph, Mission Control, DAW): formatters, color vocabulary,
 * geometry, DAW voice math, share cards, SSE wiring. The single source of
 * truth for helpers that were previously triplicated across 01-data.js,
 * 05-interaction.js, 16-beat-overlay.js, 19-daw-builder.js, and now.html.
 *
 * The implementation lives in experience/client-core/*.mjs, split by
 * concern (00-format, 01-color, 02-glyph, … 11-share-card — see that
 * directory for the full list). This file re-exports all of it so existing
 * `import { fmtTok, ... } from '.../client-core.mjs'` call sites (tests,
 * experience/kind-map-widget.mjs, scripts/capture-live-feed.mjs) keep
 * working unchanged.
 *
 * SYNTAX CONTRACT for experience/client-core/*.mjs: only `export function` /
 * `export async function` / `export const` at top level, plus optional
 * `import { ... } from './NN-other.mjs'` lines for cross-module deps — build.mjs
 * strips both the `export ` prefixes and those import lines, then
 * concatenates every file in NN-numeric order into the %%CLIENT_CORE%%
 * placeholder, so each file must also be valid plain script once its
 * `import`/`export` keywords are removed. Node tests import this barrel (or
 * a submodule directly) as normal ESM.
 *
 * This file itself carries no logic — do not add functions here; add them
 * to the right experience/client-core/NN-*.mjs file instead (new concern →
 * new NN-*.mjs file, in load order after anything it depends on).
 */

export * from './client-core/00-format.mjs';
export * from './client-core/01-color.mjs';
export * from './client-core/02-glyph.mjs';
export * from './client-core/03-node-geometry.mjs';
export * from './client-core/04-daw.mjs';
export * from './client-core/05-context.mjs';
export * from './client-core/06-pulse.mjs';
export * from './client-core/07-filters.mjs';
export * from './client-core/08-layout.mjs';
export * from './client-core/09-net.mjs';
export * from './client-core/10-controls.mjs';
export * from './client-core/11-share-card.mjs';
