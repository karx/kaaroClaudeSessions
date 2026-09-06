/**
 * test/support.test.mjs → surface/support.mjs
 *
 * Optional Pay What You Want support checkout. The GitHub app is free;
 * amounts clamp to $1–$10. Payment-link `paymentAmount` is major units.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORT, clampSupportCents, supportCheckoutUrl, supportPresets, supportClientPayload,
} from '../surface/support.mjs';

test('support catalog — live PWYW product, $1–$10', () => {
  assert.equal(SUPPORT.product_id, 'pdt_0Nn0z2imSJHnunHeQz0xP');
  assert.equal(SUPPORT.min_cents, 100);
  assert.equal(SUPPORT.max_cents, 1000);
  assert.equal(SUPPORT.suggested_cents, 500);
  assert.deepEqual([...SUPPORT.presets_cents], [300, 500, 1000]);
  assert.ok(SUPPORT.max_cents <= 1000, 'support is capped at $10');
});

test('clampSupportCents — floor $1, ceiling $10, non-numeric → suggested', () => {
  assert.equal(clampSupportCents(100), 100);
  assert.equal(clampSupportCents(1000), 1000);
  assert.equal(clampSupportCents(1), 100);
  assert.equal(clampSupportCents(0), 100);
  assert.equal(clampSupportCents(-5), 100);
  assert.equal(clampSupportCents(2500), 1000);
  assert.equal(clampSupportCents(Number.NaN), 500);
  assert.equal(clampSupportCents(undefined), 500);
  assert.equal(clampSupportCents('500'), 500);
});

test('supportCheckoutUrl — choose-your-price omits paymentAmount', () => {
  const href = supportCheckoutUrl();
  const u = new URL(href);
  assert.equal(u.origin, 'https://checkout.dodopayments.com');
  assert.equal(u.pathname, `/buy/${SUPPORT.product_id}`);
  assert.equal(u.searchParams.get('paymentAmount'), null);
});

test('supportCheckoutUrl — chips pass paymentAmount in dollars, clamped', () => {
  assert.equal(new URL(supportCheckoutUrl({ amount_cents: 300 })).searchParams.get('paymentAmount'), '3');
  assert.equal(new URL(supportCheckoutUrl({ amount_cents: 500 })).searchParams.get('paymentAmount'), '5');
  assert.equal(new URL(supportCheckoutUrl({ amount_cents: 1000 })).searchParams.get('paymentAmount'), '10');
  assert.equal(new URL(supportCheckoutUrl({ amount_cents: 9999 })).searchParams.get('paymentAmount'), '10');
  assert.equal(new URL(supportCheckoutUrl({ amount_cents: 0 })).searchParams.get('paymentAmount'), '1');
});

test('supportCheckoutUrl — optional return URL', () => {
  const href = supportCheckoutUrl({
    amount_cents: 500,
    redirect_url: 'http://127.0.0.1:3333/?support=thanks',
  });
  const u = new URL(href);
  assert.equal(u.searchParams.get('redirect_url'), 'http://127.0.0.1:3333/?support=thanks');
  assert.equal(u.searchParams.get('paymentAmount'), '5');
});

test('supportPresets — three chips inside the $10 cap', () => {
  const presets = supportPresets();
  assert.equal(presets.length, 3);
  assert.deepEqual(presets.map(p => p.label), ['$3', '$5', '$10']);
  for (const p of presets) {
    assert.ok(p.cents >= 100 && p.cents <= 1000);
    assert.ok(p.href.includes(`paymentAmount=${p.dollars}`));
  }
});

test('home.html — support is a statusbar $ nudge, not a landing panel', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../experience/pages/home.html', import.meta.url), 'utf8');
  const tiles = html.indexOf('id="tiles"');
  const status = html.indexOf('id="statusbar"');
  const nudge = html.indexOf('id="support-nudge"');
  assert.ok(tiles >= 0 && status > tiles && nudge > status);
  assert.ok(!html.slice(tiles, status).includes('id="support-nudge"'),
    '$ does not sit among the view tiles');
  assert.ok(!html.includes('id="support-row"'));
  assert.ok(!html.includes('s-chip'));
  assert.match(html.slice(nudge, nudge + 200), /href="\/support"/);
  assert.ok(/the github version is free/i.test(html));
});

test('silent $ nudge is on every product page', async () => {
  const fs = await import('node:fs');
  const pages = [
    'experience/pages/home.html',
    'experience/pages/now.html',
    'experience/pages/daw-template.html',
    'experience/pages/template.html',
  ];
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    assert.ok(html.includes('id="support-nudge"'), `${p} missing statusbar $`);
    assert.ok(html.includes('href="/support"'), `${p} $ must link /support`);
  }
});

test('supportClientPayload — public fields only, no merchant key', () => {
  const json = JSON.stringify(supportClientPayload());
  assert.equal(json.includes('dodo_'), false);
  assert.equal(json.includes('Bearer'), false);
  assert.equal(json.includes('API_KEY'), false);
  const payload = supportClientPayload();
  assert.equal(payload.product_id, SUPPORT.product_id);
  assert.ok(payload.choose_href.includes(SUPPORT.product_id));
  assert.equal(payload.choose_href.includes('paymentAmount='), false);
  assert.equal(payload.presets.length, 3);
});
