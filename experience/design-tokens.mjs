/**
 * experience/design-tokens.mjs — Register A design tokens (kaaro family,
 * financial-terminal register). THE color/type source for every page:
 * build.mjs renders tokensToCss() into %%TOKENS_CSS%% in each template and
 * injects TOKENS as the KAARO_TOKENS object for canvas JS.
 *
 * Color is grammar — one meaning per hue (kaaro-design):
 *
 *   role    | value    | meaning
 *   --------+----------+---------------------------------------------
 *   bg      | #000000  | pure black canvas
 *   panel   | #080800  | warm-tinted panel backgrounds
 *   card    | #101008  | rows / cards
 *   border  | #1e1e00  | subtle warm borders (1px lines, never shadows)
 *   accent  | #ff6600  | orange — primary action / interactive
 *   label   | #ffaa00  | amber — labels, identifiers, field names
 *   data    | #e8e000  | yellow — key data values
 *   select  | #00cccc  | cyan — focused / selected item
 *   geo     | #00ff88  | green — positive, live, spatial
 *   dim     | #445544  | dim — inactive/secondary text
 *   body    | #ccccaa  | primary readable text
 *   err     | #ff5555  | error / failure
 *
 * Data-encoding palettes (project colors, file-op edge hues, DAW lane
 * variants) are NOT chrome and live with their owners; everything else
 * must come from these tokens (enforced by test/design-lint.test.mjs).
 */

export const TOKENS = {
  bg:     '#000000',
  panel:  '#080800',
  card:   '#101008',
  border: '#1e1e00',
  accent: '#ff6600',
  label:  '#ffaa00',
  data:   '#e8e000',
  select: '#00cccc',
  geo:    '#00ff88',
  dim:    '#445544',
  body:   '#ccccaa',
  err:    '#ff5555',
};

export const FONT_STACK = "'IBM Plex Mono', 'Courier New', monospace";

/** Render the :root token block + shared base chrome for all pages. */
export function tokensToCss() {
  const vars = Object.entries(TOKENS)
    .map(([k, v]) => `  --k-${k}: ${v};`)
    .join('\n');

  return `:root {
${vars}
  --k-font: ${FONT_STACK};
}
/* ── Register A base chrome ─────────────────────────────────────────── */
.k-topbar {
  display: flex; align-items: center; gap: 10px;
  height: 28px; padding: 0 10px;
  background: var(--k-panel);
  border-bottom: 1px solid var(--k-border);
  font: 11px var(--k-font);
  color: var(--k-body);
  letter-spacing: 0.08em;
}
.k-topbar .k-title { color: var(--k-accent); font-weight: 700; text-transform: uppercase; }
.k-topbar a { color: var(--k-dim); text-decoration: none; text-transform: uppercase; }
.k-topbar a:hover { color: var(--k-accent); }
.k-topbar a.k-here { color: var(--k-label); }
.k-statusbar {
  height: 18px; padding: 0 10px; display: flex; align-items: center; gap: 12px;
  background: var(--k-panel);
  border-top: 1px solid var(--k-border);
  font: 10px var(--k-font);
  color: var(--k-dim);
}
.k-btn {
  background: var(--k-card); color: var(--k-body);
  border: 1px solid var(--k-border);
  font: 10px var(--k-font); letter-spacing: 0.08em; text-transform: uppercase;
  padding: 3px 10px; cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.k-btn:hover { color: var(--k-accent); border-color: var(--k-accent); }
.k-btn.k-active { color: var(--k-accent); border-color: var(--k-accent); }
`;
}
