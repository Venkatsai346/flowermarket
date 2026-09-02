/**
 * smoke-gst.test.js — Phase 6.2 tax documents, end to end.
 *
 * Dual mode, same contract as smoke-ledger.test.js:
 *   MONGODB_URI set        → real MongoDB (use this in CI)
 *   otherwise              → mongodb-memory-server
 *   neither                → SKIP with exit 0, unless REQUIRE_DB=true
 *
 * The tax ARITHMETIC is proven without a database by scripts/tax-calc.test.js
 * (78 assertions incl. two 20 000-case fuzz runs). This suite proves the
 * things only a database can: numbering, idempotency, immutability and the
 * invoice↔order↔credit-note relationships.
 */

import mongoose from 'mongoose';
import config from '../src/config/index.js';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${expected}, got ${actual}`);
const section = (t) => console.log(`\n${t}`);

let mongod = null;

async function connect() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    return `real MongoDB (${process.env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')})`;
  }
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('flower_market_gst_test');
  config.mongoUri = uri;
  await mongoose.connect(uri, { autoIndex: true });
  return 'mongodb-memory-server';
}

async function main() {
  let mode;
  try {
    mode = await connect();
  } catch (err) {
    const msg = `no database available (${err.message.split('\n')[0]})`;
    if (process.env.REQUIRE_DB === 'true') {
      console.error(`\n❌ smoke-gst: ${msg} and REQUIRE_DB=true\n`);
      process.exit(1);
    }
    console.log('\n⏭  SKIPPED — smoke-gst needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   Run with: MONGODB_URI=mongodb://127.0.0.1:27017/fm_test node scripts/smoke-gst.test.js');
    console.log('   (the GST arithmetic is fully covered by scripts/tax-calc.test.js)\n');
    process.exit(0);
  }

  console.log(`\n🧾 Phase 6.2 GST smoke — ${mode}`);

  const { default: taxService } = await import('../src/services/tax.service.js');
  const { default: taxDocs } = await import('../src/services/taxDocument.service.js');
  const { default: TaxDocument } = await import('../src/models/taxDocument.model.js');
  const { default: TaxDocumentSeries } = await import('../src/models/taxDocumentSeries.model.js');
  const { default: TaxPolicy } = await import('../src/models/taxPolicy.model.js');
  const { default: Order } = await import('../src/models/order.model.js');
  const { default: OrderItem } = await import('../src/models/orderItem.model.js');
  const { default: ProductMaster } = await import('../src/models/productMaster.model.js');
  const { default: Category } = await import('../src/models/category.model.js');
  const { default: Vendor } = await import('../src/models/vendor.model.js');
  const { default: Tenant } = await import('../src/models/tenant.model.js');
  const { default: User } = await import('../src/models/user.model.js');
  const { default: RefundTransaction } = await import('../src/models/refundTransaction.model.js');
  const { TAX_OWNER_TYPE, TAX_DOC_TYPE, TAX_DOC_STATUS, REFUND_REASON } = await import('../src/constants/enums.js');
  const { toPaise, fromPaise } = await import('../src/utils/money.js');
  const { computeGstinChecksum } = await import('../src/utils/gst.js');

  const oid = () => new mongoose.Types.ObjectId();
  const gstinFor = (state, base) => {
    const first14 = `${state}${base}`.slice(0, 14);
    return `${first14}${computeGstinChecksum(first14)}`;
  };

  await Promise.all([
    TaxDocument.deleteMany({}), TaxDocumentSeries.deleteMany({}), TaxPolicy.deleteMany({}),
  ]);

  // ---- fixtures ----
  const tenant = await Tenant.create({ name: 'Bloom Bazaar', slug: `bloom-${Date.now()}`, type: 'business', status: 'active' });
  const user = await User.create({
    tenantId: tenant._id, role: 'customer', status: 'active',
    profile: { firstName: 'Asha', lastName: 'Rao' },
    phone: { countryCode: '+91', number: `9${String(Date.now()).slice(-9)}`, verified: true },
  });
  const vendor = await Vendor.create({
    userId: oid(), businessName: 'Rose Farms', slug: `rose-farms-${Date.now()}`,
    commissionRateBps: 1000, status: 'active',
  });
  const catFlowers = await Category.create({ name: 'Fresh Flowers', slug: `fresh-flowers-${Date.now()}`, status: 'active' });
  const catPots = await Category.create({ name: 'Planters', slug: `planters-${Date.now()}`, status: 'active' });

  // ---------------------------------------------------------------------
  section('1. registrations — GSTIN checksum is enforced at entry');
  // ---------------------------------------------------------------------
  let badThrew = null;
  try {
    await taxService.upsertRegistration({
      ownerType: TAX_OWNER_TYPE.TENANT, ownerId: tenant._id,
      payload: { legalName: 'Bloom Bazaar Pvt Ltd', gstin: '37AADCB2230M1ZZ' }, // wrong check digit
    });
  } catch (err) { badThrew = err; }
  eq('a bad check digit is rejected', badThrew?.code, 'INVALID_GSTIN');

  const storeGstin = gstinFor('37', 'AADCB2230M1Z');
  const storeReg = await taxService.upsertRegistration({
    ownerType: TAX_OWNER_TYPE.TENANT, ownerId: tenant._id,
    payload: {
      legalName: 'Bloom Bazaar Pvt Ltd', gstin: storeGstin,
      address: { line1: '12 MG Road', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
    },
  });
  eq('state code derived from the GSTIN', storeReg.stateCode, '37');
  eq('PAN derived from the GSTIN', storeReg.pan, 'AADCB2230M');

  const vendorGstin = gstinFor('37', 'AAECR1234F1Z');
  await taxService.upsertRegistration({
    ownerType: TAX_OWNER_TYPE.VENDOR, ownerId: vendor._id,
    payload: { legalName: 'Rose Farms LLP', gstin: vendorGstin, address: { state: 'Andhra Pradesh' } },
  });
  check('vendor registered as its own supplier', true);

  // ---------------------------------------------------------------------
  section('2. rate policies are effective-dated');
  // ---------------------------------------------------------------------
  await taxService.upsertPolicy({
    payload: {
      categoryId: catFlowers._id, rateBps: 0, natureOfSupply: 'nil_rated',
      hsnCode: '0603', effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });
  await taxService.upsertPolicy({
    payload: {
      categoryId: catPots._id, rateBps: 1200, natureOfSupply: 'taxable',
      hsnCode: '6912', effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });
  // a later slab change on planters: 12% -> 18% from 2026-01-01
  await taxService.upsertPolicy({
    payload: {
      categoryId: catPots._id, rateBps: 1800, natureOfSupply: 'taxable',
      hsnCode: '6912', effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    },
  });

  const old = await taxService.resolveTaxPolicy({ categoryId: catPots._id, at: new Date('2025-06-01T00:00:00Z') });
  const now = await taxService.resolveTaxPolicy({ categoryId: catPots._id, at: new Date('2026-06-01T00:00:00Z') });
  eq('a 2025 supply resolves to 12%', old.rateBps, 1200);
  eq('a 2026 supply resolves to 18%', now.rateBps, 1800);
  eq('gstSlabPct stays in sync for the legacy engine', now.gstSlabPct, 18);

  const nil = taxService.rateFromPolicy(await taxService.resolveTaxPolicy({ categoryId: catFlowers._id, at: new Date() }));
  eq('flowers resolve as nil_rated, not "0% taxable"', nil.natureOfSupply, 'nil_rated');
  const missing = taxService.rateFromPolicy(null);
  eq('a category with no policy defaults to nil_rated', missing.natureOfSupply, 'nil_rated');

  // ---------------------------------------------------------------------
  section('3. issuing an invoice from an order');
  // ---------------------------------------------------------------------
  const masterFlower = await ProductMaster.create({
    skuGlobal: `SKU-F-${Date.now()}`, type: 'flower', title: 'Red Rose Bunch',
    slug: `red-rose-${Date.now()}`, categoryId: catFlowers._id, status: 'active',
    defaultSellingUnit: 'bunch', vendorId: vendor._id,
  });
  const masterPot = await ProductMaster.create({
    skuGlobal: `SKU-P-${Date.now()}`, type: 'accessory', title: 'Ceramic Planter',
    slug: `planter-${Date.now()}`, categoryId: catPots._id, status: 'active',
    defaultSellingUnit: 'piece',
  });

  // Phase 3.5 pipeline numbers: exclusive tax, persisted on the items.
  const order = await Order.create({
    tenantId: tenant._id, userId: user._id, orderNumber: `FM-GST-${Date.now()}`,
    status: 'confirmed',
    itemsCount: 3, itemsSubtotal: 1600, deliveryFee: 49, discount: 0,
    taxAmount: 120, totalAmount: 1769, currency: 'INR',
    paymentMethod: 'upi', paymentSummary: { status: 'success', paidAt: new Date() },
    addressSnapshot: {
      name: 'Asha Rao', phone: '9999999999', line1: '4 Lake View',
      city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520010',
    },
  });
  await OrderItem.insertMany([
    {
      orderId: order._id, tenantId: tenant._id, tenantProductId: oid(),
      productMasterId: masterFlower._id, vendorId: vendor._id,
      skuSnapshot: { title: 'Red Rose Bunch' }, priceAtOrder: { sellingPrice: 300 },
      qty: 2, lineTotal: 600, taxAmount: 0, discountAllocated: 0, hsnCode: '0603',
    },
    {
      orderId: order._id, tenantId: tenant._id, tenantProductId: oid(),
      productMasterId: masterPot._id, vendorId: null,
      skuSnapshot: { title: 'Ceramic Planter' }, priceAtOrder: { sellingPrice: 1000 },
      qty: 1, lineTotal: 1000, taxAmount: 120, discountAllocated: 0, hsnCode: '6912',
    },
  ]);

  const issued = await taxDocs.issueForOrder({ orderId: order._id });
  check('invoices issued', issued.created);
  eq('one document per selling entity (vendor + store)', issued.documents.length, 2);

  const vendorDoc = issued.documents.find((d) => d.vendorId);
  const storeDoc = issued.documents.find((d) => !d.vendorId);

  eq('vendor invoice carries the VENDOR gstin', vendorDoc.supplier.gstin, vendorGstin);
  eq('store invoice carries the STORE gstin', storeDoc.supplier.gstin, storeGstin);
  eq('vendor invoice: nil-rated roses, no tax', vendorDoc.totals.totalTaxPaise, 0);
  eq('vendor invoice value = ₹600', vendorDoc.totals.grandTotalPaise, toPaise(600));
  eq('store invoice tax = ₹120 as charged', storeDoc.totals.totalTaxPaise, toPaise(120));
  eq('store invoice CGST = ₹60 (intra-state)', storeDoc.totals.cgstPaise, toPaise(60));
  eq('store invoice SGST = ₹60', storeDoc.totals.sgstPaise, toPaise(60));
  eq('store invoice IGST = 0', storeDoc.totals.igstPaise, 0);
  eq('delivery fee rides on the store document', storeDoc.lines.length, 2);

  const invoicedTotal = issued.documents.reduce((a, d) => a + d.totals.grandTotalPaise, 0);
  eq('Σ invoices === what the customer paid (₹1769)', invoicedTotal, toPaise(order.totalAmount));

  check('place of supply resolved from the delivery address', storeDoc.placeOfSupplyStateCode === '37');
  check('amount in words rendered', /^Rupees /.test(storeDoc.amountInWords), storeDoc.amountInWords);
  check('HSN summary present', storeDoc.hsnSummary.length >= 1);

  // ---------------------------------------------------------------------
  section('4. numbering: gapless, per financial year, ≤16 chars');
  // ---------------------------------------------------------------------
  check('number format FM/FY/seq', /^FM\/\d{2}-\d{2}\/\d{6}$/.test(storeDoc.number), storeDoc.number);
  check('within the 16-character GST limit', storeDoc.number.length <= 16, `${storeDoc.number.length} chars`);
  eq('first document in the store series is #1', storeDoc.sequence, 1);
  eq('vendor has its OWN series starting at #1', vendorDoc.sequence, 1);

  // 25 concurrent issuances against one series
  const raceOwner = oid();
  const numbers = await Promise.all(Array.from({ length: 25 }, () => taxDocs.reserveNumber({
    ownerType: TAX_OWNER_TYPE.TENANT, ownerId: raceOwner, docType: TAX_DOC_TYPE.INVOICE,
  })));
  const seqs = numbers.map((n) => n.sequence).sort((a, b) => a - b);
  eq('25 concurrent reservations produce 25 numbers', new Set(numbers.map((n) => n.number)).size, 25);
  eq('sequence is consecutive 1..25 with no gaps and no duplicates',
    seqs.join(','), Array.from({ length: 25 }, (_, i) => i + 1).join(','));

  // FY rollover
  const marchNo = await taxDocs.reserveNumber({
    ownerType: TAX_OWNER_TYPE.TENANT, ownerId: raceOwner, docType: TAX_DOC_TYPE.INVOICE,
    at: new Date('2027-03-31T12:00:00Z'),
  });
  const aprilNo = await taxDocs.reserveNumber({
    ownerType: TAX_OWNER_TYPE.TENANT, ownerId: raceOwner, docType: TAX_DOC_TYPE.INVOICE,
    at: new Date('2027-04-01T12:00:00Z'),
  });
  eq('31 Mar 2027 lands in FY 26-27', marchNo.fyLabel, '26-27');
  eq('1 Apr 2027 lands in FY 27-28', aprilNo.fyLabel, '27-28');
  eq('the new FY restarts the sequence at 1', aprilNo.sequence, 1);

  // ---------------------------------------------------------------------
  section('5. idempotency & immutability');
  // ---------------------------------------------------------------------
  const again = await taxDocs.issueForOrder({ orderId: order._id });
  check('re-issuing an order returns the existing documents', again.created === false);
  eq('no duplicate documents were created', again.documents.length, 2);
  eq('total invoice count unchanged', await TaxDocument.countDocuments({ orderId: order._id }), 2);

  // ---------------------------------------------------------------------
  section('6. credit note against a refund');
  // ---------------------------------------------------------------------
  const refund = await RefundTransaction.create({
    tenantId: tenant._id, orderId: order._id, userId: user._id,
    amount: 176.9, // 10% of the order
    reason: REFUND_REASON.RETURN_QC_PASSED, destination: 'wallet',
    idempotencyKey: `refund_gst_${Date.now()}`, status: 'success', completedAt: new Date(),
  });
  const cn = await taxDocs.issueCreditNoteForRefund({ refundTransactionId: refund._id });
  check('credit note(s) issued', cn.created);
  const creditTotal = cn.documents.reduce((a, d) => a + d.totals.grandTotalPaise, 0);
  eq('credited amount matches the refund exactly', creditTotal, toPaise(176.9));
  check('credit notes use their own CN series',
    cn.documents.every((d) => /^CN\//.test(d.number)), cn.documents.map((d) => d.number).join(', '));
  check('each credit note references its original invoice',
    cn.documents.every((d) => Boolean(d.originalNumber)));

  const storeCn = cn.documents.find((d) => !d.vendorId);
  if (storeCn) {
    check('tax is reversed at the ORIGINAL rate, split into the same heads',
      storeCn.totals.cgstPaise === storeCn.totals.sgstPaise && storeCn.totals.igstPaise === 0);
  }

  const cnAgain = await taxDocs.issueCreditNoteForRefund({ refundTransactionId: refund._id });
  check('credit note issuance is idempotent', cnAgain.created === false);

  let overThrew = null;
  try {
    await taxDocs.issueCreditNoteAgainst({
      invoice: await taxDocs.detail({ documentId: storeDoc.id }),
      amountPaise: toPaise(99999),
      reason: 'return',
    });
  } catch (err) { overThrew = err; }
  eq('cannot credit more than the invoice', overThrew?.code, 'CREDIT_EXCEEDS_INVOICE');

  // ---------------------------------------------------------------------
  section('7. cancellation keeps the number (gapless series)');
  // ---------------------------------------------------------------------
  const spare = await Order.create({
    tenantId: tenant._id, userId: user._id, orderNumber: `FM-CANCEL-${Date.now()}`,
    status: 'confirmed', itemsCount: 1, itemsSubtotal: 100, deliveryFee: 0, discount: 0,
    taxAmount: 0, totalAmount: 100, currency: 'INR', paymentMethod: 'cod',
    paymentSummary: { status: 'success', paidAt: new Date() },
    addressSnapshot: { line1: 'x', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
  });
  await OrderItem.create({
    orderId: spare._id, tenantId: tenant._id, tenantProductId: oid(),
    productMasterId: masterPot._id, vendorId: null,
    skuSnapshot: { title: 'Ceramic Planter' }, priceAtOrder: { sellingPrice: 100 },
    qty: 1, lineTotal: 100, taxAmount: 0, discountAllocated: 0,
  });
  const spareIssued = await taxDocs.issueForOrder({ orderId: spare._id });
  const spareDoc = spareIssued.documents[0];

  const cancelled = await taxDocs.cancel({ documentId: spareDoc.id, reason: 'issued in error' });
  eq('status becomes cancelled', cancelled.status, TAX_DOC_STATUS.CANCELLED);
  eq('the number is retained', cancelled.number, spareDoc.number);
  check('the document is still queryable', Boolean(await TaxDocument.findById(spareDoc.id)));

  let cnCancelThrew = null;
  try {
    await taxDocs.cancel({ documentId: storeDoc.id, reason: 'nope' });
  } catch (err) { cnCancelThrew = err; }
  eq('an invoice with credit notes cannot be cancelled', cnCancelThrew?.code, 'INVOICE_HAS_CREDIT_NOTES');

  const audit = await taxDocs.auditSeries({
    ownerType: TAX_OWNER_TYPE.TENANT, ownerId: tenant._id,
    docType: TAX_DOC_TYPE.INVOICE, fyLabel: storeDoc.fyLabel,
  });
  eq('series audit reports no gaps', audit.gaps.length, 0);

  // ---------------------------------------------------------------------
  section('8. place of supply must be resolvable');
  // ---------------------------------------------------------------------
  const badOrder = await Order.create({
    tenantId: tenant._id, userId: user._id, orderNumber: `FM-BADPOS-${Date.now()}`,
    status: 'confirmed', itemsCount: 1, itemsSubtotal: 100, deliveryFee: 0, discount: 0,
    taxAmount: 0, totalAmount: 100, currency: 'INR', paymentMethod: 'cod',
    paymentSummary: { status: 'success', paidAt: new Date() },
    addressSnapshot: { line1: 'x', city: 'Nowhere', state: 'Atlantis', pincode: '000000' },
  });
  await OrderItem.create({
    orderId: badOrder._id, tenantId: tenant._id, tenantProductId: oid(),
    productMasterId: masterPot._id, skuSnapshot: { title: 'Planter' },
    priceAtOrder: { sellingPrice: 100 }, qty: 1, lineTotal: 100, taxAmount: 0, discountAllocated: 0,
  });
  let posThrew = null;
  try { await taxDocs.issueForOrder({ orderId: badOrder._id }); } catch (err) { posThrew = err; }
  eq('an unresolvable state refuses to guess the tax heads', posThrew?.code, 'PLACE_OF_SUPPLY_UNRESOLVED');

  // ---------------------------------------------------------------------
  section('9. e-invoice (IRP) lifecycle');
  // ---------------------------------------------------------------------
  eq('not applicable below the turnover threshold', storeDoc.einvoice.status, 'not_applicable');

  await taxService.upsertRegistration({
    ownerType: TAX_OWNER_TYPE.TENANT, ownerId: tenant._id,
    payload: { legalName: 'Bloom Bazaar Pvt Ltd', gstin: storeGstin, turnoverBand: 'gte_5cr', einvoiceEnabled: true },
  });
  const bigOrder = await Order.create({
    tenantId: tenant._id, userId: user._id, orderNumber: `FM-EINV-${Date.now()}`,
    status: 'confirmed', itemsCount: 1, itemsSubtotal: 1000, deliveryFee: 0, discount: 0,
    taxAmount: 180, totalAmount: 1180, currency: 'INR', paymentMethod: 'upi',
    paymentSummary: { status: 'success', paidAt: new Date() },
    addressSnapshot: { line1: 'y', city: 'Vijayawada', state: 'Andhra Pradesh', pincode: '520001' },
  });
  await OrderItem.create({
    orderId: bigOrder._id, tenantId: tenant._id, tenantProductId: oid(),
    productMasterId: masterPot._id, skuSnapshot: { title: 'Ceramic Planter' },
    priceAtOrder: { sellingPrice: 1000 }, qty: 1, lineTotal: 1000, taxAmount: 180, discountAllocated: 0,
  });
  const eIssued = await taxDocs.issueForOrder({ orderId: bigOrder._id });
  const eDoc = await TaxDocument.findById(eIssued.documents[0].id);
  eq('IRN generated for an e-invoice-enabled supplier', eDoc.einvoice.status, 'generated');
  check('IRN is a 64-char hash', eDoc.einvoice.irn?.length === 64);
  check('signed QR payload stored', Boolean(eDoc.einvoice.signedQrPayload));

  const retry = await taxDocs.retryFailedEinvoices({});
  check('retry queue runs cleanly with nothing pending', retry.scanned >= 0);

  // ---------------------------------------------------------------------
  section('10. statutory rates resolve by supply date');
  // ---------------------------------------------------------------------
  await taxService.seedStatutoryRates();
  const tcsNow = await taxService.resolveStatutoryRate({ kind: 'tcs_gst_52', at: new Date('2026-01-01T00:00:00Z') });
  check('a TCS rate is in force today', Boolean(tcsNow), 'no row resolved');
  const tcsOld = await taxService.resolveStatutoryRate({ kind: 'tcs_gst_52', at: new Date('2020-01-01T00:00:00Z') });
  eq('no rate before the timeline starts (never guess)', tcsOld, null);

  await taxService.createStatutoryRate({
    payload: { kind: 'tcs_gst_52', rateBps: 25, effectiveFrom: new Date('2027-01-01T00:00:00Z'), notificationRef: 'test' },
  });
  const before2027 = await taxService.resolveStatutoryRate({ kind: 'tcs_gst_52', at: new Date('2026-12-31T00:00:00Z') });
  const after2027 = await taxService.resolveStatutoryRate({ kind: 'tcs_gst_52', at: new Date('2027-06-01T00:00:00Z') });
  check('the old rate still applies before the change', before2027.rateBps !== 25);
  eq('the new rate applies after it', after2027.rateBps, 25);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`GST smoke: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
}

async function cleanup() {
  await mongoose.disconnect().catch(() => {});
  if (mongod) await mongod.stop().catch(() => {});
}

main()
  .then(async () => { await cleanup(); process.exit(failed ? 1 : 0); })
  .catch(async (err) => { console.error('\n❌ suite crashed:', err); await cleanup(); process.exit(1); });
