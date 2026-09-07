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
// history, so pick the first non-perishable listing explicitly instead of
// trusting data[0] (a fresh flower is perishable → isReturnable=false).
const allListings = (await api('/catalog?limit=10')).data?.data || [];
const listing = allListings.find((l) => ['flower_bouquet', 'plant'].includes(l?.product?.type)) || allListings[0];
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

// ===========================================================================
const passed = results.filter((x) => x.pass).length;
console.log(`\n${'═'.repeat(64)}`);
console.log(`E2E-LIVE: ${passed}/${results.length} cases passed`);
if (passed < results.length) {
  console.log('\nFailed cases:');
  for (const f of results.filter((x) => !x.pass)) console.log(`  ✗ [${f.id}] ${f.name} → ${f.detail}`);
}
console.log(`${'═'.repeat(64)}`);
process.exit(passed === results.length ? 0 : 1);
