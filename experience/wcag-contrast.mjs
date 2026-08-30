/**
 * experience/wcag-contrast.mjs — WCAG 2.1 relative luminance + contrast ratio.
 * Pure, no I/O. Formula: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function channelLinear(c) {
  const c1 = c / 255;
  return c1 <= 0.03928 ? c1 / 12.92 : ((c1 + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}

export function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}
