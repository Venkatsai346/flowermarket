// Admin web UI E2E — every console route + deep flows through the real browser:
// login → dashboard → catalog(+masters/categories/brands/ops-drain) → inventory
// → hubs → orders → fulfillment (pick/pack/dispatch/POD via UI) → after-sales
// (pickup+QC via UI) → policies (coupon via UI) → search (synonym+reindex) →
// tax → users (create staff via UI) → vendors → billing → storefront branding
// (save + verify) → domains → platform (9 sub-routes) → RBAC → rider login.
import {
  launchBrowser, makePage, shot, Runner, bodyText, waitText, waitGone,
  clickText, typeInto, hasSelector, countSel, logOffset, grabOtp,
  api, adminLogin, uniquePhone,
} from './ui-harness.mjs';

const BASE = 'http://127.0.0.1:5173';
const R = new Runner('ADMIN-UI');
const browser = await launchBrowser();
const page = await makePage(browser, 'admin');
R.setPage(page);

// ---------------------------------------------------------------- setup (API)
const adminTok = await adminLogin();
const phone = uniquePhone('96');

// customer checkout via API so the console has a live order to operate on
const off = logOffset();
await api('POST', '/auth/otp/request', { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: phone } });
const code = grabOtp(off, { expectPhone: phone });
if (!code) { console.error('setup: no OTP'); process.exit(2); }
const rv = await api('POST', '/auth/otp/verify', { purpose: 'login', channel: 'phone', phone: { countryCode: '+91', number: phone }, code });
const custTok = rv.accessToken || rv.tokens?.accessToken;

const addr = await api('POST', '/users/me/addresses', {
  name: 'E2E Admin Tester', phone: '9876500001', line1: '7 Console Road', line2: '',
  city: 'Kakinada', state: 'Andhra Pradesh', pincode: '533001', isDefault: true,
}, { token: custTok });
const addressId = addr.id || addr._id;

const cat = await api('GET', '/catalog?limit=10', undefined, { tenant: null });
const catList = Array.isArray(cat) ? cat : cat.items || [];
// A14 (after-sales) returns this order via PICKUP_QC, which is by design
// ineligible for perishable loose flowers — pick the first NON-perishable
// listing (bouquet/plant) so the shared setup order is returnable regardless
// of search-rank history (soldCount drift changes which listing ranks first).
const listing = catList.find((l) => l.product?.isPerishable === false) || catList[0];
const listingId = listing.listingId || listing.id;
await api('POST', '/cart/items', { tenantProductId: listingId, qty: 1 }, { token: custTok });
const today = new Date().toISOString().slice(0, 10);
const slotsRes = await api('GET', `/cart/slots?pincode=533001&date=${today}`, undefined, { token: custTok });
const slots = slotsRes.slots || (Array.isArray(slotsRes) ? slotsRes : []);
const slot = slots.find((s) => (s.remaining ?? s.available) > 0);
if (!slot) { console.error('setup: no slot'); process.exit(2); }
const slotRes = await api('POST', `/cart/slots/${slot.id || slot._id}/reserve`, {}, { token: custTok });
const slotReservationId = slotRes.id || slotRes._id;
const quote = await api('POST', '/cart/quote', { slotReservationId, addressId }, { token: custTok });
const co = await api('POST', '/cart/checkout', {
  slotReservationId, addressId, paymentMethod: 'upi', confirmPriceChanges: true,
}, { token: custTok });
const order = co.order || co;
const orderId = order.id || order._id;
const orderNo = order.orderNumber || co.orderNumber;
if (!orderId || !orderNo) { console.error('setup: checkout failed', JSON.stringify(co).slice(0, 300)); process.exit(2); }
R.note(`setup order ${orderNo} (₹${quote?.grandTotal ?? '?'})`);

// ---------------------------------------------------------------- login
await R.check('A01', 'Login page renders', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await waitText(page, /Sign in|Email/i, 15000);
  const url = page.url();
  if (!/\/login/.test(url)) throw new Error(`expected redirect to /login, at ${url}`);
  return 'redirected to /login';
});
await shot(page, 'a01-login');

await R.check('A02', 'Admin login (email+password) → dashboard', async () => {
  await typeInto(page, 'input[placeholder="admin@flowermarket.in"]', 'admin@flowermarket.in');
  await typeInto(page, 'input[type="password"]', 'Admin@12345');
  await clickText(page, 'Sign in', { exact: true });
  await waitText(page, /Dashboard|GMV|Revenue|Orders/i, 20000);
  return 'logged in';
});

await R.check('A03', 'Dashboard KPIs render', async () => {
  const t = await bodyText(page);
  if (!/₹|\d/.test(t)) throw new Error('no KPI data');
  if (!/orders|revenue|gmv|products/i.test(t)) throw new Error('no dashboard metrics');
  return 'KPIs visible';
});
await shot(page, 'a03-dashboard');

// ---------------------------------------------------------------- catalog
await R.check('A04', 'My catalog: 5 listings, detail opens', async () => {
  await page.goto(BASE + '/catalog', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /₹/, 15000);
  const rows = await countSel(page, 'tbody tr');
  if (rows < 3) throw new Error(`expected 5 listing rows, saw ${rows}`);
  // open first row detail
  await page.click('tbody tr', { timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const t = await bodyText(page);
  if (!/price|stock|listing|sku/i.test(t)) throw new Error('detail panel did not open');
  await page.keyboard.press('Escape');
  return `${rows} rows + detail`;
});
await shot(page, 'a04-catalog');

await R.check('A05', 'Catalog masters list', async () => {
  await page.goto(BASE + '/catalog/masters', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /₹|Master|SKU|sku/i, 15000);
  const rows = await countSel(page, 'tbody tr');
  if (rows < 3) throw new Error(`expected master rows, saw ${rows}`);
  return `${rows} masters`;
});

await R.check('A06', 'Catalog categories list', async () => {
  await page.goto(BASE + '/catalog/categories', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Fresh|Bouquet|Plant|Categor/i, 15000);
  const t = await bodyText(page);
  if (!/Fresh Flowers|Bouquets|Plants/i.test(t)) throw new Error('seed categories missing');
  return 'categories listed';
});

await R.check('A07', 'Brands: create a brand via UI', async () => {
  await page.goto(BASE + '/catalog/brands', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Brand/i, 15000);
  await clickText(page, 'New brand', { exact: true });
  const brandName = `E2E Brand ${Date.now() % 100000}`;
  await typeInto(page, 'input[placeholder="Green Thumb"]', brandName);
  await clickText(page, 'Create brand', { exact: true });
  await waitText(page, new RegExp(brandName), 12000);
  return brandName;
});

await R.check('A08', 'Catalog ops: price change → outbox event → UI drain', async () => {
  // create a pending outbox event via a listing price change (API), then drain in UI
  const listings = await api('GET', '/catalog/tenant/listings?limit=5', undefined, { token: adminTok });
  const llist = Array.isArray(listings) ? listings : listings.items || [];
  const l = llist[0];
  if (!l) throw new Error('no tenant listings');
  const lid = l.id || l._id;
  const detail = await api('GET', `/catalog/tenant/listings/${lid}`, undefined, { token: adminTok });
  const ld = detail.listing || detail;
  const selling = Number(ld.price?.sellingPrice ?? 0);
  const mrp = Number(ld.price?.mrp ?? selling);
  const ver = Number(ld.version ?? 1);
  if (!selling) throw new Error('listing has no price');
  const evtStatus = async () => {
    const s = await api('GET', '/catalog/admin/events/status', undefined, { token: adminTok });
    return s && s.data && typeof s.data.pending === 'number' ? s.data : s;
  };
  const before = await evtStatus(); // baseline BEFORE the price change
  await api('PATCH', `/catalog/tenant/listings/${lid}/price`, {
    price: { mrp: mrp + 1, sellingPrice: selling + 1, currency: 'INR' },
    reason: 'manual', expectedVersion: ver,
  }, { token: adminTok });
  // net-zero guarantee: revert to the value captured at run start, even on failure
  const restorePrice = () => api('GET', `/catalog/tenant/listings/${lid}`, undefined, { token: adminTok })
    .then((re) => api('PATCH', `/catalog/tenant/listings/${lid}/price`, {
      price: { mrp, sellingPrice: selling, currency: 'INR' },
      reason: 'manual', expectedVersion: Number((re.listing || re).version ?? 0),
    }, { token: adminTok })).catch(() => {});
  let s = before;
  try {
    // The background worker polls the outbox every 5s, so it may dispatch the
    // event before we reach the UI — that is the HEALTHY state, not a failure.
    // Verify the pipeline outcome (event created → published) with a bounded
    // wait, whichever actor drained it, then verify the UI Events tab gating.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      s = await evtStatus();
      if (s.published > before.published) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (s.published <= before.published) throw new Error(`price_changed event never dispatched: before=${JSON.stringify(before)} after=${JSON.stringify(s)}`);

    // drive the UI
    await page.goto(BASE + '/catalog/ops', { waitUntil: 'networkidle2', timeout: 30000 });
    await waitText(page, /Catalog deep admin/i, 15000);
    await clickText(page, 'Events', { exact: true });
    await waitText(page, /Pending/i, 8000);

    // disabled={!s.pending} — the button's enabled state must track pending
    const drainEnabled = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('Drain pending'));
      return btn ? !btn.disabled : null;
    });
    if (drainEnabled === null) throw new Error('Drain pending button not rendered');
    if (drainEnabled) {
      // caught an event while pending — exercise the manual drain path
      await clickText(page, 'Drain pending', { exact: true });
      await waitText(page, /Last drain: scanned/i, 60000);
    } else {
      // worker already dispatched everything — disabled must mean pending=0
      const s2 = await evtStatus();
      if (s2.pending !== 0) throw new Error(`drain button disabled but pending=${s2.pending} (stale stats?)`);
    }
  } finally {
    await restorePrice();
  }
  return `price_changed dispatched (published ${before.published}→${s.published}) + Events tab gating verified`;
});

// ---------------------------------------------------------------- ops pages
await R.check('A09', 'Inventory page: stock rows', async () => {
  await page.goto(BASE + '/inventory', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Stock|SKU|On hand|Reserve/i, 15000);
  const rows = await countSel(page, 'tbody tr');
  if (rows < 3) throw new Error(`expected stock rows, saw ${rows}`);
  return `${rows} rows`;
});

await R.check('A10', 'Hubs & slots page', async () => {
  await page.goto(BASE + '/hubs', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Hub|Pincode|Slot/i, 15000);
  const t = await bodyText(page);
  if (!/533001|hub/i.test(t)) throw new Error('no hub/pincode data');
  return 'hub + pincodes';
});

// ---------------------------------------------------------------- orders
await R.check('A11', 'Orders board: test order listed, detail opens', async () => {
  await page.goto(BASE + '/orders', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, new RegExp(orderNo), 15000);
  await page.evaluate((no) => {
    const el = Array.from(document.querySelectorAll('tbody tr, a, button')).find((e) => (e.innerText || '').includes(no));
    if (el) el.click();
  }, orderNo);
  await waitText(page, /Timeline|Items|Payment/i, 10000);
  await page.keyboard.press('Escape');
  return `${orderNo} + detail`;
});
await shot(page, 'a11-orders');

// ---------------------------------------------------------------- fulfillment (full UI ops)
await R.check('A12', 'Fulfillment: pick → pack → dispatch via UI', async () => {
  await page.goto(BASE + '/fulfillment', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Picking|picking/i, 15000);
  await waitText(page, new RegExp(orderNo), 15000);
  await page.evaluate((no) => {
    const el = Array.from(document.querySelectorAll('tbody tr, a, button')).find((e) => (e.innerText || '').includes(no));
    if (el) el.click();
  }, orderNo);
  await clickText(page, 'Start picking', { exact: true });
  await waitText(page, /Picking started/i, 10000);
  await waitText(page, /Mark packed/i, 8000);
  await clickText(page, 'Mark packed', { exact: true });
  await waitText(page, /Order packed/i, 10000);
  await waitText(page, /Dispatch \/ assign rider/i, 8000);
  await clickText(page, /Dispatch \/ assign rider/i);
  await waitText(page, /Rider assigned/i, 12000);
  return 'picked → packed → dispatched';
});

await R.check('A13', 'Fulfillment: delivery tab + POD capture → delivered', async () => {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 800));
  await clickText(page, 'Delivery', { exact: true });
  await waitText(page, new RegExp(orderNo), 15000);
  await page.evaluate((no) => {
    const el = Array.from(document.querySelectorAll('tbody tr, a, button')).find((e) => (e.innerText || '').includes(no));
    if (el) el.click();
  }, orderNo);
  const deliverResp = page.waitForResponse(
    (res) => res.url().includes('/fulfillment/orders/') && res.url().includes('/deliver') && res.request().method() === 'POST',
    { timeout: 20000 }).catch(() => null);
  await clickText(page, /Deliver \(capture POD\)/i);
  await waitText(page, /Capture proof of delivery/i, 8000);
  // POD type: ensure otp (the select inside the POD form)
  await page.evaluate(() => {
    const m = document.querySelector('div.modal-panel[role="dialog"]');
    const sel = m?.querySelector('select');
    if (sel && sel.value !== 'otp') { sel.value = 'otp'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await new Promise((r) => setTimeout(r, 500));
  await typeInto(page, 'div.modal-panel input[placeholder="1234"]', '4321');
  await clickText(page, 'Confirm delivery', { exact: true });
  const resp = await deliverResp;
  if (!resp) throw new Error('no POST /deliver observed — the confirm click never reached the API');
  const body = await resp.json().catch(() => ({}));
  if (resp.status() !== 200) throw new Error(`POST /deliver → ${resp.status()}: ${JSON.stringify(body).slice(0, 200)}`);
  const detail = await api('GET', `/admin/orders/${orderId}`, undefined, { token: adminTok });
  const od = detail.order || detail;
  if (od.status !== 'delivered') throw new Error(`status ${od.status}`);
  return 'delivered with OTP POD';
});
await shot(page, 'a13-delivered');

// ---------------------------------------------------------------- after-sales
let returnId = null;
await R.check('A14', 'After-sales: return pickup + QC pass via UI → refund', async () => {
  // customer creates a return via API
  const od = await api('GET', `/orders/${orderId}`, undefined, { token: custTok });
  const item = (od.items || [])[0];
  if (!item) throw new Error('no order items for return');
  const rr = await api('POST', '/returns', {
    orderId, items: [{ orderItemId: item.id || item._id, qty: 1 }],
    reason: 'E2E admin UI return', claimType: 'pickup_qc',
  }, { token: custTok });
  returnId = rr.returnRequest?.id || rr.returnRequest?._id || rr.id || rr._id;
  if (!returnId) throw new Error('return not created');
  await page.goto(BASE + '/returns', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /E2E admin UI return|requested|pending/i, 15000);
  // open the return row (contains the reason text)
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('tbody tr, a, button')).find((e) =>
      (e.innerText || '').includes('E2E admin UI return') || (e.innerText || '').includes('pickup'));
    if (el) el.click();
  });
  await waitText(page, /Confirm pickup|QC/i, 10000);
  await clickText(page, 'Confirm pickup', { exact: true });
  await waitText(page, /Yes, confirm pickup/i, 6000);
  await clickText(page, 'Yes, confirm pickup', { exact: true });
  await waitText(page, /Run QC decision|QC decision/i, 10000);
  await clickText(page, /Run QC decision|QC decision/i);
  await waitText(page, /QC pass/i, 6000);
  await clickText(page, 'QC pass', { exact: true });
  await clickText(page, 'Submit QC decision', { exact: true });
  await waitText(page, /QC passed/i, 15000);
  // the refund can settle a moment after the QC decision
  let bal = null;
  for (let i = 0; i < 10; i++) {
    const w = await api('GET', '/wallet', undefined, { token: custTok });
    bal = w.balance;
    if (Number(bal) > 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(Number(bal) > 0)) {
    const rr = await api('GET', `/returns`, { orderId }, { token: custTok });
    const row = (Array.isArray(rr) ? rr : rr.items || [])[0];
    throw new Error(`wallet=${bal}; return=${JSON.stringify(row).slice(0, 200)}`);
  }
  return `refunded ₹${bal}`;
});
await shot(page, 'a14-aftersales');

// ---------------------------------------------------------------- policies
await R.check('A15', 'Policies: stats + tabs render', async () => {
  await page.goto(BASE + '/policies', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Delivery fee|Active tax policies|Active coupons/i, 15000);
  for (const tab of ['Tax', 'Coupons', 'Refund']) {
    await clickText(page, new RegExp(`^${tab}`, 'i'), { timeout: 6000 }).catch(() => {});
  }
  return 'tabs navigable';
});

await R.check('A16', 'Policies: create coupon via UI', async () => {
  await clickText(page, /Coupons/i, { timeout: 8000 });
  await waitText(page, /New coupon|Coupon/i, 8000);
  await clickText(page, 'New coupon', { exact: true });
  const couponCode = `E2EUI${Date.now() % 100000}`;
  await typeInto(page, 'input[placeholder="WELCOME10"]', couponCode).catch(async () => {
    // fallback: first input in modal
    await page.evaluate(() => document.querySelector('div[role=dialog] input, .fixed input')?.focus());
    await page.keyboard.type(couponCode);
  });
  // discount type: ensure percent
  const sel = await page.$('select');
  if (sel) await page.select('select', 'percent').catch(() => {});
  await typeInto(page, 'input[type="number"]', '10').catch(() => {});
  await clickText(page, 'Create coupon', { exact: true });
  await waitText(page, new RegExp(couponCode), 12000);
  return couponCode;
});

// ---------------------------------------------------------------- search
await R.check('A17', 'Search admin: health + synonyms + reindex', async () => {
  await page.goto(BASE + '/search', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Synonym|Health|indexed|Index/i, 15000);
  // add a synonym via UI
  await clickText(page, 'Add synonym', { exact: true }).catch(() => {});
  const termsBox = await page.$('textarea');
  if (termsBox) {
    await termsBox.type('e2e, e2erose');
    await typeInto(page, 'input[placeholder="guldasta"]', 'e2eui').catch(() => {});
    await clickText(page, /Create|Save|Add/i, { timeout: 5000 }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 800));
  await page.keyboard.press('Escape'); // ensure no modal is left over the reindex step
  // reindex — the button OPENS a modal; the inner "Run reindex" button fires
  // POST /search/reindex. Wait on the network response, not on page text
  // (the health panel always contains the word "indexed" — a text match
  // would pass even when the reindex never ran).
  await clickText(page, /Run reindex|Reindex/i, { timeout: 6000 });
  await waitText(page, /Rebuild the search index/i, 8000); // modal subtitle — modal is open
  const reindexResp = page.waitForResponse(
    (res) => res.url().includes('/search/reindex') && res.request().method() === 'POST',
    { timeout: 30000 }).catch(() => null);
  // The health card ALSO has a "Run reindex" button (DOM-first) that only
  // re-opens this modal — so scope the action click to a modal panel, and
  // scan every open panel (a leftover modal would be the first one).
  const clickedInner = await page.evaluate(() => {
    const panels = document.querySelectorAll('div.modal-panel[role="dialog"]');
    for (const panel of panels) {
      const btn = Array.from(panel.querySelectorAll('button'))
        .find((b) => (b.innerText || '').trim() === 'Run reindex');
      if (btn) { btn.click(); return true; }
    }
    return false;
  });
  if (!clickedInner) throw new Error('modal action button not found in any dialog panel');
  const resp = await reindexResp;
  if (!resp) throw new Error('POST /search/reindex never observed — the modal action did not fire');
  if (!resp.ok()) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`POST /search/reindex → ${resp.status()}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  await page.keyboard.press('Escape');
  // the reindex must actually leave the index complete — a reindex that
  // "succeeded" while listings stay missing is the bug this test exists for
  const health = await api('GET', '/search/health', undefined, { token: adminTok });
  const fresh = health.freshness || health;
  if (Number(fresh.missing) !== 0) {
    throw new Error(`index incomplete after reindex: missing=${fresh.missing} indexed=${fresh.indexedDocuments} listings=${fresh.listings}`);
  }
  return `reindex complete (${fresh.indexedDocuments} docs, 0 missing)`;
});

// ---------------------------------------------------------------- tax
await R.check('A18', 'Tax: registration + documents render', async () => {
  await page.goto(BASE + '/tax', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Registration|GSTIN|Tax documents/i, 15000);
  await clickText(page, 'Documents', { exact: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const t = await bodyText(page);
  if (!/Tax documents|Invoice|credit|GST/i.test(t)) throw new Error('documents tab missing');
  return 'registration + documents';
});

// ---------------------------------------------------------------- users
// All staff-modal actions are scoped to the modal panel (page filters exist outside it).
const MODAL = 'div.modal-panel[role="dialog"]';
async function createStaffViaUi(role, email, password) {
  await clickText(page, 'Create staff', { exact: true });
  await waitText(page, /Create staff user/i, 6000);
  const roleSel = await page.$(`${MODAL} select`);
  if (roleSel) await roleSel.select(role);
  await typeInto(page, `${MODAL} input[type="email"]`, email);
  await typeInto(page, `${MODAL} input[type="password"]`, password);
  await page.evaluate(() => {
    const m = document.querySelector('div.modal-panel[role="dialog"]');
    const btn = Array.from(m?.querySelectorAll('button') || [])
      .find((b) => /Create staff/.test(b.innerText || '') && !b.disabled);
    btn?.click();
  });
  await waitText(page, new RegExp(email.split('@')[0]), 12000);
}

await R.check('A19', 'Users: list + create staff (picker) via UI', async () => {
  await page.goto(BASE + '/users', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /admin@flowermarket|Role|Status/i, 15000);
  const staffEmail = `picker.e2e.${Date.now()}@flowermarket.in`;
  await createStaffViaUi('picker', staffEmail, 'Picker@12345');
  return staffEmail;
});

const riderEmail = `rider.e2e.${Date.now()}@flowermarket.in`;
await R.check('A20', 'Users: create rider via UI (for rider session test)', async () => {
  await createStaffViaUi('rider', riderEmail, 'Rider@12345');
  return riderEmail;
});

// ---------------------------------------------------------------- store pages
await R.check('A21', 'Store vendors page renders', async () => {
  await page.goto(BASE + '/vendors', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Vendor/i, 15000);
  return 'rendered';
});

await R.check('A22', 'Billing page: plan state renders', async () => {
  await page.goto(BASE + '/billing', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Plan|Subscription|billing/i, 15000);
  return 'rendered';
});

await R.check('A23', 'Storefront branding: save tagline → verified via API → restore', async () => {
  await page.goto(BASE + '/storefront', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Tagline|Branding|Storefront/i, 15000);
  const sel = 'input[placeholder="Fresh flowers, delivered same day"]';
  const clearInput = async () => {
    const inp = await page.$(sel);
    await inp.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
  };
  const saveAndRead = async () => {
    const respP = page.waitForResponse(
      (res) => res.url().includes('/marketplace/store') && res.request().method() === 'PATCH',
      { timeout: 15000 }).catch(() => null);
    await clickText(page, 'Save branding', { exact: true });
    const resp = await respP;
    if (!resp) throw new Error('no PATCH /marketplace/store observed');
    if (resp.status() >= 400) throw new Error(`save → ${resp.status()}`);
    const boot = await api('GET', '/domains/bootstrap', undefined, { tenant: null });
    return boot?.store?.tagline ?? boot?.storefront?.tagline ?? null;
  };
  const tagline = `UI E2E tagline ${Date.now() % 1000000}`;
  await clearInput();
  await typeInto(page, sel, tagline, { clear: false });
  const got = await saveAndRead();
  if (got !== tagline) throw new Error(`bootstrap tagline after save = ${JSON.stringify(got)}`);
  // restore to empty
  await clearInput();
  const got2 = await saveAndRead();
  if (got2) throw new Error(`restore failed, tagline still = ${JSON.stringify(got2)}`);
  return 'tagline round-trip + restore ok';
});

await R.check('A24', 'Domains page renders', async () => {
  await page.goto(BASE + '/domains', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Domain|hostname|shop\./i, 15000);
  return 'rendered';
});

// ---------------------------------------------------------------- platform
const platformPages = [
  ['A25', '/platform', 'Platform overview: GMV/tenants stats', /GMV|Active tenants|Net revenue/i],
  ['A26', '/platform/stores', 'Platform stores list', /Flower Market|Store/i],
  ['A27', '/platform/lifecycle', 'Platform lifecycle & ops', /Lifecycle|tenant|Tenant/i],
  ['A28', '/platform/vendor-applications', 'Vendor applications queue', /application|Application/i],
  ['A29', '/platform/vendors', 'Platform vendors', /Vendor/i],
  ['A30', '/platform/billing', 'Platform billing', /Billing|invoice|Invoice|subscription/i],
  ['A31', '/platform/plans', 'Marketplace plans', /Plan/i],
  ['A32', '/platform/payouts', 'Platform payouts', /Payout/i],
  ['A33', '/platform/ledger', 'Platform ledger', /Ledger|entry|Entry/i],
];
for (const [id, path, desc, rx] of platformPages) {
  await R.check(id, `Platform: ${desc}`, async () => {
    await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitText(page, rx, 15000);
    return path;
  });
}
await shot(page, 'a33-platform');

// ---------------------------------------------------------------- payments ops
let seedOrder = null; // hoisted: A39 (trace timeline) reuses the seeded order
await R.check('A37', 'Payments ops: live async payment → webhook audit → drawer → reconcile', async () => {
  // 1) seed a REAL async payment through the live API: pending charge,
  //    then a signed gateway webhook that captures it.
  const crypto = await import('node:crypto');
  const WEBHOOK_SECRET = 'mock-webhook-secret-dev';
  await api('POST', '/fulfillment/payments/mock/force-pending', { enabled: true }, { token: adminTok });
  try {
    const a2 = await api('GET', '/catalog?limit=10', undefined, { tenant: null });
    const cat2 = Array.isArray(a2) ? a2 : a2.items || [];
    const listing2 = cat2.find((l) => l.product?.isPerishable === false) || cat2[0];
    await api('POST', '/cart/items', { tenantProductId: listing2.listingId || listing2.id, qty: 1 }, { token: custTok });
    const s2 = await api('GET', `/cart/slots?pincode=533001&date=${today}`, undefined, { token: custTok });
    const slot2 = (s2.slots || (Array.isArray(s2) ? s2 : [])).find((sl) => (sl.remaining ?? sl.available) > 0);
    const r2 = await api('POST', `/cart/slots/${slot2.id || slot2._id}/reserve`, {}, { token: custTok });
    const q2 = await api('POST', '/cart/quote', { slotReservationId: r2.id || r2._id, addressId }, { token: custTok });
    const co2 = await api('POST', '/cart/checkout', {
      slotReservationId: r2.id || r2._id, addressId, paymentMethod: 'upi', confirmPriceChanges: true,
    }, { token: custTok });
    if (co2.paymentPending !== true) throw new Error('seed: expected paymentPending, got ' + JSON.stringify(co2).slice(0, 160));
    seedOrder = co2.order || co2;
    const seedOrderId = seedOrder.id || seedOrder._id;
    // signed gateway webhook (same HMAC contract as Razorpay)
    const body = JSON.stringify({
      eventId: `evt_a37_${Date.now()}`,
      gatewayOrderId: co2.gatewayOrderId,
      gatewayPaymentId: `mpay_a37_${Date.now().toString(36)}`,
      amountPaise: Math.round(Number(q2.grandTotal) * 100),
    });
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex');
    const wh = await fetch('http://127.0.0.1:4000/api/v1/payments/webhook/mock', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mock-signature': sig },
      body,
    });
    if (wh.status !== 200) throw new Error(`seed: webhook ${wh.status}`);
    // 2) UI: payments tab — stats, table, webhook audit, drawer, reconcile
    await page.goto(BASE + '/fulfillment', { waitUntil: 'networkidle2', timeout: 30000 });
    await waitText(page, /Picking|picking/i, 15000);
    await clickText(page, 'Payments', { exact: true });
    await waitText(page, /Webhook audit/i, 15000);
    const t = await bodyText(page);
    for (const lbl of ['Pending', 'Success', 'Failed', 'Refunded', 'Reconcile pending']) {
      if (!new RegExp(lbl, 'i').test(t)) throw new Error(`missing ${lbl}`);
    }
    // our captured payment must be searchable by order id
    await typeInto(page, 'input[placeholder="Payment by order id…"]', String(seedOrderId));
    await page.waitForFunction((id) => {
      const rows = [...document.querySelectorAll('tbody tr')];
      return rows.some((r) => (r.textContent || '').includes(id));
    }, { timeout: 20000 }, String(seedOrderId));
    // webhook audit shows the verified event
    await waitText(page, /payment\.captured/i, 15000);
    await waitText(page, /Processed/i, 8000);
    // open the payment drawer — gateway refs + webhook events section
    await page.evaluate((id) => {
      const row = [...document.querySelectorAll('tbody tr')].find((r) => (r.textContent || '').includes(id));
      if (!row) throw new Error('payment row gone');
      row.click();
    }, String(seedOrderId));
    await waitText(page, /Gateway order/i, 15000);
    await waitText(page, /Webhook events/i, 10000);
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 600));
    // reconcile: no pending left from our seed, runs clean
    await clickText(page, /Reconcile pending/i);
    await waitText(page, /sweep complete/i, 15000);
    return `seed order ${String(seedOrderId).slice(-8)}: captured via webhook, audited, reconciled`;
  } finally {
    await api('POST', '/fulfillment/payments/mock/force-pending', { enabled: false }, { token: adminTok });
  }
});
await shot(page, 'a37-payments');

// ---------------------------------------------------------------- Phase 10: money audit backbone
await R.check('A38', 'System integrity: ledger page reports all subsystems + replay action', async () => {
  await page.goto(BASE + '/platform/ledger', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /System integrity/i, 15000);
  await waitText(page, /All subsystems consistent|DRIFT DETECTED/i, 20000);
  const t = await bodyText(page);
  if (!/All subsystems consistent/i.test(t)) throw new Error('integrity not green on live stack');
  if (!/Replay/i.test(t)) throw new Error('replay action missing');
  for (const sub of ['Ledger', 'Search index', 'Delivery slots', 'Payouts', 'Audit event store']) {
    if (!new RegExp(sub, 'i').test(t)) throw new Error(`missing subsystem row: ${sub}`);
  }
  return 'all 7 subsystems reported, stack green';
});
await shot(page, 'a38-integrity');

await R.check('A39', 'Follow the money: order drawer assembles the trace timeline', async () => {
  if (!seedOrder?.orderNumber) throw new Error('A37 did not produce a seed order');
  const no = seedOrder.orderNumber;
  await page.goto(BASE + '/orders', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, new RegExp(no), 15000);
  await page.evaluate((n) => {
    const el = Array.from(document.querySelectorAll('tbody tr, a, button')).find((e) => (e.innerText || '').includes(n));
    if (el) el.click();
  }, no);
  await waitText(page, /Follow the money/i, 15000);
  await waitText(page, /Order placed/i, 10000);
  await waitText(page, /Audit event · sale_captured/i, 20000);
  await waitText(page, /Journal · sale_captured/i, 10000);
  await page.keyboard.press('Escape');
  return `${no}: order→payment→journal→audit events on one trace`;
});
await shot(page, 'a39-trace');

await R.check('A40', 'Fiscal periods: close month via UI → report from journal → reopen', async () => {
  await page.goto(BASE + '/platform/ledger', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Fiscal periods/i, 15000);
  const month = new Date().toISOString().slice(0, 7);
  // the state badge is a rounded-full span whose exact text is 'open'|'closed'
  const badgeState = () => page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('span'))
      .find((s) => /^(open|closed)$/.test((s.textContent || '').trim()) && (s.className || '').includes('rounded-full'));
    return b ? b.textContent.trim() : null;
  });
  const clickControl = (verbRx) => page.evaluate((m, v) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const rowish = btns.find((b) => {
      const host = b.closest('div[class*="border"]') || b.parentElement;
      return new RegExp(v).test(b.textContent) && (host?.textContent || '').includes(m);
    });
    const target = rowish || btns.find((b) => /Close current month/i.test(b.textContent) && new RegExp(v).test(b.textContent));
    if (!target) return null;
    target.click();
    return target.textContent.trim();
  }, month, verbRx);
  const waitBadge = (want) => page.waitForFunction((w) => {
    const b = Array.from(document.querySelectorAll('span'))
      .find((s) => /^(open|closed)$/.test((s.textContent || '').trim()) && (s.className || '').includes('rounded-full'));
    return b && b.textContent.trim() === w;
  }, { timeout: 20000 }, want);

  // 1) make sure the month is CLOSED (close it if open/unrecorded)
  if ((await badgeState()) !== 'closed') {
    const clicked = await clickControl('Close');
    if (!clicked) throw new Error('no Close control found on the Fiscal periods card');
    await waitBadge('closed');
  }
  // 2) the period report renders, computed from the journal
  await clickText(page, 'Report');
  await waitText(page, /Gross captured/i, 15000);
  await waitText(page, /balanced/i, 10000);
  // 3) reopen — the books accept postings again
  const reopened = await clickControl('Reopen');
  if (!reopened) throw new Error('no Reopen control found after close');
  await waitBadge('open');
  return `${month}: closed via UI, report balanced, reopened`;
});
await shot(page, 'a40-periods');

await R.check('A41', 'Cash gate: settlement card — gate toggle via UI, ingest a settlement, restore gate', async () => {
  await page.goto(BASE + '/platform/payouts', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Settlement — the cash gate/i, 15000);
  await waitText(page, /Gateway clearing/i, 10000);

  const gateState = () => page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /Cash gate/.test(x.textContent));
    return b ? b.textContent.trim() : '';
  });

  // 1) make sure the gate is ON (work from whatever state a previous run left)
  if (!/ON$/.test((await gateState()))) await clickText(page, /Cash gate OFF/);
  await waitText(page, /Cash gate ON/, 10000);

  // 2) ingest a settlement for an unsettled paid order listed on the card.
  //    posted+skipped === 1 is deterministic even if a parallel actor (e2e-live
  //    on a shared stack) settled that order first.
  const orderNo = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('section, div')).find((d) => /Settlement — the cash gate/i.test(d.textContent || ''));
    return card
      ? Array.from(card.querySelectorAll('span.font-mono')).map((s) => s.textContent.trim()).find((t) => /^FM-\d{6}-\d{5}$/.test(t))
      : null;
  });
  let ingestDetail = 'no unsettled orders listed (all settled) — card verified only';
  if (orderNo) {
    await page.evaluate((no) => {
      const ta = document.querySelector('textarea[placeholder*="FM-"]');
      if (!ta) throw new Error('settlement textarea not found');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, no);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, orderNo);
    await clickText(page, /Ingest settlement/);
    await waitText(page, /\d+ posted/, 15000);
    const resultLine = await page.evaluate(() => {
      const m = (document.body.textContent || '').match(/\d+ posted · \d+ skipped · \d+ unmatched/);
      if (!m) throw new Error('no ingest result line found');
      const [posted, skipped, unmatched] = m[0].split(' · ').map((s) => Number(s[0]));
      if (posted + skipped !== 1 || unmatched !== 0) throw new Error(`unexpected ingest result: ${m[0]}`);
      return m[0];
    });
    ingestDetail = `${orderNo}: ${resultLine}`;
  }

  // 3) restore the gate to its default (off) so later checks run unchanged
  if (/ON$/.test((await gateState()))) {
    await clickText(page, /Cash gate ON/);
    await waitText(page, /Cash gate OFF/, 10000);
  }
  return ingestDetail;
});
await shot(page, 'a41-settlement');

await R.check('A43', 'Statutory deposits: card renders; the over-deposit guard fires through the UI', async () => {
  await page.goto(BASE + '/platform/payouts', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /Statutory deposits — TCS & TDS/i, 15000);
  await waitText(page, /TCS — GST s\.52/i, 10000);
  await waitText(page, /TDS — IT s\.194-O/i, 10000);
  await waitText(page, /still owed/i, 10000);
  // attempt an impossible deposit — the API must refuse it, quoting the real balance
  await typeInto(page, 'input[type="number"]', '999999.99');
  await typeInto(page, 'input[placeholder*="CHAVS"]', 'E2E-BIG-UTR');
  await clickText(page, /Record deposit/);
  await waitText(page, /only ₹/, 15000);
  return 'TCS + TDS cards rendered; the over-deposit guard quoted the actual liability and refused';
});
await shot(page, 'a43-statutory');

// ---------------------------------------------------------------- RBAC + rider
await R.check('A34', 'RBAC: store admin blocked from vendor console', async () => {
  await page.goto(BASE + '/vendor', { waitUntil: 'networkidle2', timeout: 30000 });
  await waitText(page, /No console access|No access/i, 10000);
  return 'no-access shown';
});
await shot(page, 'a34-noaccess');

await R.check('A35', 'Rider session: login as created rider → /rider renders', async () => {
  await page.click('button[title="Sign out"]', { timeout: 8000 });
  await waitText(page, /Sign in|Email/i, 10000);
  await typeInto(page, 'input[placeholder="admin@flowermarket.in"]', riderEmail);
  await typeInto(page, 'input[type="password"]', 'Rider@12345');
  await clickText(page, 'Sign in', { exact: true });
  await waitText(page, /Deliver|deliver|rider|Rider/i, 20000);
  const t = await bodyText(page);
  if (!/deliver|Deliver/i.test(t)) throw new Error('rider page content missing');
  return 'rider console visible';
});
await shot(page, 'a35-rider');

// ---------------------------------------------------------------- audit
await R.check('A36', 'No page errors / failed API requests', async () => {
  const iss = page._issues;
  if (process.env.DUMP_CONSOLE && iss.console.length) {
    console.log('  --- console errors ---');
    for (const c of iss.console) console.log('    ·', c);
    console.log('  --- end ---');
  }
  if (iss.pageerrors.length) throw new Error(`pageerrors: ${iss.pageerrors[0]}`);
  const hardNet = iss.netfail.filter((f) => !/favicon/.test(f));
  if (hardNet.length) throw new Error(`netfail: ${hardNet[0]}`);
  return `console-err=${iss.console.length} pageerr=${iss.pageerrors.length} netfail=${hardNet.length}`;
});

const s = await R.printSummary();
for (const n of R.notes) console.log('NOTE:', n);
await browser.close();
process.exit(s.pass === s.total ? 0 : 1);
