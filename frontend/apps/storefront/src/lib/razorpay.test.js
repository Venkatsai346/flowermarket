import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandColorFromCss,
  razorpayMethodFilter,
  buildRazorpayOptions,
  loadRazorpay,
  openRazorpayCheckout,
} from './razorpay.js';

test('brandColorFromCss accepts hex --brand and falls back otherwise', () => {
  assert.equal(brandColorFromCss({ getPropertyValue: () => '#0F766E' }), '#0F766E');
  assert.equal(brandColorFromCss({ getPropertyValue: () => '  #9F1239  ' }), '#9F1239');
  assert.equal(brandColorFromCss({ getPropertyValue: () => 'oklch(0.5 0.1 20)' }), '#e11d48');
  assert.equal(brandColorFromCss({ getPropertyValue: () => '' }), '#e11d48');
});

test('UPI/card method filter hides the other instruments', () => {
  assert.equal(razorpayMethodFilter('upi').upi, true);
  assert.equal(razorpayMethodFilter('upi').card, false);
  assert.equal(razorpayMethodFilter('card').card, true);
  assert.equal(razorpayMethodFilter('card').upi, false);
  assert.equal(razorpayMethodFilter('cod'), undefined);
});

test('buildRazorpayOptions is secret-free and wires theme + UPI filter', () => {
  const opts = buildRazorpayOptions({
    keyId: 'rzp_test_abc',
    gatewayOrderId: 'order_1',
    amountPaise: 29900,
    method: 'upi',
    themeColor: '#9F1239',
    customer: { name: 'Asha', email: 'a@b.c', contact: '9999999999' },
    notes: { orderNumber: 'FM-000001-1001' },
  });
  assert.equal(opts.key, 'rzp_test_abc');
  assert.equal(opts.order_id, 'order_1');
  assert.equal(opts.amount, 29900);
  assert.equal(opts.theme.color, '#9F1239');
  assert.equal(opts.method.upi, true);
  assert.equal(opts.method.netbanking, false);
  assert.equal(opts.notes.orderNumber, 'FM-000001-1001');
  assert.equal(JSON.stringify(opts).includes('secret'), false);
});

test('loadRazorpay / openRazorpayCheckout never inject Checkout.js without a keyId', async () => {
  const appended = [];
  const prevW = globalThis.window;
  const prevD = globalThis.document;
  globalThis.window = {};
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
    body: { appendChild: (n) => appended.push(n) },
    documentElement: {},
  };
  try {
    await assert.rejects(() => loadRazorpay());
    await assert.rejects(() => loadRazorpay(''));
    await assert.rejects(() => loadRazorpay(null));
    assert.equal(appended.length, 0);
    assert.equal(await openRazorpayCheckout({ keyId: '', gatewayOrderId: 'order_x' }), false);
    assert.equal(await openRazorpayCheckout({ keyId: 'rzp_test', gatewayOrderId: '' }), false);
    assert.equal(appended.length, 0);
  } finally {
    globalThis.window = prevW;
    globalThis.document = prevD;
  }
});
