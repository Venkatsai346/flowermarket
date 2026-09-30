import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import catalogQualityService from '../src/services/catalogQuality.service.js';
import CatalogQualityRun from '../src/models/catalogQualityRun.model.js';
import CatalogQualityAssessment from '../src/models/catalogQualityAssessment.model.js';

const oid = (suffix) => new mongoose.Types.ObjectId(`66d00000000000000000${suffix}`);
const now = new Date('2026-09-30T00:00:00.000Z');
const tenantId = oid('0001');
const master = {
  _id: oid('0010'), title: 'Premium Red Rose Bunch', slug: 'premium-red-rose-bunch', skuGlobal: 'ROSE-10',
  type: 'flower', manufacturer: 'Veda Blooms', modelNumber: 'VB-R10', status: 'active', complianceStatus: 'not_required',
  shortDescription: 'Ten fresh premium red roses arranged for gifting.',
  description: 'Ten carefully selected fresh red roses with protective wrapping, hydration support, care guidance and factual stem-count details for gifting occasions.',
  seo: { title: 'Premium Red Rose Bunch Online', description: 'Order a fresh bunch of ten premium red roses with careful wrapping and transparent product details.' },
  tags: ['rose', 'red flowers', 'bouquet'], unitPolicy: { baseUnit: 'stem', units: [{ code: 'stem' }] },
  categoryId: oid('0020'), brandId: oid('0030'), version: 2, updatedAt: now,
};
const category = { _id: master.categoryId, name: 'Rose Bouquets', attributeSchema: [], version: 1, updatedAt: now };
const brand = { _id: master.brandId, name: 'Veda Blooms', version: 1, updatedAt: now };
const variants = [{ _id: oid('0040'), productMasterId: master._id, sku: 'ROSE-10-RED', displayLabel: 'Red · 10 stems', combinationKey: 'colour:red|count:10', isDefault: true, status: 'active', updatedAt: now }];
const listings = [{ _id: oid('0050'), tenantId, productMasterId: master._id, variantId: variants[0]._id, status: 'active', stockQty: 12, channels: { storefront: true }, price: { sellingPrice: 399, mrp: 499 }, priceBasis: { quantity: 10, unitCode: 'stem' }, version: 3, updatedAt: now }];
const images = [{ _id: oid('0060'), productMasterId: master._id, variantId: variants[0]._id, mediaType: 'image', status: 'active', isPrimary: true, altText: 'Ten fresh red roses in a wrapped bouquet', width: 1200, height: 1200, updatedAt: now }];
const searchDocs = [{ _id: oid('0070'), masterId: master._id, status: 'active', indexedAt: new Date(now.getTime() + 1000) }];
const inventories = [{ _id: oid('0071'), tenantProductId: listings[0]._id, qtyOnHand: 12, qtyReserved: 0, updatedAt: now }];

const first = catalogQualityService.evaluateOne({ tenantId, master, category, brand, listings, variants, images, attributes: [], variantAttributes: [], searchDocs, inventories, now, qualityRunId: oid('0080') });
assert.equal(first.publishable, true);
assert.equal(first.evaluatorVersion, 'catalog-quality-v2');
assert.match(first.sourceFingerprint, /^[a-f0-9]{64}$/);
for (const finding of first.issues) {
  assert.match(finding.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(finding.firstDetectedAt.toISOString(), now.toISOString());
  assert.equal(finding.lastDetectedAt.toISOString(), now.toISOString());
}

const later = new Date(now.getTime() + 60_000);
const second = catalogQualityService.evaluateOne({ tenantId, master, category, brand, listings: [...listings].reverse(), variants: [...variants].reverse(), images: [...images].reverse(), attributes: [], variantAttributes: [], searchDocs: [...searchDocs].reverse(), inventories: [...inventories].reverse(), previousAssessment: first, now: later, qualityRunId: oid('0080') });
assert.equal(second.sourceFingerprint, first.sourceFingerprint, 'source fingerprint must be order-independent');
for (const finding of second.issues) {
  const prior = first.issues.find((row) => row.fingerprint === finding.fingerprint);
  assert.equal(finding.firstDetectedAt.toISOString(), prior.firstDetectedAt.toISOString());
  assert.equal(finding.lastDetectedAt.toISOString(), later.toISOString());
}

const runIndexes = CatalogQualityRun.schema.indexes();
assert(runIndexes.some(([keys, options]) => keys.tenantId === 1 && keys.active === 1 && options.unique && options.partialFilterExpression?.active === true));
assert(runIndexes.some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
assert(CatalogQualityAssessment.schema.path('qualityRunId'));
assert(CatalogQualityAssessment.schema.path('issues').schema.path('fingerprint'));

console.log('durable catalog quality tests passed');
