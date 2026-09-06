/**
 * surface/support.mjs — optional one-time support checkout (Dodo Payments).
 *
 * The GitHub / npx app is free. This module builds public Pay What You Want
 * checkout URLs for a one-time "Support kaaroSessions" product. The merchant
 * API key is NOT used at runtime — static payment links are enough.
 *
 * Amounts: $1 minimum, $10 maximum, $5 suggested. `paymentAmount` on the
 * payment-link query string is in major currency units (5 = $5.00).
 *
 * Experience consumes GET /support (and public payment-link URLs).
 * The merchant API key is never sent to the browser.
 */
export const SUPPORT = Object.freeze({
  product_id: 'pdt_0Nn0z2imSJHnunHeQz0xP',
  checkout_origin: 'https://checkout.dodopayments.com',
  currency: 'USD',
  min_cents: 100,
  max_cents: 1000,
  suggested_cents: 500,
  presets_cents: Object.freeze([300, 500, 1000]),
});

export function clampSupportCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return SUPPORT.suggested_cents;
  return Math.min(SUPPORT.max_cents, Math.max(SUPPORT.min_cents, Math.round(n)));
}

/**
 * @param {{ amount_cents?: number|null, redirect_url?: string|null }} [opts]
 * @returns {string}
 */
export function supportCheckoutUrl(opts = {}) {
  const url = new URL(`${SUPPORT.checkout_origin}/buy/${SUPPORT.product_id}`);
  if (opts.amount_cents != null) {
    const cents = clampSupportCents(opts.amount_cents);
    const major = cents / 100;
    url.searchParams.set('paymentAmount', Number.isInteger(major) ? String(major) : major.toFixed(2));
  }
  if (opts.redirect_url) url.searchParams.set('redirect_url', opts.redirect_url);
  return url.toString();
}

export function supportPresets(redirect_url) {
  return SUPPORT.presets_cents.map(cents => ({
    cents,
    dollars: cents / 100,
    label: `$${cents / 100}`,
    href: supportCheckoutUrl({ amount_cents: cents, redirect_url }),
  }));
}

/** Public catalog for tests and any future chrome that needs preset links. */
export function supportClientPayload(redirect_url) {
  return {
    product_id: SUPPORT.product_id,
    min_cents: SUPPORT.min_cents,
    max_cents: SUPPORT.max_cents,
    suggested_cents: SUPPORT.suggested_cents,
    choose_href: supportCheckoutUrl({ redirect_url }),
    presets: supportPresets(redirect_url),
  };
}
