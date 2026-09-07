// Storefront UI E2E — the complete customer journey through the real browser.
// Wave 4: floral hero still contains store identity; PDP `/p/:slug`, `/search?q=`, guest cart.
// Journey: browse/filter/search URL/PDP → guest add → OTP (cart preserved)
// → checkout (address/slot/UPI) → order detail → cancel → 2nd order →
// delivered (fulfillment API) → return → returns list → wallet → audit.
import {
  launchBrowser, makePage, shot, Runner, bodyText, waitText, waitGone,
  clickText, typeInto, hasSelector, countSel, logOffset, grabOtp,
  api, adminLogin, uniquePhone,
} from './ui-harness.mjs';

const BASE = 'http://127.0.0.1:5174';
const R = new Runner('STOREFRONT-UI');
const browser = await launchBrowser();
const page = await makePage(browser, 'storefront');
R.setPage(page);

const customerPhone = uniquePhone('97');
let order1 = null;
let order2 = null;

// ---------------------------------------------------------------- home
await R.check('S01', 'Home: hero + store identity', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await waitText(page, /Fresh from Flower Market|Flower Market/, 20000);
  const t = await bodyText(page);
  if (!/Flower Market/.test(t)) throw new Error('store name missing');
  return 'hero rendered';
});
await shot(page, 's01-home');

await R.check('S02', 'Home: 5 seeded products in grid', async () => {
  await waitText(page, /5 products?/, 15000);
  const n = await countSel(page, 'a[aria-label^="View "]');
  if (n < 5) throw new Error(`expected 5 product cards, saw ${n}`);
  return `${n} product cards`;
});

await R.check('S03', 'Home: category chip filters grid', async () => {
  const before = await countSel(page, 'a[aria-label^="View "]');
  await clickText(page, 'Bouquets', { exact: true });
  await new Promise((r) => setTimeout(r, 900));
  const after = await countSel(page, 'a[aria-label^="View "]');
  if (after >= before || after < 1) throw new Error(`chip filter: ${before} -> ${after}`);
  await clickText(page, 'All', { exact: true });
  await new Promise((r) => setTimeout(r, 900));
  const back = await countSel(page, 'a[aria-label^="View "]');
  if (back < 5) throw new Error(`back to All: ${back}`);
  return `${before} -> ${after} -> ${back}`;
});

await R.check('S04', 'Search URL: /search?q=rose is shareable', async () => {
  const inp = await page.$('input[placeholder="Search flowers, plants, gifts…"]');
  await inp.click();
  await inp.type('rose', { delay: 40 });
  await new Promise((r) => setTimeout(r, 600));
  await inp.press('Enter');
  await waitText(page, /for “rose”/, 15000);
  const url = page.url();
  if (!/\/search\?q=rose/i.test(url)) throw new Error(`expected /search?q=rose, got ${url}`);
  const n = await countSel(page, 'a[aria-label^="View "]');
  if (n < 1) throw new Error('search returned no products');
  await page.click('button[aria-label="Clear search"]', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 1200));
  return `${n} result(s) at ${url.replace(/^https?:\/\/[^/]+/, '')}`;
});

await R.check('S05', 'Home: sort control + in-stock chip render', async () => {
  if (!(await hasSelector(page, 'select[aria-label="Sort products"]'))) throw new Error('sort select missing');
  const t = await bodyText(page);
  if (!/In stock/.test(t)) throw new Error('in-stock chip missing');
  return 'controls present';
});

let firstTitle = null;
await R.check('S06', 'PDP /p/:slug: gallery, care, JSON-LD, guest add', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /products?/, 15000);
  const handle = await page.$('a[aria-label^="View "]');
  firstTitle = await handle.evaluate((el) => el.getAttribute('aria-label').replace('View ', ''));
  await handle.click();
  await waitText(page, /Add to basket|Out of stock/, 15000);
  const url = page.url();
  if (!/\/p\//.test(url)) throw new Error(`expected /p/:slug, got ${url}`);
  const t = await bodyText(page);
  if (!/₹\s?[\d,]+/.test(t)) throw new Error('no price on PDP');
  if (!/Vase life|Care|Slot delivery/i.test(t)) throw new Error('no care / vase-life / slot meta');
  const ld = await page.$eval('script[type="application/ld+json"]', (el) => el.textContent).catch(() => null);
  if (!ld || !/Product/.test(ld)) throw new Error('JSON-LD Product missing');
  await clickText(page, /Add to basket/, { timeout: 6000 });
  await new Promise((r) => setTimeout(r, 1500));
  const badge = await page.$eval('button[aria-label^="Cart,"]', (e) => e.getAttribute('aria-label'));
  if (!/Cart, 1 item$/.test(badge)) throw new Error(`guest add badge: ${badge}`);
  return `“${firstTitle}” ${url.replace(/^https?:\/\/[^/]+/, '')} ${badge}`;
});
await shot(page, 's06-pdp');

// Sheets have no Escape key handling; the backdrop's center sits under the
// panel, so dispatch a DOM click on the backdrop element directly.
async function closeSheets() {
  for (let i = 0; i < 3; i++) {
    if (!(await page.$('div[role="dialog"]'))) return;
    await page.evaluate(() =>
      document.querySelector('div[role="dialog"] button[aria-label="Close"]')?.click());
    await new Promise((r) => setTimeout(r, 700));
  }
}

// ---------------------------------------------------------------- auth (OTP)
await R.check('S07', 'Auth: sign-in sheet opens with phone step', async () => {
  await closeSheets();
  await page.click('button[aria-label="Sign in"]', { timeout: 8000 });
  await waitText(page, /Sign in to continue/, 8000);
  const t = await bodyText(page);
  if (!/Send code/.test(t)) throw new Error('phone step not shown');
  return 'sheet open';
});

await R.check('S08', 'Auth: OTP request + verify (dev code from API echo)', async () => {
  await typeInto(page, 'input[placeholder="98765 43210"]', customerPhone);
  // capture the OTP request response for the dev echo
  const off = logOffset();
  const otpPromise = page.waitForResponse(
    (res) => res.url().includes('/auth/otp/request'), 15000).catch(() => null);
  await clickText(page, 'Send code', { exact: true });
  const otpRes = await otpPromise;
  await waitText(page, /Enter the code/, 10000);
  let code = null;
  if (otpRes) {
    try { code = (await otpRes.json())?.data?.devCode || null; } catch {}
  }
  if (!code) code = grabOtp(off, { expectPhone: customerPhone });
  if (!code) throw new Error('OTP not found (devCode + log)');
  const devHint = await waitText(page, /Development mode — your code is/i, 6000).then(() => true).catch(() => false);
  await typeInto(page, 'input[placeholder="••••••"]', code, { clear: true });
  await clickText(page, 'Verify & continue', { exact: true });
  await waitGone(page, /Enter the code/, 10000);
  await waitText(page, /Signed in/i, 8000).catch(() => {});
  return `OTP ${code}${devHint ? ' (dev hint shown)' : ''}`;
});

await R.check('S09', 'Auth: signed-in account menu appears in header', async () => {
  const ok = await hasSelector(page, 'button[aria-label^="Account menu for"]', 10000);
  if (!ok) throw new Error('account menu not present');
  const label = await page.$eval('button[aria-label^="Account menu for"]', (e) => e.getAttribute('aria-label'));
  if (!label.includes(customerPhone)) throw new Error(`account menu for ${label}`);
  return label;
});

// ---------------------------------------------------------------- cart (post-auth)
await R.check('S10', 'Cart: guest basket survived OTP (merge-on-login)', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /products?/, 15000);
  const badge = await page.$eval('button[aria-label^="Cart,"]', (e) => e.getAttribute('aria-label'));
  if (!/Cart, 1 item$/.test(badge)) throw new Error(`merged cart badge: ${badge}`);
  return badge;
});

await R.check('S11', 'Cart: sheet shows line with price', async () => {
  await page.click('button[aria-label^="Cart,"]', { timeout: 8000 });
  await waitText(page, /Checkout ·/, 8000);
  const t = await bodyText(page);
  if (!/₹\s?[\d,]+/.test(t)) throw new Error('no price visible in cart');
  return 'cart sheet open';
});
await shot(page, 's11-cart');

await R.check('S12', 'Cart: increase quantity updates subtotal', async () => {
  const foot = async () => page.evaluate(() => {
    const f = Array.from(document.querySelectorAll('footer')).pop();
    return f ? f.innerText.replace(/\s+/g, ' ') : null;
  });
  const money = (s) => Number(((s.match(/₹\s?([\d,]+)/) || [])[1] || '0').replace(/,/g, ''));
  const before = await foot();
  // the cart sheet's own stepper (product cards also render steppers)
  const clicked = await page.evaluate(() => {
    const cart = Array.from(document.querySelectorAll('div[role="dialog"]'))
      .find((d) => /Your basket/i.test(d.getAttribute('aria-label') || ''));
    const btn = cart?.querySelector('button[aria-label="Increase quantity"]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!clicked) throw new Error('cart stepper not found');
  let after = before;
  for (let i = 0; i < 20 && (after = await foot().catch(() => before)) === before; i++) {
    await new Promise((r) => setTimeout(r, 400));
  }
  if (money(after) <= money(before)) throw new Error(`${before} -> ${after}`);
  return `${before} → ${after}`;
});

// ---------------------------------------------------------------- checkout
await R.check('S13', 'Checkout: reachable with items, address step first', async () => {
  await page.goto(BASE + '/checkout', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Choose an address|Delivery slot/i, 15000);
  const t = await bodyText(page);
  if (!/address/i.test(t)) throw new Error('no address step');
  return 'checkout page';
});

await R.check('S14', 'Checkout: add a new address via form', async () => {
  await clickText(page, /Add a new address/i);
  await typeInto(page, 'input[placeholder="Full name"]', 'E2E Customer');
  await typeInto(page, 'input[placeholder="Phone"]', customerPhone);
  await typeInto(page, 'input[placeholder="Flat / house / street"]', '12 Lotus Lane');
  await typeInto(page, 'input[placeholder="City"]', 'Hyderabad');
  await typeInto(page, 'input[placeholder="State"]', 'Telangana');
  await typeInto(page, 'input[placeholder="Pincode"]', '500001');
  await clickText(page, 'Save address', { exact: true });
  await waitText(page, /12 Lotus Lane/, 10000);
  return 'address saved';
});

const pickSlot = () => page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const slot = btns.find((b) => {
    const t = (b.innerText || '');
    return /Express|Standard/.test(t) && !/Full/.test(t) && !b.disabled;
  });
  if (slot) { slot.scrollIntoView({ block: 'center' }); slot.click(); return (slot.innerText || '').replace(/\s+/g, ' ').trim(); }
  return null;
});

await R.check('S15', 'Checkout: pick a delivery slot (10-min hold)', async () => {
  const clicked = await pickSlot();
  if (!clicked) throw new Error('no slot button found');
  await waitText(page, /Slot held|10 minutes/i, 10000).catch(() => {});
  return `slot “${clicked}” held`;
});

await R.check('S16', 'Checkout: payment method + confirmed total', async () => {
  const t = await bodyText(page);
  if (!/UPI/.test(t) && !/Cash on delivery/i.test(t)) throw new Error('payment methods not rendered');
  await clickText(page, /^UPI$/i, { timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const t2 = await bodyText(page);
  const total = t2.match(/Total\s*₹\s?([\d,]+)/);
  if (!total) throw new Error('no total shown after slot+payment');
  return `total ₹${total[1]}`;
});

await R.check('S17', 'Checkout: place order -> success with order number', async () => {
  await clickText(page, 'Place order', { exact: true });
  await waitText(page, /FM-\d{6}-\d{4,}/, 25000);
  const t = await bodyText(page);
  const m = t.match(/FM-\d{6}-\d{4,}/);
  if (!m) throw new Error('no order number on success screen');
  order1 = m[0];
  return order1;
});
await shot(page, 's17-order-placed');

// ---------------------------------------------------------------- orders
await R.check('S18', 'Orders: new order listed with status', async () => {
  await page.goto(BASE + '/orders', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, new RegExp(order1), 15000);
  const t = await bodyText(page);
  if (!/confirmed|placed|pending|processing/i.test(t)) throw new Error('no status shown');
  return `${order1} listed`;
});

await R.check('S19', 'Order detail: items, price, progress rail', async () => {
  await page.evaluate((no) => {
    const el = Array.from(document.querySelectorAll('a')).find((e) => (e.innerText || '').includes(no));
    if (el) el.click();
  }, order1);
  await waitText(page, /Order placed|Confirmed|Timeline|Placed/i, 12000);
  const t = await bodyText(page);
  if (!/₹/.test(t)) throw new Error('no prices on detail');
  return 'detail rendered';
});
await shot(page, 's19-order-detail');

await R.check('S20', 'Order detail: cancel flow with reason', async () => {
  await clickText(page, 'Cancel order', { exact: true });
  await waitText(page, /Why are you cancelling/i, 6000);
  const sel = await page.$('select[aria-label="Cancellation reason"]');
  if (sel) {
    const opts = await sel.evaluate((s) => Array.from(s.options).map((o) => o.value));
    const pickable = opts.find((o) => o && o !== 'other');
    if (pickable) await sel.select(pickable);
  }
  await clickText(page, 'Cancel this order', { exact: true });
  await waitText(page, /cancelled|canceled/i, 15000);
  const t = await bodyText(page);
  if (!/cancelled|canceled/i.test(t)) throw new Error('status not cancelled');
  return 'order cancelled';
});
await shot(page, 's20-cancelled');

// ---------------------------------------------------------------- second order -> delivered -> return
await R.check('S21', 'Second order placed (reusing saved address)', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /products?/, 15000);
  const h = await page.$('button[aria-label^="View "]');
  await h.click();
  await waitText(page, /Add to basket|Out of stock/, 10000);
  await clickText(page, /Add to basket/, { timeout: 6000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(BASE + '/checkout', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /12 Lotus Lane|Choose an address/i, 15000);
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button, [role=radio], label')).find((e) =>
      (e.innerText || '').includes('12 Lotus Lane'));
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const clicked = await pickSlot();
  if (!clicked) throw new Error('no slot for order 2');
  await waitText(page, /Total\s*₹/i, 10000);
  await clickText(page, /^UPI$/i, { timeout: 4000 }).catch(() => {});
  await clickText(page, 'Place order', { exact: true });
  await waitText(page, /FM-\d{6}-\d{4,}/, 25000);
  const t = await bodyText(page);
  const m = t.match(/FM-\d{6}-\d{4,}/);
  order2 = m[0];
  return order2;
});

await R.check('S22', 'Order 2 delivered via fulfillment (store+rider API)', async () => {
  const adminTok = await adminLogin();
  const orders = await api('GET', `/admin/orders?limit=50`, undefined, { token: adminTok });
  const list = Array.isArray(orders) ? orders : orders.items || orders.rows || [];
  const o = list.find((x) => (x.orderNumber || x.number) === order2);
  if (!o) throw new Error(`order2 not found in admin list`);
  const oid = o.id || o._id;
  await api('POST', `/fulfillment/orders/${oid}/pick`, {}, { token: adminTok });
  await api('POST', `/fulfillment/orders/${oid}/pack`, {}, { token: adminTok });
  await api('POST', `/fulfillment/orders/${oid}/dispatch`, {}, { token: adminTok });
  const RIDER_PHONE = '9000000009';
  const off = logOffset();
  await api('POST', '/auth/otp/request', { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: RIDER_PHONE } });
  const riderCode = grabOtp(off, { expectPhone: RIDER_PHONE });
  if (!riderCode) throw new Error('rider OTP not found');
  const rv = await api('POST', '/auth/otp/verify', { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: RIDER_PHONE }, code: riderCode });
  const riderTok = rv.accessToken || rv.tokens?.accessToken;
  if (!riderTok) throw new Error('no rider token');
  const dl = await api('GET', '/rider/deliveries', undefined, { token: riderTok });
  const dlist = dl?.deliveries || (Array.isArray(dl) ? dl : []);
  const delivery = dlist.find((d) => String(d.orderId) === String(oid)) || dlist[0];
  const deliveryId = delivery?.id || delivery?._id;
  if (!deliveryId) throw new Error('no delivery for rider');
  await api('POST', `/rider/deliveries/${deliveryId}/accept`, {}, { token: riderTok });
  await api('POST', `/rider/deliveries/${deliveryId}/arrive-hub`, {}, { token: riderTok });
  await api('POST', `/rider/deliveries/${deliveryId}/depart`, { package_verified: true }, { token: riderTok });
  await api('POST', `/rider/deliveries/${deliveryId}/arrive`, {}, { token: riderTok });
  await api('POST', `/rider/deliveries/${deliveryId}/complete`, { pod_type: 'otp', pod_reference: '4321' }, { token: riderTok });
  const detail = await api('GET', `/admin/orders/${oid}`, undefined, { token: adminTok });
  const od = detail.order || detail;
  if (od.status !== 'delivered') throw new Error(`status is ${od.status}`);
  return `${order2} delivered via full rider flow`;
});

await R.check('S23', 'Order 2 UI: shows delivered + return CTA', async () => {
  await page.goto(BASE + `/orders`, { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, new RegExp(order2), 15000);
  await page.evaluate((no) => {
    const el = Array.from(document.querySelectorAll('a')).find((e) => (e.innerText || '').includes(no));
    if (el) el.click();
  }, order2);
  await waitText(page, /delivered/i, 10000);
  await waitText(page, /Request a return/i, 8000);
  return 'delivered + return CTA';
});

await R.check('S24', 'Return: request sheet -> submit (qty + reason)', async () => {
  await clickText(page, /Request a return/i);
  await waitText(page, /Return type/i, 8000);
  const bumped = await page.evaluate(() => {
    const dlg = Array.from(document.querySelectorAll('div[role="dialog"]')).pop();
    const btn = dlg?.querySelector('button[aria-label="Increase quantity"]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!bumped) throw new Error('return qty stepper not found');
  await new Promise((r) => setTimeout(r, 500));
  const note = await page.$('textarea[placeholder="Anything else we should know? (optional)"]');
  if (note) await note.type('E2E return: item arrived damaged');
  await clickText(page, /Request pickup|Submit instant claim/i);
  await waitText(page, /requested|submitted|pickup/i, 15000);
  return 'return submitted';
});
await shot(page, 's24-return');

await R.check('S25', 'Returns page lists the return', async () => {
  await page.goto(BASE + '/returns', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /E2E return|damaged|pending|requested|Return/i, 15000);
  const t = await bodyText(page);
  if (!/E2E return|damaged/i.test(t) && !/pending|requested/i.test(t)) throw new Error('return not listed');
  return 'return listed';
});

// ---------------------------------------------------------------- wallet
await R.check('S26', 'Wallet page: balance + transactions render', async () => {
  await page.goto(BASE + '/wallet', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Wallet|Balance|₹/i, 15000);
  const t = await bodyText(page);
  if (!/₹/.test(t)) throw new Error('no balance shown');
  return 'wallet rendered';
});
await shot(page, 's26-wallet');

// ---------------------------------------------------------------- address book
await R.check('S28', 'Address book: add → edit → delete round-trip', async () => {
  page.once('dialog', (d) => d.accept()); // window.confirm on delete
  await page.goto(BASE + '/addresses', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Addresses/i, 15000);
  await clickText(page, /Add address/i);
  await typeInto(page, 'input[placeholder="Full name"]', 'S28 Saver');
  await typeInto(page, 'input[placeholder="Phone"]', '9811122233');
  await typeInto(page, 'input[placeholder="Flat / house / street"]', '78 Test Villa');
  await typeInto(page, 'input[placeholder="City"]', 'Kakinada');
  await typeInto(page, 'input[placeholder="State"]', 'Andhra Pradesh');
  await typeInto(page, 'input[placeholder="Pincode"]', '533001');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Save address');
    if (!b) throw new Error('Save address button missing');
    b.click();
  });
  await waitText(page, /S28 Saver/i, 15000);
  // edit: change the street line
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('S28 Saver'));
    const edit = card?.querySelector('button[title="Edit"]');
    if (!edit) throw new Error('Edit button missing');
    edit.click();
  });
  await waitText(page, /Edit/i, 10000);
  await typeInto(page, 'input[placeholder="Flat / house / street"]', '79 Edited Villa');
  await clickText(page, /Save address/i);
  await waitText(page, /79 Edited Villa/i, 15000);
  // delete (confirm auto-accepted)
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('S28 Saver'));
    const del = card?.querySelector('button[title="Delete"]');
    if (!del) throw new Error('Delete button missing');
    del.click();
  });
  await waitGone(page, /S28 Saver/i, 15000);
  return 'add → edit → delete, book left clean';
});
await shot(page, 's28-addresses');

// ---------------------------------------------------------------- wallet top-up
await R.check('S29', 'Wallet: top-up credits the balance (live)', async () => {
  const raw = await page.evaluate(() => localStorage.getItem('fm-shop:127.0.0.1'));
  const st = JSON.parse(raw || '{}');
  const tok = st.state?.accessToken || st.accessToken;
  if (!tok) throw new Error('no customer token in localStorage');
  const bal0 = await api('GET', '/wallet', undefined, { token: tok, tenant: null });
  const before = bal0.balance ?? bal0.available ?? Number(bal0);
  await page.goto(BASE + '/wallet', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /₹/i, 15000);
  await clickText(page, /Add money/i);
  await typeInto(page, 'input[placeholder^="Amount"]', '500');
  await clickText(page, /Add to wallet/i);
  // poll the balance (the source of truth) until the top-up lands
  const deadline = Date.now() + 20000;
  let after = before;
  while (Date.now() < deadline) {
    const b = await api('GET', '/wallet', undefined, { token: tok, tenant: null });
    after = b.balance ?? b.available ?? Number(b);
    if (after >= before + 500) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (Math.abs(after - (before + 500)) > 0.01) throw new Error(`balance ₹${before} → ₹${after} (expected +500)`);
  return `balance ₹${before} → ₹${after}`;
});
await shot(page, 's29-wallet-topup');

// ---------------------------------------------------------------- audit
await R.check('S27', 'No page errors / failed API requests', async () => {
  const iss = page._issues;
  if (iss.pageerrors.length) throw new Error(`pageerrors: ${iss.pageerrors[0]}`);
  const hardNet = iss.netfail.filter((f) => !/favicon/.test(f));
  if (hardNet.length) throw new Error(`netfail: ${hardNet[0]}`);
  return `console-err=${iss.console.length} pageerr=${iss.pageerrors.length} netfail=${hardNet.length}`;
});

const s = await R.printSummary();
for (const n of R.notes) console.log('NOTE:', n);
await browser.close();
process.exit(s.pass === s.total ? 0 : 1);
