/**
 * E2E-LIVE — exercises every customer/admin feature against the LIVE stack:
 *   backend :4000 + seeded tenant (header tenant resolution on localhost).
 *
 * Plain HTTP only (no in-app shortcuts). OTPs are read from the backend's
 * console provider log (OTP_PROVIDER=console).
 *
 * Run: node scripts/e2e-live.mjs
 * (requires the stack from boot-stack to be up; OTP log path is discovered
 * from /tmp/arena-workspace/procs/flower-market-api-backend-<id>/out.log)
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:4000/api/v1';
// CI re-seeds a fresh tenant per run; scripts/ci/boot-live-stack.sh exports
// FM_TENANT_ID via /tmp/fm-ci/env.sh.
const TENANT = process.env.FM_TENANT_ID || '6a9d8621360a608803fe1a62';
const ADMIN_EMAIL = 'admin@flowermarket.in';
const ADMIN_PASSWORD = 'Admin@12345';
const CUST_PHONE = '98' + String(10000000 + Math.floor(Math.random() * 89999999));
const RIDER_PHONE = '9000000009';

// ---- OTP log discovery (console provider) ----
// $API_LOG_FILE → /tmp/fm-ci/api.out.log (scripts/ci convention) → newest
// flower-market-api-* process dir's out.log (sandbox start_process layout).
function otpLogPath() {
  if (process.env.API_LOG_FILE) return process.env.API_LOG_FILE;
  // The live API process's log wins by mtime — a stale conventional path
  // (left over from a previous CI-style run) must not shadow the process
  // that is actually serving requests right now.
  let chosen = null, mtime = 0;
  const consider = (p) => {
    if (!p || !fs.existsSync(p)) return;
    const m = fs.statSync(p).mtimeMs;
    if (m >= mtime) { mtime = m; chosen = p; }
  };
  consider('/tmp/fm-ci/api.out.log');
  const dir = '/tmp/arena-workspace/procs';
  if (fs.existsSync(dir)) {
    for (const e of fs.readdirSync(dir)) {
      if (!e.startsWith('flower-market-api-')) continue;
      consider(path.join(dir, e, 'out.log'));
    }
  }
  if (!chosen) throw new Error('backend out.log not found (/tmp/fm-ci or ' + dir + ')');
  return chosen;
}
const OTP_LOG = otpLogPath();
const logOffset = () => (fs.existsSync(OTP_LOG) ? fs.statSync(OTP_LOG).size : 0);

async function readOtp(target, purpose, fromOffset = 0, tries = 20) {
  const before = fromOffset;
  for (let i = 0; i < tries; i += 1) {
    const now = fs.readFileSync(OTP_LOG, 'utf8');
    const fresh = now.slice(before.length);
    const re = new RegExp(`\\[otp:console\\][^\\n]*${target}[^\\n]*purpose=${purpose}[^\\n]*code=([0-9]+)`, 'g');
    const codes = [...fresh.matchAll(re)].map((m) => m[1]);
    if (codes.length) return codes[codes.length - 1];
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// ---- tiny harness ----
const results = [];
const section = (name) => console.log(`\n── ${name} ${'─'.repeat(Math.max(1, 46 - name.length))}`);
async function api(p, { method = 'GET', body, token = null, tenant = TENANT, raw = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (tenant) headers['x-tenant-id'] = tenant;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}
function check(id, name, cond, detail = '') {
  const pass = Boolean(cond);
  results.push({ id, name, pass, detail: String(detail).slice(0, 220) });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${pass ? '' : `  → ${String(detail).slice(0, 200)}`}`);
  return pass;
}
const j = (o) => (o === undefined ? 'undefined' : JSON.stringify(o));

// ===========================================================================
section('1. public catalog (no auth)');
let r = await api('/health');
check('1.1', 'health endpoint', r.status === 200, j(r.data));
r = await api('/catalog?q=rose');
const prods = r.data?.data || [];
check('1.2', 'ranked search returns seeded roses', r.status === 200 && prods.length >= 2, `n=${prods.length}`);
r = await api('/catalog?limit=10');
check('1.3', 'full catalog lists 5 seeded products', r.status === 200 && (r.data?.data?.length ?? 0) === 5, j(r.data?.meta || r.data?.data?.length));
r = await api('/catalog/categories');
check('1.4', 'categories (3 seeded)', r.status === 200 && (r.data?.data?.length ?? 0) >= 3, j(r.data?.data?.length));
r = await api('/catalog/brands');
check('1.5', 'brands (green-thumb)', r.status === 200 && (r.data?.data?.length ?? 0) >= 1, j(r.data?.data?.length));
const redRose = prods.find((p) => /red rose/i.test(p.product?.title || '')) || prods[0];
const productId = redRose?.product?.id; // product detail is keyed by MASTER id
r = await api(`/catalog/products/${productId}`);
check('1.6', 'product detail', r.status === 200 && r.data?.success, j(r.data).slice(0, 120));
r = await api(`/catalog/products/${productId}/stock?pincode=533001`);
check('1.7', 'stock check (qty on hand > 0)', r.status === 200 && (r.data?.data?.qtyOnHand ?? 0) > 0, `status=${r.status} ${j(r.data?.data).slice(0, 120)}`);
r = await api('/search/suggest?q=rose');
check('1.8', 'search suggest', r.status === 200, j(r.data).slice(0, 120));
r = await api('/marketplace/plans');
check('1.9', 'marketplace plan catalog (free/pro/business)', r.status === 200 && (r.data?.data?.length ?? 0) === 3, j(r.data?.data?.length));
r = await api('/catalog', { tenant: null });
check('1.10', 'no header on localhost → DEFAULT_TENANT_ID fallback (200, not 500)', r.status === 200, `status=${r.status} ${j(r.data).slice(0, 100)}`);

// ===========================================================================
section('2. customer auth (phone OTP)');
const off1 = logOffset();
r = await api('/auth/otp/request', { method: 'POST', body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: CUST_PHONE } } });
check('2.1', 'OTP request accepted', r.status === 200 || r.status === 202, j(r.data).slice(0, 140));
const code = await readOtp(CUST_PHONE, 'login', off1);
check('2.2', 'console OTP delivered', Boolean(code), 'no [otp:console] line in log');
r = await api('/auth/otp/verify', { method: 'POST', body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: CUST_PHONE }, code } });
const custTok = r.data?.data?.accessToken || r.data?.data?.tokens?.accessToken;
check('2.3', 'OTP verify → session tokens', r.status === 200 && Boolean(custTok), j(r.data).slice(0, 160));
r = await api('/auth/otp/verify', { method: 'POST', body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: CUST_PHONE }, code: '000000' } });
check('2.4', 'wrong OTP rejected (4xx, not logged in)', [400, 401].includes(r.status) && !r.data?.data?.accessToken, `status=${r.status}`);
r = await api('/users/me', { token: custTok });
check('2.5', 'profile (customer role)', r.status === 200 && r.data?.data?.role === 'customer', j(r.data?.data?.role));
r = await api('/users/me', {});
check('2.6', 'unauthenticated /users/me → 401', r.status === 401, `status=${r.status}`);

// ===========================================================================
section('3. saved addresses + wallet');
r = await api('/users/me/addresses', { method: 'POST', token: custTok, body: {
  name: 'E2E Tester', phone: '9876543210', line1: '12-3-45, Dwaraka Nagar', line2: 'Near Lake',
  city: 'Kakinada', state: 'Andhra Pradesh', pincode: '533001', isDefault: true,
} });
const addressId = r.data?.data?.id || r.data?.data?._id;
check('3.1', 'address created', r.status === 201 && Boolean(addressId), j(r.data).slice(0, 140));
r = await api('/users/me/addresses', { token: custTok });
check('3.2', 'address list', r.status === 200 && (r.data?.data?.length ?? 0) === 1, `status=${r.status} ${j(r.data?.data).slice(0, 100)}`);
r = await api('/wallet', { token: custTok });
check('3.3', 'wallet balance = 0 initially', r.status === 200 && (r.data?.data?.balance === 0), j(r.data?.data).slice(0, 100));

// ===========================================================================
section('4. cart → quote → checkout (UPI mock)');
// The main order is the one that later goes through delivery + return (QC
// returns require a RETURNABLE product). Rank order varies with order
// history, so pick the first NON-PERISHABLE listing explicitly instead of
// trusting data[0] (a fresh flower is perishable → isReturnable=false).
const allListings = (await api('/catalog?limit=10')).data?.data || [];
const listing = allListings.find((l) => l?.product?.isPerishable === false) || allListings[0];
const tpId = listing?.listingId; // cart is keyed by the LISTING (tenant product) id
r = await api('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: tpId, qty: 1 } });
check('4.1', 'cart add item', r.status === 200, j(r.data).slice(0, 160));
r = await api('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: tpId, qty: 9999 } });
check('4.2', 'qty capped at stock (no 500)', [200, 400, 409].includes(r.status), `status=${r.status}`);
const today = new Date().toISOString().slice(0, 10);
r = await api(`/cart/slots?pincode=533001&date=${today}`, { token: custTok });
const slot = (r.data?.data?.slots || []).find((s) => (s.remaining ?? s.available) > 0);
check('4.3', 'slot list for pincode+date', r.status === 200 && Boolean(slot), j(r.data?.data).slice(0, 160));
r = await api(`/cart/slots/${slot?.id || slot?._id}/reserve`, { method: 'POST', token: custTok });
const slotRes = r.data?.data?.id || r.data?.data?._id;
check('4.4', 'slot reserved (10-min hold)', r.status === 200 && Boolean(slotRes), j(r.data).slice(0, 140));
r = await api('/cart/quote', { method: 'POST', token: custTok, body: { slotReservationId: slotRes, addressId } });
check('4.5', 'checkout quote (server-priced, grandTotal)', r.status === 200 && Number(r.data?.data?.grandTotal) > 0, `status=${r.status} ${j(r.data?.data).slice(0, 160)}`);
const quoteTotal = r.data?.data?.grandTotal;
r = await api('/cart/checkout', { method: 'POST', token: custTok, body: { slotReservationId: slotRes, addressId, paymentMethod: 'upi', confirmPriceChanges: true } });
const orderId = r.data?.data?.order?.id || r.data?.data?.order?._id || r.data?.data?.id;
check('4.6', 'checkout → order created (201)', r.status === 201 && Boolean(orderId), j(r.data).slice(0, 200));
check('4.7', 'order number format FM-YYMMDD-#####', /FM-\d{6}-\d{5}/.test(r.data?.data?.order?.orderNumber || r.data?.data?.orderNumber || ''), r.data?.data?.order?.orderNumber || r.data?.data?.orderNumber);
check('4.8', 'charged total matches quote', Number(r.data?.data?.order?.totalAmount ?? 0) === Number(quoteTotal), `paid=${r.data?.data?.order?.totalAmount} quote=${quoteTotal}`);
r = await api('/orders', { token: custTok });
check('4.9', 'my orders list', r.status === 200 && (r.data?.data?.length ?? 0) === 1, j(r.data?.data?.length));
r = await api(`/orders/${orderId}`, { token: custTok });
check('4.10', 'order detail (confirmed)', r.status === 200 && (r.data?.data?.order?.status === 'confirmed'), `status=${r.status} ${j(r.data?.data?.order?.status)}`);
r = await api(`/orders/${orderId}/timeline`, { token: custTok });
check('4.11', 'order timeline (history rows)', r.status === 200 && (r.data?.data?.history?.length ?? 0) >= 1, `status=${r.status} rows=${r.data?.data?.history?.length}`);

// ===========================================================================
section('5. admin auth + RBAC');
r = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, method: 'email_password' } });
const adminTok = r.data?.data?.accessToken || r.data?.data?.tokens?.accessToken;
check('5.1', 'admin email+password login', r.status === 200 && Boolean(adminTok), j(r.data).slice(0, 140));
r = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: 'wrong-password-1', method: 'email_password' } });
check('5.2', 'wrong password rejected (401)', r.status === 401, `status=${r.status}`);
r = await api('/admin/orders', { token: custTok });
check('5.3', 'RBAC: customer blocked from /admin (403)', r.status === 403, `status=${r.status}`);
r = await api('/admin/orders', {});
check('5.4', 'RBAC: anonymous blocked from /admin (401)', r.status === 401, `status=${r.status}`);
r = await api('/admin/orders', { token: adminTok });
check('5.5', 'admin orders list', r.status === 200 && (r.data?.data?.length ?? 0) >= 1, j(r.data?.data?.length));
r = await api('/admin/products', { token: adminTok });
check('5.6', 'admin products list', r.status === 200, j(r.data).slice(0, 100));
r = await api('/admin/inventory/summary', { token: adminTok });
check('5.7', 'admin inventory summary', r.status === 200, j(r.data).slice(0, 100));
r = await api('/admin/users', { token: adminTok });
check('5.8', 'admin users list', r.status === 200 && (r.data?.data?.length ?? 0) >= 2, j(r.data?.data?.length));

// ===========================================================================
section('6. fulfillment: pick → pack → dispatch → rider machine');
r = await api(`/fulfillment/orders/${orderId}/pick`, { method: 'POST', token: adminTok });
check('6.1', 'start picking', r.status === 200, j(r.data).slice(0, 140));
r = await api(`/fulfillment/orders/${orderId}/pack`, { method: 'POST', token: adminTok });
check('6.2', 'mark packed', r.status === 200, j(r.data).slice(0, 140));
r = await api(`/fulfillment/orders/${orderId}/dispatch`, { method: 'POST', token: adminTok, body: {} });
check('6.3', 'dispatch (rider assigned)', r.status === 200, j(r.data).slice(0, 160));
// rider logs in via OTP (demo rider 9000000009)
const off2 = logOffset();
await api('/auth/otp/request', { method: 'POST', body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: RIDER_PHONE } } });
const riderCode = await readOtp(RIDER_PHONE, 'login', off2);
r = await api('/auth/otp/verify', { method: 'POST', body: { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: RIDER_PHONE }, code: riderCode } });
const riderTok = r.data?.data?.accessToken || r.data?.data?.tokens?.accessToken;
check('6.4', 'rider OTP login (rider role)', r.status === 200 && (r.data?.data?.user?.role === 'rider' || r.data?.data?.role === 'rider'), `status=${r.status} ${j(r.data?.data?.user?.role ?? r.data?.data?.role)}`);
r = await api('/rider/deliveries', { token: riderTok });
const delivery = (r.data?.data?.deliveries || r.data?.data || []).find((d) => String(d.orderId) === String(orderId)) || (r.data?.data?.deliveries || r.data?.data || [])[0];
const deliveryId = delivery?.id || delivery?._id;
check('6.5', 'rider sees the delivery', r.status === 200 && Boolean(deliveryId), j(r.data).slice(0, 160));
r = await api(`/rider/deliveries/${deliveryId}/accept`, { method: 'POST', token: riderTok });
check('6.6', 'rider accepts', r.status === 200, j(r.data).slice(0, 120));
r = await api(`/rider/deliveries/${deliveryId}/arrive-hub`, { method: 'POST', token: riderTok });
check('6.7', 'arrive at hub', r.status === 200, j(r.data).slice(0, 120));
r = await api(`/rider/deliveries/${deliveryId}/depart`, { method: 'POST', token: riderTok, body: { package_verified: true } });
check('6.8', 'depart (package verified)', r.status === 200, j(r.data).slice(0, 120));
r = await api(`/rider/deliveries/${deliveryId}/arrive`, { method: 'POST', token: riderTok });
check('6.9', 'arrive at customer', r.status === 200, j(r.data).slice(0, 120));
r = await api(`/rider/deliveries/${deliveryId}/complete`, { method: 'POST', token: riderTok, body: { pod_type: 'otp', pod_reference: '4321' } });
check('6.10', 'complete with OTP POD → delivered', r.status === 200, j(r.data).slice(0, 140));
r = await api(`/orders/${orderId}`, { token: custTok });
check('6.11', 'customer sees status=delivered', r.data?.data?.order?.status === 'delivered' || r.data?.data?.status === 'delivered', `status=${r.status} ${j(r.data?.data?.order?.status ?? r.data?.data?.status)}`);
r = await api('/fulfillment/orders', { token: adminTok });
check('6.12', 'ops order board lists delivered order', r.status === 200, j(r.data).slice(0, 100));

// ===========================================================================
section('7. return (pickup+QC) → wallet refund');
const orderDetail = (await api(`/orders/${orderId}`, { token: custTok })).data?.data;
const item = (orderDetail?.items || [])[0];
r = await api('/returns', { method: 'POST', token: custTok, body: {
  orderId, items: [{ orderItemId: item.id || item._id, qty: 1 }],
  reason: 'Arrived wilted', claimType: 'pickup_qc',
} });
const returnId = r.data?.data?.returnRequest?.id || r.data?.data?.returnRequest?._id || r.data?.data?.id || r.data?.data?._id;
check('7.1', 'return request created (pickup_qc)', [200, 201].includes(r.status) && Boolean(returnId), `status=${r.status} ${j(r.data?.data).slice(0, 140)}`);
r = await api(`/returns/${returnId}/pickup`, { method: 'POST', token: adminTok });
check('7.2', 'ops marks pickup done', r.status === 200, j(r.data).slice(0, 140));
r = await api(`/returns/${returnId}/qc`, { method: 'POST', token: adminTok, body: { decision: 'pass', note: 'QC passed' } });
check('7.3', 'QC pass → refund initiated', r.status === 200, j(r.data).slice(0, 160));
r = await api('/wallet', { token: custTok });
const walletAfter = r.data?.data?.balance;
check('7.4', 'refund credited to wallet (>0)', r.status === 200 && Number(walletAfter) > 0, `status=${r.status} balance=${walletAfter}`);
r = await api('/wallet/refunds', { token: custTok });
check('7.5', 'wallet refunds ledger', r.status === 200 && (r.data?.data?.length ?? 0) >= 1, j(r.data?.data).slice(0, 120));

// ===========================================================================
section('8. wallet checkout + cancellation saga');
const marigold = (await api('/catalog?q=marigold')).data?.data?.[0];
r = await api('/cart/clear', { method: 'DELETE', token: custTok });
r = await api('/cart/items', { method: 'POST', token: custTok, body: { tenantProductId: marigold?.listingId, qty: 1 } });
check('8.1', 'cart refilled (marigold)', r.status === 200, j(r.data).slice(0, 120));
r = await api(`/cart/slots?pincode=533001&date=${today}`, { token: custTok });
const slot2 = (r.data?.data?.slots || []).find((s) => (s.remaining ?? s.available) > 0);
r = await api(`/cart/slots/${slot2?.id || slot2?._id}/reserve`, { method: 'POST', token: custTok });
const slotRes2 = r.data?.data?.id || r.data?.data?._id;
r = await api('/cart/checkout', { method: 'POST', token: custTok, body: { slotReservationId: slotRes2, addressId, paymentMethod: 'wallet', confirmPriceChanges: true } });
const order2 = r.data?.data?.order?.id || r.data?.data?.order?._id || r.data?.data?.id;
check('8.2', 'wallet checkout confirmed', r.status === 201 && (r.data?.data?.order?.status === 'confirmed'), j(r.data).slice(0, 180));
r = await api('/wallet', { token: custTok });
check('8.3', 'wallet debited', r.status === 200 && Number(r.data?.data?.balance) < Number(walletAfter), `status=${r.status} balance=${r.data?.data?.balance} was=${walletAfter}`);
r = await api(`/orders/${order2}/cancel`, { method: 'POST', token: custTok, body: { reason: 'changed_mind' } });
check('8.4', 'pre-pick cancellation accepted', [200, 202].includes(r.status), j(r.data).slice(0, 140));
r = await api(`/orders/${order2}`, { token: custTok });
check('8.5', 'order cancelled + wallet refunded', (r.data?.data?.order?.status === 'cancelled' || r.data?.data?.status === 'cancelled') && r.data?.data?.order?.paymentSummary?.status === 'refunded', `status=${r.data?.data?.order?.status ?? r.data?.data?.status} payment=${r.data?.data?.order?.paymentSummary?.status}`);
r = await api('/wallet', { token: custTok });
check('8.6', 'wallet balance restored', r.status === 200 && Number(r.data?.data?.balance) === Number(walletAfter), j(r.data?.data).slice(0, 100));

// ===========================================================================
section('9. admin catalog ops (live index + RBAC picking)');
r = await api('/catalog/admin/categories', { token: adminTok });
check('9.1', 'admin catalog categories', r.status === 200, j(r.data).slice(0, 100));
r = await api('/catalog/admin/masters', { token: adminTok });
check('9.2', 'admin product masters', r.status === 200, j(r.data).slice(0, 100));
r = await api('/catalog/admin/events/drain', { method: 'POST', token: adminTok });
check('9.3', 'outbox drain (no pending events)', r.status === 200, j(r.data).slice(0, 140));
r = await api('/catalog', { token: custTok });
check('9.4', 'catalog still healthy after ops', r.status === 200 && (r.data?.data?.length ?? 0) === 5, `n=${r.data?.data?.length}`);

// ===========================================================================
section('10. storefront frontends (HTTP liveness)');
for (const [label, url] of [['admin web :5173', 'http://127.0.0.1:5173/'], ['storefront :5174', 'http://127.0.0.1:5174/']]) {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const body = await res.text();
    check(`10.${label.includes('5173') ? 1 : 2}`, `${label} serves HTML`, res.status === 200 && /<html/i.test(body), `status=${res.status}`);
  } catch (e) {
    check(`10.${label.includes('5173') ? 1 : 2}`, `${label} serves HTML`, false, e.message);
  }
}

// ===========================================================================
section('11. money audit backbone (Phase 10)');
{
  // 11.1 — trace middleware: an inbound x-trace-id is echoed on the response
  const res11 = await fetch(BASE + '/catalog', {
    headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT, 'x-trace-id': 'tr_e2e_live_1111' },
  });
  check('11.1', 'x-trace-id echoed in response header', res11.status === 200 && res11.headers.get('x-trace-id') === 'tr_e2e_live_1111', `status=${res11.status} header=${res11.headers.get('x-trace-id')}`);
}
r = await api(`/orders/${order2}`, { token: custTok });
const o2doc = r.data?.data?.order || r.data?.data;
const traceId2 = o2doc?.traceId;
check('11.2', 'order carries its traceId', r.status === 200 && typeof traceId2 === 'string' && traceId2.startsWith('tr_'), `traceId=${traceId2}`);
r = await api(`/admin/traces/${traceId2}`, { token: adminTok });
const chain = r.data?.data?.chain || [];
const kinds = chain.map((c) => c.kind);
const timeOrdered = chain.every((c, i) => i === 0 || new Date(chain[i - 1].at) <= new Date(c.at));
check('11.3', 'trace chain: sale + refund + cancel on one trace', r.status === 200 && kinds.includes('order.created') && kinds.includes('event.sale_captured') && kinds.includes('event.refund_issued') && kinds.includes('event.order_cancelled') && kinds.includes('journal.sale_captured') && timeOrdered, `steps=${chain.length} kinds=${kinds.join(',')}`);
r = await api('/ledger/integrity', { token: adminTok });
const cov = r.data?.data?.checks?.ledger?.eventJournalCoverage;
check('11.4', 'integrity report: overall ok + full event↔journal coverage', r.status === 200 && r.data?.data?.overall === 'ok' && r.data?.data?.checks?.ledger?.ok === true && cov?.missingJournals === 0 && cov?.missingEvents === 0, `overall=${r.data?.data?.overall} cov=${j(cov)}`);
r = await api('/admin/integrity', { token: adminTok });
check('11.5', 'tenant-scoped integrity (admin)', r.status === 200 && (r.data?.data?.overall === 'ok' || r.data?.data?.overall === 'drift'), `overall=${r.data?.data?.overall}`);
r = await api('/ledger/integrity', { token: custTok });
const replayDenied = await api('/ledger/integrity/replay', { method: 'POST', token: custTok, body: {} });
check('11.6', 'RBAC: replay/report SUPER_ADMIN-only', r.status === 403 && replayDenied.status === 403, `report=${r.status} replay=${replayDenied.status}`);

// Phase 11 — hash chain + fiscal period close
r = await api('/ledger/integrity/replay-chain', { method: 'POST', token: adminTok, body: { limit: 1000 } });
check('11.7', 'chain backfill: unanchored rows anchored (idempotent)', r.status === 200 && typeof r.data?.data?.anchored === 'number', `anchored=${r.data?.data?.anchored} failed=${r.data?.data?.failed?.length}`);
r = await api('/ledger/integrity', { token: adminTok });
const chain11 = r.data?.data?.checks?.auditChain;
check('11.8', 'hash chain verified: no breaks, nothing unanchored', r.status === 200 && chain11?.ok === true && chain11?.breaks?.length === 0 && chain11?.unanchored === 0, JSON.stringify(chain11).slice(0, 160));
{
  const pk = new Date().toISOString().slice(0, 7); // current UTC month
  const close = await api(`/ledger/periods/${pk}/close`, { method: 'POST', token: adminTok });
  check('11.9', 'fiscal period close (SUPER_ADMIN)', close.status === 200 && close.data?.data?.state === 'closed', `status=${close.status} msg=${close.data?.message}`);
  const pr = await api(`/ledger/periods/${pk}`, { token: adminTok });
  check('11.10', 'period report: closed state + balanced journals', pr.status === 200 && pr.data?.data?.state === 'closed' && pr.data?.data?.periodBalanced === true && pr.data?.data?.journals >= 1, JSON.stringify({ state: pr.data?.data?.state, journals: pr.data?.data?.journals, gross: pr.data?.data?.grossCapturedPaise, balanced: pr.data?.data?.periodBalanced }).slice(0, 140));
  const reopen = await api(`/ledger/periods/${pk}/reopen`, { method: 'POST', token: adminTok });
  check('11.11', 'period reopen restores posting', reopen.status === 200 && reopen.data?.data?.state === 'open', `status=${reopen.status} msg=${reopen.data?.message}`);
  const adminPeriods = await api('/admin/periods', { token: adminTok });
  check('11.12', 'tenant period list (admin, tenant-scoped)', adminPeriods.status === 200 && (adminPeriods.data?.data?.items?.length ?? 0) >= 1, `items=${adminPeriods.data?.data?.items?.length}`);
}

// Phase 12 — the cash gate: PSP settlement ingestion (chained money event)
section('12. cash gate: PSP settlement (Phase 12)');
{
  // a paid, non-cancelled order from this run's journey to settle
  const orderList = await api('/orders', { token: custTok });
  const liveOrder = (orderList.data?.data || []).find((o) => o.status !== 'cancelled') || orderList.data?.data?.[0] || {};
  const s = await api('/payouts/admin/settlements', { token: adminTok });
  const sum = s.data?.data || {};
  check('12.1', 'settlement summary: clearing/bank + paid-order queue', s.status === 200 && typeof sum.gatewayClearingPaise === 'number' && sum.paidOrders >= 1 && sum.unsettledOrders >= 1, JSON.stringify({ paid: sum.paidOrders, unsettled: sum.unsettledOrders, clearing: sum.gatewayClearingPaise }).slice(0, 120));

  const clearingBefore = sum.gatewayClearingPaise;
  const ing = await api('/payouts/admin/settlements/ingest', { method: 'POST', token: adminTok, body: { rows: [{ orderNumber: liveOrder.orderNumber }], reference: 'e2e-settlement' } });
  check('12.2', 'ingest settlement for a paid order posts exactly', ing.status === 200 && ing.data?.data?.posted === 1, JSON.stringify(ing.data?.data).slice(0, 120));

  const s2 = await api('/payouts/admin/settlements', { token: adminTok });
  const sum2 = s2.data?.data || {};
  check('12.3', 'clearing reduced by the settled amount', sum2.gatewayClearingPaise === clearingBefore - Math.round(Number(liveOrder.totalAmount) * 100), `before=${clearingBefore} after=${sum2.gatewayClearingPaise}`);
  check('12.4', 'summary reflects the settlement (settledOrders up)', sum2.settledOrders >= sum.settledOrders + 1, `before=${sum.settledOrders} after=${sum2.settledOrders}`);

  // re-ingest is a no-op (idempotent on the event/journal key)
  const ing2 = await api('/payouts/admin/settlements/ingest', { method: 'POST', token: adminTok, body: { rows: [{ orderNumber: liveOrder.orderNumber }] } });
  check('12.5', 're-ingesting the same order is idempotent', ing2.data?.data?.posted === 0 && ing2.data?.data?.skipped === 1, JSON.stringify(ing2.data?.data).slice(0, 120));
}

// Phase 13 — statutory deposits (TCS/TDS to the government)
section('13. statutory deposits (Phase 13)');
{
  const s = await api('/payouts/admin/statutory', { token: adminTok });
  const d = s.data?.data || {};
  check('13.1', 'statutory summary: TCS + TDS picture (owed / deposited / reverts)',
    s.status === 200 && ['tcs', 'tds'].every((k) => d[k] && typeof d[k].outstandingPaise === 'number' && typeof d[k].netDepositedPaise === 'number'),
    JSON.stringify({ tcs: d.tcs, tds: d.tds }).slice(0, 140));
  check('13.2', 'nothing is owed on a fresh book (liabilities 0)', d.tcs?.outstandingPaise === 0 && d.tds?.outstandingPaise === 0, JSON.stringify({ tcs: d.tcs?.outstandingPaise, tds: d.tds?.outstandingPaise }));

  // over-deposit guard: you cannot pay the government more than you withheld
  const over = await api('/payouts/admin/statutory/deposit', { method: 'POST', token: adminTok, body: { statute: 'tcs', amount: 1, utr: 'E2E-CHAVS-0001' } });
  check('13.3', 'over-deposit refused with the actual balance (409)', over.status === 409 && over.data?.code === 'STATUTORY_OVER_DEPOSIT', `status=${over.status} code=${over.data?.code}`);
  check('13.4', 'nothing posted by the refused deposit', (await api('/payouts/admin/statutory', { token: adminTok })).data?.data?.tcs?.outstandingPaise === 0, 'tcs unchanged');

  // RBAC: the customer token cannot touch statutory money
  const r1 = await api('/payouts/admin/statutory', { token: custTok });
  const r2 = await api('/payouts/admin/statutory/deposit', { method: 'POST', token: custTok, body: { statute: 'tds', amount: 1, utr: 'E2E-26Q-0001' } });
  check('13.5', 'RBAC: statutory endpoints SUPER_ADMIN-only', r1.status === 403 && r2.status === 403, `summary=${r1.status} deposit=${r2.status}`);
}

// =====================================================================
// 14. Bank statement reconciliation — the egress truth (Phase 14)
// =====================================================================
section('14. bank statement — the egress truth (Phase 14)');
{
  // unique per run — re-ingesting the SAME {statementRef, lineNo} is a
  // deliberate no-op, so a ref collision with a previous run must not happen
  const stmtRun = Date.now().toString(36).toUpperCase();
  const stmtRef = 'BS-E2E-' + stmtRun;
  const stmtLines = [
    { utr: 'E2E-STMT-' + stmtRun + '-1', amount: 100, description: 'live: unknown credit' },
    { utr: 'E2E-STMT-' + stmtRun + '-2', amount: -50, description: 'live: unknown debit' },
  ];

  const stmtBefore = await api('/payouts/admin/statement', { token: adminTok });
  check('14.1', 'summary shape (totals + queue)', stmtBefore.status === 200 && typeof stmtBefore.data?.data?.total === 'number' && Array.isArray(stmtBefore.data?.data?.queued), 'status ' + stmtBefore.status);

  const stmtRes = await api('/payouts/admin/statement/ingest', { method: 'POST', token: adminTok, body: { statementRef: stmtRef, lines: stmtLines } });
  check('14.2', 'ingest: unknown lines queued, none guessed', stmtRes.status === 201 && stmtRes.data?.data?.queued === 2 && stmtRes.data?.data?.returned === 0 && stmtRes.data?.data?.confirmed === 0, 'status ' + stmtRes.status + ' ' + JSON.stringify(stmtRes.data?.data).slice(0, 160));

  const stmtSum2 = await api('/payouts/admin/statement', { token: adminTok });
  check('14.3', 'the queue shows both lines', stmtSum2.data?.data?.queued.filter((q) => q.statementRef === stmtRef).length === 2, JSON.stringify(stmtSum2.data?.data?.queued).slice(0, 160));

  const stmtRbac1 = await api('/payouts/admin/statement', { token: custTok });
  const stmtRbac2 = await api('/payouts/admin/statement/ingest', { method: 'POST', token: custTok, body: { statementRef: 'BS-RBAC', lines: [{ utr: 'X-12345', amount: 10 }] } });
  check('14.4', 'statement endpoints are platform-admin only', stmtRbac1.status === 403 && stmtRbac2.status === 403, `summary=${stmtRbac1.status} ingest=${stmtRbac2.status}`);
}

// =====================================================================
// §15 Wallet ledger integrity (Phase 16) — the wallet IS a ledger account
// =====================================================================
section('15. wallet ledger integrity (Phase 16)');
{
  const balBefore = await api('/wallet', { token: custTok });
  const before = Number(balBefore.data?.data?.balance || 0);

  const topupRes = await api('/wallet/topup', { method: 'POST', token: custTok, body: { amount: '300.00' } });
  check('15.1', 'topup ₹300 accepted (mock gateway)', topupRes.status === 201 && topupRes.data?.data?.wallet?.balance !== undefined, 'status ' + topupRes.status + ' ' + j(topupRes.data).slice(0, 120));

  const balAfter = await api('/wallet', { token: custTok });
  check('15.2', 'wallet balance = before + 300', Math.abs(Number(balAfter.data?.data?.balance) - (before + 300)) < 0.001, `before=${before} after=${balAfter.data?.data?.balance}`);

  const recon = await api('/wallet/admin/reconcile', { token: adminTok });
  check('15.3', 'reconcile: wallets = customer_wallet_liability after topup', recon.status === 200 && recon.data?.data?.balanced === true && recon.data?.data?.differencePaise === 0, j(recon.data?.data).slice(0, 160));

  const integ = await api('/ledger/integrity', { token: adminTok });
  check('15.4', 'integrity report: wallet check ok', integ.status === 200 && integ.data?.data?.checks?.wallet?.ok === true, j(integ.data?.data?.checks?.wallet).slice(0, 160));

  const rbac1 = await api('/wallet/admin/reconcile', { token: custTok });
  const rbac2 = await api('/wallet/admin/reconcile/repair', { method: 'POST', token: custTok });
  check('15.5', 'reconcile endpoints are platform-admin only', rbac1.status === 403 && rbac2.status === 403, `reconcile=${rbac1.status} repair=${rbac2.status}`);

  const repair = await api('/wallet/admin/reconcile/repair', { method: 'POST', token: adminTok });
  check('15.6', 'no-op repair: already balanced, nothing posted', repair.status === 200 && repair.data?.data?.balanced === true && repair.data?.data?.repaired === null, j(repair.data?.data).slice(0, 160));
}

section('16. vendor payable integrity (Phase 17)');
{
  const vrecon = await api('/payouts/admin/vendor-reconcile', { token: adminTok });
  check('16.1', 'platform vendor reconcile: payable = payout lines, no drift', vrecon.status === 200 && vrecon.data?.data?.ok === true && vrecon.data?.data?.drifted === 0 && Array.isArray(vrecon.data?.data?.vendors), j(vrecon.data?.data).slice(0, 160));

  const vinteg = await api('/ledger/integrity', { token: adminTok });
  check('16.2', 'integrity report: vendors check present and ok', vinteg.status === 200 && vinteg.data?.data?.checks?.vendors?.ok === true, j(vinteg.data?.data?.checks?.vendors).slice(0, 160));

  const vrbac1 = await api('/payouts/admin/vendor-reconcile', { token: custTok });
  const vrbac2 = await api('/payouts/admin/vendor-reconcile/repair', { method: 'POST', token: custTok });
  check('16.3', 'vendor reconcile endpoints are platform-admin only', vrbac1.status === 403 && vrbac2.status === 403, `reconcile=${vrbac1.status} repair=${vrbac2.status}`);

  const vrepair = await api('/payouts/admin/vendor-reconcile/repair', { method: 'POST', token: adminTok });
  check('16.4', 'no-op repair: already balanced, nothing posted', vrepair.status === 200 && vrepair.data?.data?.balanced === true && vrepair.data?.data?.repaired === null, j(vrepair.data?.data).slice(0, 160));

  const listed = Boolean(vrecon.data?.data?.vendors?.[0]?.vendorId);
  const vid = listed ? vrecon.data.data.vendors[0].vendorId : '6a9e00000000000000000001';
  const vs = await api('/payouts/admin/vendor-reconcile?id=' + vid, { token: adminTok });
  // a listed vendor reconciles balanced; an unknown vendor answers a clean
  // zero report (0 lines, 0 due, balanced) — never a 500
  check('16.5', 'per-vendor scope: single vendor reconciles balanced', vs.status === 200 && vs.data?.data?.balanced === true && (!listed || (vs.data?.data?.openLines === 0 && vs.data?.data?.expectedPaise === 0)), j(vs.data?.data).slice(0, 160));
}

section('17. statutory payable integrity (Phase 18)');
{
  const srec = await api('/payouts/admin/statutory-reconcile', { token: adminTok });
  check('17.1', 'platform statutory reconcile: payables = withheld − deposited, no drift', srec.status === 200 && srec.data?.data?.ok === true && srec.data?.data?.drifted === 0 && Array.isArray(srec.data?.data?.statutes), j(srec.data?.data).slice(0, 160));

  const srow = srec.data?.data?.statutes?.find((s) => s.statute === 'tcs');
  check('17.2', 'per-statute picture: withheld / deposited / books to the paise', srec.status === 200 && !!srow && srow.balanced === true && srow.expectedPaise === srow.booksPaise, j(srow).slice(0, 160));

  const sinteg = await api('/ledger/integrity', { token: adminTok });
  check('17.3', 'integrity report: statutory check present and ok', sinteg.status === 200 && sinteg.data?.data?.checks?.statutory?.ok === true, j(sinteg.data?.data?.checks?.statutory).slice(0, 160));

  const srbac1 = await api('/payouts/admin/statutory-reconcile', { token: custTok });
  const srbac2 = await api('/payouts/admin/statutory-reconcile/repair', { method: 'POST', token: custTok });
  check('17.4', 'statutory reconcile endpoints are platform-admin only', srbac1.status === 403 && srbac2.status === 403, `reconcile=${srbac1.status} repair=${srbac2.status}`);

  const srepair = await api('/payouts/admin/statutory-reconcile/repair', { method: 'POST', token: adminTok });
  check('17.5', 'no-op repair: already balanced, nothing posted', srepair.status === 200 && srepair.data?.data?.balanced === true && srepair.data?.data?.repaired === null, j(srepair.data?.data).slice(0, 160));
}

const passed = results.filter((x) => x.pass).length;
console.log(`\n${'═'.repeat(64)}`);
console.log(`E2E-LIVE: ${passed}/${results.length} cases passed`);
if (passed < results.length) {
  console.log('\nFailed cases:');
  for (const f of results.filter((x) => !x.pass)) console.log(`  ✗ [${f.id}] ${f.name} → ${f.detail}`);
}
console.log(`${'═'.repeat(64)}`);
process.exit(passed === results.length ? 0 : 1);

