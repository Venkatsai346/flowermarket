// ASYNC-PAYMENT-LIVE — proof of the async (pending) payment flow on the
// RUNNING stack (API :4000, seeded tenant, console OTP provider):
//   dev toggle → pending mode → checkout returns paymentPending →
//   GET /orders/:id/payment polls pending → signed gateway webhook
//   (HMAC, same contract as Razorpay) captures → order flips to confirmed
//   → toggle restored.
//
// Run: node scripts/async-payment-live.test.mjs
// (requires the live stack from scripts/ci/boot-live-stack.sh)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:4000/api/v1';
const WEBHOOK_SECRET = process.env.MOCK_PAYMENT_WEBHOOK_SECRET || 'mock-webhook-secret-dev';

// API log discovery (console OTP provider) — same convention as e2e-live.mjs
function apiLogPath() {
  if (process.env.API_LOG_FILE) return process.env.API_LOG_FILE;
  const conventional = '/tmp/fm-ci/api.out.log';
  if (fs.existsSync(conventional)) return conventional;
  const dir = '/tmp/arena-workspace/procs';
  let chosen = null, mtime = 0;
  for (const e of fs.readdirSync(dir)) {
    if (!e.startsWith('flower-market-api-')) continue;
    const p = path.join(dir, e, 'out.log');
    if (fs.existsSync(p)) { const m = fs.statSync(p).mtimeMs; if (m >= mtime) { mtime = m; chosen = p; } }
  }
  if (!chosen) throw new Error('backend out.log not found under ' + dir);
  return chosen;
}
const LOG = apiLogPath();

let passed = 0; let failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const req = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* raw */ }
  return { status: r.status, data: data?.data ?? data };
};

const adminRes = await req('/auth/login', {
  method: 'POST',
  body: { email: 'admin@flowermarket.in', password: 'Admin@12345', method: 'email_password' },
});
const adminTok = adminRes.data?.tokens?.accessToken;
if (!adminTok) throw new Error('admin login failed: ' + JSON.stringify(adminRes.data).slice(0, 200));

console.log('— 0. dev toggle (admin) —');
const off = await req('/fulfillment/payments/mock/force-pending', { method: 'POST', token: adminTok, body: { enabled: false } });
ok(off.status === 200 && off.data?.mockPending === false, 'toggle off → sync mode', JSON.stringify(off.data));
const asCust403 = await req('/fulfillment/payments/mock/force-pending', { method: 'POST', body: { enabled: true } });
ok(asCust403.status === 401, 'anonymous toggle → 401', `got ${asCust403.status}`);
const on = await req('/fulfillment/payments/mock/force-pending', { method: 'POST', token: adminTok, body: { enabled: true } });
ok(on.status === 200 && on.data?.mockPending === true, 'toggle on → async (pending) mode', JSON.stringify(on.data));

console.log('— 1. customer checkout in pending mode —');
const logOffset = fs.statSync(LOG).size;
const phone = `9720${String(Date.now()).slice(-6)}`;
await req('/auth/otp/request', { method: 'POST', body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: phone } } });
await sleep(700);
const tail = fs.readFileSync(LOG, 'utf8').slice(logOffset);
const otpMatch = [...tail.matchAll(/code=(\d{6})/g)].pop();
if (!otpMatch) throw new Error('no OTP in API log');
const rv = await req('/auth/otp/verify', {
  method: 'POST',
  body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: phone }, code: otpMatch[1] },
});
const custTok = rv.data?.tokens?.accessToken || rv.data?.accessToken;
ok(Boolean(custTok), 'customer OTP login');

const addr = (await req('/users/me/addresses', { method: 'POST', token: custTok, body: {
  name: 'Async Flow Tester', phone: '9876500099', line1: '1 Pending Lane', city: 'Kakinada', state: 'Andhra Pradesh', pincode: '533001', isDefault: true,
} })).data;
const cat = (await req('/catalog?limit=10', { token: custTok })).data;
const listing = cat.find((l) => l.product?.isPerishable === false) || cat[0];
await req('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: listing.listingId, qty: 1 } });
const today = new Date().toISOString().slice(0, 10);
const slots = (await req(`/cart/slots?pincode=533001&date=${today}`, { token: custTok })).data;
const slot = slots.slots.find((s) => (s.remaining ?? s.available) > 0);
const slotRes = (await req(`/cart/slots/${slot.id}/reserve`, { method: 'POST', token: custTok, body: {} })).data;
const quote = (await req('/cart/quote', { method: 'POST', token: custTok, body: { slotReservationId: slotRes.id, addressId: addr.id } })).data;
const co = await req('/cart/checkout', { method: 'POST', token: custTok, body: {
  slotReservationId: slotRes.id, addressId: addr.id, paymentMethod: 'upi', confirmPriceChanges: true,
} });
const order = co.data?.order || co.data;
ok(co.status === 201 && co.data?.paymentPending === true, 'checkout → 201 + paymentPending', `status ${co.status}, data ${JSON.stringify(co.data).slice(0, 120)}`);
ok(Boolean(co.data?.gatewayOrderId), 'gatewayOrderId returned', co.data?.gatewayOrderId);
ok(order?.status === 'payment_pending', 'order status payment_pending', order?.status);
ok(typeof co.data?.amountPaise === 'number' && co.data.amountPaise > 0, 'Checkout.js amountPaise', co.data?.amountPaise);
ok(co.data?.customer && typeof co.data.customer === 'object', 'Checkout.js customer prefill', JSON.stringify(co.data?.customer).slice(0, 80));

console.log('— 2. polling endpoint shows pending —');
const p1 = (await req(`/orders/${order.id}/payment`, { token: custTok })).data;
ok(p1?.order?.status === 'payment_pending' && p1?.payment?.status === 'pending', 'poll → pending', JSON.stringify(p1).slice(0, 140));
ok(p1?.payment?.gatewayOrderId === co.data?.gatewayOrderId, 'poll exposes the gateway order ref');

console.log('— 3. signed gateway webhook captures the payment —');
const amountPaise = Math.round(Number(quote.grandTotal) * 100);
const body = JSON.stringify({
  eventId: `evt_async_${Date.now()}`,
  gatewayOrderId: co.data.gatewayOrderId,
  gatewayPaymentId: `mpay_async_${Date.now().toString(36)}`,
  amountPaise,
});
const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex');
const wh = await fetch('http://127.0.0.1:4000/api/v1/payments/webhook/mock', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-mock-signature': sig },
  body,
});
ok(wh.status === 200, 'webhook accepted (HMAC verified)', `got ${wh.status}`);
const tampered = await fetch('http://127.0.0.1:4000/api/v1/payments/webhook/mock', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'sha256=deadbeef' },
  body,
});
ok(tampered.status === 401, 'tampered signature rejected', `got ${tampered.status}`);

console.log('— 4. order flips to confirmed (what the storefront poll observes) —');
let p2 = null;
for (let i = 0; i < 10; i++) {
  p2 = (await req(`/orders/${order.id}/payment`, { token: custTok })).data;
  if (p2?.order?.status !== 'payment_pending') break;
  await sleep(1000);
}
ok(p2?.order?.status === 'confirmed', 'order confirmed after webhook', `status ${p2?.order?.status}`);
ok(p2?.payment?.status === 'success' && Boolean(p2?.payment?.paidAt), 'payment success + paidAt', JSON.stringify(p2?.payment).slice(0, 140));

console.log('— 5. restore sync mode —');
const off2 = await req('/fulfillment/payments/mock/force-pending', { method: 'POST', token: adminTok, body: { enabled: false } });
ok(off2.status === 200 && off2.data?.mockPending === false, 'toggle off → sync mode restored');

console.log('');
console.log(`async-flow-live: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
