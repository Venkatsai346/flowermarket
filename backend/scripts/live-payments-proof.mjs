/**
 * LIVE PAYMENTS PROOF — exercises the real running stack end to end:
 *
 *   A. async checkout (MOCK_PAYMENT_PENDING=true) → order PAYMENT_PENDING
 *   B. unsigned mock webhook → 401 (HMAC is mandatory, like Razorpay's)
 *   C. webhook LOST → payment backdated past the staleness window →
 *      admin reconcile endpoint polls the GATEWAY (source of truth) → recovers
 *   D. signed mock webhook → processed → order confirmed; duplicate replay →
 *      deduped; wrong amount → mismatch audit row, payment untouched
 *   E. Prometheus counters reflect all of the above
 *   F. worker's payment-reconcile job is registered in the scheduler
 *
 * Run:  node scripts/live-payments-proof.mjs
 * (API must be running with MOCK_PAYMENT_PENDING=true; worker running.)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';

const API = 'http://127.0.0.1:4000/api/v1';
const TENANT = '6a9d8621360a608803fe1a62';
const ADMIN_EMAIL = 'admin@flowermarket.in';
const ADMIN_PASSWORD = 'Admin@12345';
const MOCK_SECRET = 'mock-webhook-secret-dev';

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}  ${String(detail).slice(0, 160)}`); }
};
const section = (t) => console.log(`\n── ${t}`);

async function api(p, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: {
      'x-tenant-id': TENANT,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* raw */ }
  return { status: res.status, data };
}

// ---------- OTP from the API's console log ----------
function apiLogPath() {
  const dir = '/tmp/arena-workspace/procs';
  let chosen = null, mtime = 0;
  for (const e of fs.readdirSync(dir)) {
    if (!e.startsWith('flower-market-api-')) continue;
    const p = path.join(dir, e, 'out.log');
    if (fs.existsSync(p)) { const m = fs.statSync(p).mtimeMs; if (m >= mtime) { mtime = m; chosen = p; } }
  }
  return chosen;
}
const LOG = apiLogPath();
const readOtp = async (phone, tries = 30) => {
  for (let i = 0; i < tries; i++) {
    const txt = fs.readFileSync(LOG, 'utf8');
    const m = [...txt.matchAll(new RegExp(`SMS to ${phone} \\| purpose=login \\| code=(\\d{6})`, 'g'))];
    if (m.length) return m[m.length - 1][1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('OTP not found in API log');
};

const sign = (raw) => crypto.createHmac('sha256', MOCK_SECRET).update(raw).digest('hex');
const mockWebhook = async (bodyObj, sig = sign(JSON.stringify(bodyObj))) => {
  const raw = JSON.stringify(bodyObj);
  const res = await fetch(`${API}/payments/webhook/mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mock-signature': sig },
    body: raw,
  });
  let data = null; try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
};

const CUST_PHONE = '98' + String(20000000 + Math.floor(Math.random() * 79999999));
const RUN = Date.now().toString(36); // unique per run: event ids must not dedupe against older runs

async function main() {
  const db = new MongoClient('mongodb://127.0.0.1:27017/flower_market?directConnection=true');
  await db.connect();

  // ---- auth: fresh customer + admin ----
  section('auth');
  await api('/auth/otp/request', { method: 'POST', body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: CUST_PHONE } } });
  const code = await readOtp(CUST_PHONE);
  const v = await api('/auth/otp/verify', { method: 'POST', body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: CUST_PHONE }, code } });
  const custTok = v.data?.data?.accessToken || v.data?.data?.tokens?.accessToken;
  check('customer OTP login', v.status === 200 && Boolean(custTok), v.status);
  const addr = await api('/users/me/addresses', {
    method: 'POST', token: custTok,
    body: { name: 'Proof', phone: CUST_PHONE, line1: '1-2-3 Demo St', city: 'Kakinada', state: 'Andhra Pradesh', pincode: '533001', isDefault: true },
  });
  const addressId = addr.data?.data?.id;
  check('address created', addr.status === 201, addr.status);
  const al = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, method: 'email_password' } });
  const adminTok = al.data?.data?.accessToken || al.data?.data?.tokens?.accessToken;
  check('admin login', al.status === 200 && Boolean(adminTok), al.status);

  // ---- shared checkout helper ----
  const checkout = async () => {
    await api('/cart/clear', { method: 'DELETE', token: custTok }); // idempotent-ish (404 on empty cart is fine)
    const listings = (await api('/catalog?limit=10')).data?.data || [];
    const listing = listings.find((l) => ['flower_bouquet', 'plant'].includes(l?.product?.type)) || listings[0];
    await api('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: listing.listingId, qty: 1 } });
    // try today, then the next two days (slots are finite)
    let slot = null;
    for (let d = 0; d < 3 && !slot; d++) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const slots = (await api(`/cart/slots?pincode=533001&date=${date}`, { token: custTok })).data?.data?.slots || [];
      slot = slots.find((s) => (s.remaining ?? s.available) > 0) || null;
    }
    if (!slot) throw new Error('no delivery slot available in next 3 days');
    const resv = await api(`/cart/slots/${slot.id || slot._id}/reserve`, { method: 'POST', token: custTok });
    const r = await api('/cart/checkout', {
      method: 'POST', token: custTok,
      body: { slotReservationId: resv.data?.data?.id, addressId, paymentMethod: 'upi', confirmPriceChanges: true },
    });
    return { order: r.data?.data?.order, r };
  };

  // ============ A. async checkout ============
  section('A. async mock checkout (Razorpay-like)');
  const a = await checkout();
  const aOrder = a.order;
  check('checkout → 201 + paymentPending flag', a.r.status === 201 && a.r.data?.data?.paymentPending === true, JSON.stringify(a.r.data).slice(0, 120));
  check('order in PAYMENT_PENDING', aOrder?.status === 'payment_pending', aOrder?.status);
  check('gatewayOrderId handed to client', Boolean(a.r.data?.data?.gatewayOrderId), a.r.data?.data?.gatewayOrderId);
  const ps = await api(`/orders/${aOrder.id}/payment`, { token: custTok });
  check('customer sees payment pending', ps.status === 200 && ps.data?.data?.payment?.status === 'pending', JSON.stringify(ps.data?.data?.payment).slice(0, 120));
  const aPay = await db.db('flower_market').collection('payments').findOne({ orderId: new ObjectId(aOrder.id) });
  check('payment doc pending with gatewayOrderId', aPay?.status === 'pending' && Boolean(aPay?.gatewayOrderId), aPay?.status);

  // ============ B. unsigned webhook rejected ============
  section('B. signature enforcement');
  const unsigned = await fetch(`${API}/payments/webhook/mock`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayOrderId: aPay.gatewayOrderId, eventId: `evt_live_unsigned_${RUN}` }),
  });
  check('unsigned mock webhook → 401', unsigned.status === 401, unsigned.status);
  const bPay = await db.db('flower_market').collection('payments').findOne({ _id: aPay._id });
  check('state unchanged after 401', bPay.status === 'pending', bPay.status);

  // ============ C. webhook lost → reconciliation against the gateway ============
  // The mock gateway only records a capture when it NOTIFIES (capture-on-notify
  // model — the in-process stand-in for "customer completed on the gateway
  // page"). So a lost webhook here means the gateway has NO capture: the sweep
  // must fail the payment and cancel the order — NEVER confirm without the
  // gateway's attestation. (The other branch — gateway holds the capture,
  // webhook lost → RECOVER — is proven hermetically via mockGatewaySet in
  // smoke-payments §9, since cross-process mock-gateway state is unreachable
  // from this script.)
  section('C. webhook loss → reconcile asks the gateway (source of truth)');
  // simulate the webhook never arriving and the payment going stale (15-min window)
  await db.db('flower_market').collection('payments').updateOne({ _id: aPay._id }, { $set: { createdAt: new Date(Date.now() - 16 * 60000) } });
  const rec = await api('/fulfillment/reconcile/payments', { method: 'POST', token: adminTok });
  check('admin reconcile sweep → 200', rec.status === 200, rec.status);
  const cOrder = await db.db('flower_market').collection('orders').findOne({ _id: new ObjectId(aOrder.id) });
  const cPay = await db.db('flower_market').collection('payments').findOne({ _id: aPay._id });
  check('gateway silent → payment FAILED (never confirmed without attestation)', cPay?.status === 'failed', cPay?.status);
  check('saga compensated: order cancelled', cOrder?.status === 'cancelled', cOrder?.status);
  check('sweep reported the failure (ops-visible result)', Array.isArray(rec.data?.data?.failed) && rec.data.data.failed.length === 1, JSON.stringify(rec.data?.data).slice(0, 120));

  // ============ D. signed webhook: process / dedupe / mismatch ============
  section('D. signed webhook pipeline');
  const d = await checkout();
  const dPay = await db.db('flower_market').collection('payments').findOne({ orderId: new ObjectId(d.order.id) });
  const dAmountPaise = Math.round(dPay.amount * 100);
  const good = await mockWebhook({ gatewayOrderId: dPay.gatewayOrderId, eventId: `evt_live_good_${RUN}`, amountPaise: dAmountPaise });
  check('signed capture webhook → 200 processed', good.status === 200 && good.data?.data?.result === 'processed', JSON.stringify(good.data).slice(0, 120));
  const dOrder = await db.db('flower_market').collection('orders').findOne({ _id: new ObjectId(d.order.id) });
  check('order confirmed by webhook', dOrder?.status === 'confirmed', dOrder?.status);
  const dup = await mockWebhook({ gatewayOrderId: dPay.gatewayOrderId, eventId: `evt_live_good_${RUN}`, amountPaise: dAmountPaise });
  check('replayed delivery → duplicate (idempotent)', dup.status === 200 && dup.data?.data?.result === 'duplicate', JSON.stringify(dup.data).slice(0, 120));
  const events = await db.db('flower_market').collection('paymentwebhookevents').find({ eventId: `evt_live_good_${RUN}` }).toArray();
  check('single audit row for the event id', events.length === 1, `rows=${events.length}`);
  check('audit disposition preserved after replay (processed, deliveries=2)', events[0]?.status === 'processed' && events[0]?.deliveries === 2, `status=${events[0]?.status} deliveries=${events[0]?.deliveries}`);

  const m = await checkout();
  const mPay = await db.db('flower_market').collection('payments').findOne({ orderId: new ObjectId(m.order.id) });
  const badAmt = await mockWebhook({ gatewayOrderId: mPay.gatewayOrderId, eventId: `evt_live_mismatch_${RUN}`, amountPaise: 99999999 });
  check('wrong-amount webhook → 200 ack + mismatch result', badAmt.status === 200 && badAmt.data?.data?.result === 'mismatch', JSON.stringify(badAmt.data).slice(0, 120));
  const mPayAfter = await db.db('flower_market').collection('payments').findOne({ _id: mPay._id });
  check('mismatch leaves payment PENDING (untouched)', mPayAfter?.status === 'pending', mPayAfter?.status);
  const mmRow = await db.db('flower_market').collection('paymentwebhookevents').findOne({ eventId: `evt_live_mismatch_${RUN}` });
  check('mismatch audit row written with evidence', mmRow?.status === 'mismatch' && /99999999/.test(mmRow?.note || ''), mmRow?.note || 'no row');

  // ============ E. metrics ============
  section('E. observability');
  const mtext = await (await fetch('http://127.0.0.1:4000/metrics')).text();
  check('fm_webhook_events_total{processed} = 1', /fm_webhook_events_total\{provider="mock",result="processed"\} 1\b/.test(mtext), mtext.split('\n').filter((l) => l.startsWith('fm_webhook_events_total{')).join(' '));
  check('fm_webhook_events_total{duplicate} = 1', /fm_webhook_events_total\{provider="mock",result="duplicate"\} 1\b/.test(mtext), '');
  check('fm_webhook_events_total{mismatch} = 1', /fm_webhook_events_total\{provider="mock",result="mismatch"\} 1\b/.test(mtext), '');
  check('fm_payment_pending_count gauge present', /fm_payment_pending_count \d+/.test(mtext), '');

  // ============ F. worker job registered ============
  section('F. worker payment-reconcile job');
  const jobs = await db.db('flower_market').collection('scheduledjobs').find({}).toArray();
  const pr = jobs.find((j) => j.name === 'payment-reconcile');
  check('payment-reconcile job persisted in scheduler', Boolean(pr), JSON.stringify(jobs.map((j) => j.name)));
  check('job has a future nextRunAt (5-min cadence)', Boolean(pr?.nextRunAt && new Date(pr.nextRunAt) > new Date()), pr?.nextRunAt);

  console.log(`\n=== LIVE PAYMENTS PROOF: ${passed} passed, ${failed} failed ===`);
  await db.close();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('FATAL', e); process.exit(1); });
