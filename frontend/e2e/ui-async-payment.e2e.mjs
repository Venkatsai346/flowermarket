// Storefront UI E2E — the async (pending) payment journey in the real browser.
//
//   1. admin flips the live mock gateway into async (pending) mode
//      (dev-only endpoint, mirrored of Razorpay's async capture)
//   2. customer checks out with UPI → checkout returns paymentPending →
//      the storefront lands on the order page in the "Complete your
//      payment" state with a "Check payment status" action
//   3. a SIGNED gateway webhook (HMAC, same contract as Razorpay)
//      captures the payment
//   4. the order page's 5-second poll flips the order to Confirmed live
//      — no manual refresh
//
// Run: node e2e/ui-async-payment.e2e.mjs   (API :4000, storefront :5174)
import {
  launchBrowser, makePage, shot, Runner, bodyText, waitText, waitGone,
  clickText, typeInto, logOffset, grabOtp, api, adminLogin, uniquePhone,
} from './ui-harness.mjs';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:5174';
const WEBHOOK_SECRET = process.env.MOCK_PAYMENT_WEBHOOK_SECRET || 'mock-webhook-secret-dev';

const R = new Runner('ASYNC-PAYMENT-UI');
const browser = await launchBrowser();
const page = await makePage(browser, 'asyncpay');
R.setPage(page);
const phone = uniquePhone('95');

let gatewayOrderId = null;
let amountPaise = null;

// ---------------------------------------------------------------- toggle
const adminTok = await adminLogin();
await R.check('P01', 'Dev toggle: mock gateway → async (pending) mode', async () => {
  const r = await api('POST', '/fulfillment/payments/mock/force-pending', { enabled: true }, { token: adminTok });
  if (r.mockPending !== true) throw new Error(JSON.stringify(r));
  return 'pending mode on';
});

// ---------------------------------------------------------------- sign in
await R.check('P02', 'Sign in with phone OTP (new customer)', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await waitText(page, /Flower Market/, 20000);
  await page.click('button[aria-label="Sign in"]', { timeout: 8000 });
  await waitText(page, /Send code/, 8000);
  await typeInto(page, 'input[placeholder="98765 43210"]', phone);
  const off = logOffset();
  await clickText(page, 'Send code', { exact: true });
  await new Promise((r) => setTimeout(r, 900));
  const code = grabOtp(off, { expectPhone: phone });
  if (!code) throw new Error('OTP not found');
  await typeInto(page, 'input[placeholder="••••••"]', code, { clear: true });
  await clickText(page, 'Verify & continue', { exact: true });
  await waitGone(page, /Enter the code/, 10000);
  return `signed in ${phone}`;
});

// ---------------------------------------------------------------- basket
await R.check('P03', 'Add a product to the basket from the PDP', async () => {
  const handle = await page.$('button[aria-label^="View "]');
  await handle.click();
  await waitText(page, /Add to basket|Out of stock/, 10000);
  await clickText(page, /Add to basket/, { timeout: 6000 });
  await new Promise((r) => setTimeout(r, 1500));
  const badge = await page.$eval('button[aria-label^="Cart,"]', (e) => e.getAttribute('aria-label'));
  if (!/Cart, 1 item$/.test(badge)) throw new Error(`badge: ${badge}`);
  return badge;
});
await shot(page, 'p03-basket');

// ---------------------------------------------------------------- checkout → pending
await R.check('P04', 'Checkout lands in the awaiting-payment state (no auto-confirm)', async () => {
  await page.goto(BASE + '/checkout', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Add a new address/i, 15000);
  await clickText(page, /Add a new address/i);
  await typeInto(page, 'input[placeholder="Full name"]', 'Async Payer');
  await typeInto(page, 'input[placeholder="Phone"]', phone);
  await typeInto(page, 'input[placeholder="Flat / house / street"]', '3 Pending Road');
  await typeInto(page, 'input[placeholder="City"]', 'Kakinada');
  await typeInto(page, 'input[placeholder="State"]', 'Andhra Pradesh');
  await typeInto(page, 'input[placeholder="Pincode"]', '533001');
  await clickText(page, 'Save address', { exact: true });
  await waitText(page, /3 Pending Road/, 10000);
  const slot = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const s = btns.find((b) => /Express|Standard/.test(b.innerText || '') && !/Full/.test(b.innerText || '') && !b.disabled);
    if (s) { s.scrollIntoView({ block: 'center' }); s.click(); return (s.innerText || '').replace(/\s+/g, ' ').trim(); }
    return null;
  });
  if (!slot) throw new Error('no slot button');
  await new Promise((r) => setTimeout(r, 1200));
  await clickText(page, /^UPI$/i, { timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  const coPromise = page.waitForResponse(
    (res) => res.url().includes('/cart/checkout') && res.request().method() === 'POST', 30000);
  await clickText(page, 'Place order', { exact: true });
  const coRes = await coPromise;
  const co = await coRes.json();
  const d = co?.data ?? co;
  if (d.paymentPending !== true) throw new Error('expected paymentPending, got ' + JSON.stringify(co).slice(0, 240));
  gatewayOrderId = d.gatewayOrderId;
  amountPaise = Math.round(Number(d.order?.totalAmount ?? 0) * 100);
  if (!gatewayOrderId) throw new Error('no gatewayOrderId in response');

  // the storefront must land on the order page in the pending state
  await waitText(page, /Complete your payment/i, 20000);
  await waitText(page, /Check payment status/i, 8000);
  const t = await bodyText(page);
  if (!/awaiting payment/i.test(t)) throw new Error('no "Awaiting payment" status shown');
  return `pending order (gateway ${gatewayOrderId}, ₹${(amountPaise / 100).toFixed(2)})`;
});
await shot(page, 'p04-pending');

// ---------------------------------------------------------------- webhook capture
await R.check('P05', 'Signed gateway webhook captures the payment', async () => {
  const body = JSON.stringify({
    eventId: `evt_ui_${Date.now()}`,
    gatewayOrderId,
    gatewayPaymentId: `mpay_ui_${Date.now().toString(36)}`,
    amountPaise,
  });
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex');
  const wh = await fetch('http://127.0.0.1:4000/api/v1/payments/webhook/mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mock-signature': sig },
    body,
  });
  if (wh.status !== 200) throw new Error(`webhook rejected: ${wh.status}`);
  return `event evt_ui accepted (HMAC verified)`;
});

// ---------------------------------------------------------------- live flip
await R.check('P06', 'Polling flips the page from Awaiting payment → Confirmed (no refresh)', async () => {
  const url0 = page.url();
  // the page polls GET /orders/:id/payment every 5s while pending;
  // within ~15s the banner must vanish and the status read Confirmed
  await waitGone(page, /Complete your payment/i, 30000);
  await waitText(page, /Confirmed|Processing|Placed/i, 15000);
  const t = await bodyText(page);
  if (!/confirmed|processing/i.test(t)) throw new Error(`no confirmed status: ${t.replace(/\s+/g, ' ').slice(0, 200)}`);
  const t2 = await bodyText(page);
  if (/Check payment status/.test(t2)) throw new Error('pending banner still visible');
  return `order page flipped live on ${new URL(url0).pathname}`;
});
await shot(page, 'p06-confirmed');

// ---------------------------------------------------------------- restore
await R.check('P07', 'Dev toggle: back to sync mode', async () => {
  const r = await api('POST', '/fulfillment/payments/mock/force-pending', { enabled: false }, { token: adminTok });
  if (r.mockPending !== false) throw new Error(JSON.stringify(r));
  return 'sync mode restored';
});

const s = await R.printSummary();
await browser.close();
process.exit(s.pass === s.total ? 0 : 1);
