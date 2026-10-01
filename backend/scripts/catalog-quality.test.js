import assert from 'node:assert/strict';
import catalogQualityService from '../src/services/catalogQuality.service.js';
import { catalogQualityQuerySchema, qualityMasterParamSchema } from '../src/utils/validators/catalog.validators.js';

const tenantId = '66a000000000000000000001';
const masterId = '66a000000000000000000002';
const variantId = '66a000000000000000000003';
const now = new Date('2026-09-29T10:00:00.000Z');
const master = {
  _id: masterId,
  title: 'Premium Indian Rose Bouquet',
  slug: 'premium-indian-rose-bouquet',
  skuGlobal: 'ROSE-BOUQUET-12',
  categoryId: '66a000000000000000000004',
  brandId: '66a000000000000000000005',
  type: 'flower_bouquet',
  manufacturer: 'Veda Blooms',
  modelNumber: 'VB-R12',
  shortDescription: 'A fresh bouquet of twelve carefully graded Indian roses.',
  description: 'Twelve fresh, carefully graded Indian roses arranged as a gift-ready bouquet with protective wrapping, hydration support, handling guidance, and factual care instructions for the recipient.',
  seo: { title: 'Premium Indian Rose Bouquet Online', description: 'Order a fresh bouquet of twelve carefully graded Indian roses with gift-ready wrapping and clear flower-care guidance.' },
  tags: ['rose bouquet', 'fresh flowers', 'gift flowers'],
  unitPolicy: { baseUnit: 'piece', units: [{ code: 'piece', factor: 1 }] },
  status: 'active',
  complianceStatus: 'approved',
  version: 4,
  updatedAt: new Date('2026-09-29T09:00:00.000Z'),
};
const category = { _id: master.categoryId, name: 'Rose Bouquets', attributeSchema: [] };
const brand = { _id: master.brandId, name: 'Veda Blooms' };
const variant = { _id: variantId, productMasterId: masterId, status: 'active', isDefault: true, combinationKey: 'size=12', displayLabel: '12 roses', sku: 'VB-R12-STD', updatedAt: master.updatedAt };
const listing = {
  _id: '66a000000000000000000006', productMasterId: masterId, variantId,
  status: 'active', isDeleted: false, channels: { storefront: true },
  price: { sellingPrice: 899, mrp: 999 }, priceBasis: { quantity: 1, unitCode: 'piece' },
  stockQty: 20, sellingPolicy: { allowBackorder: false }, version: 2, updatedAt: master.updatedAt,
};
const image = {
  _id: '66a000000000000000000007', productMasterId: masterId, variantId: null, mediaAssetId: '66a000000000000000000009',
  status: 'active', mediaType: 'image', isPrimary: true, altText: 'Twelve red Indian roses in a wrapped bouquet',
  width: 1200, height: 1200, updatedAt: master.updatedAt,
};
const searchDoc = { masterId, status: 'active', indexedAt: new Date('2026-09-29T09:30:00.000Z') };

const complete = catalogQualityService.evaluateOne({
  tenantId, master, category, brand, listings: [listing], variants: [variant], images: [image],
  attributes: [], variantAttributes: [], searchDocs: [searchDoc],
  inventories: [{ _id: '66a000000000000000000008', tenantProductId: listing._id, qtyOnHand: 20, qtyReserved: 0, updatedAt: master.updatedAt }],
  now,
});
assert.equal(complete.score, 100);
assert.equal(complete.grade, 'A');
assert.equal(complete.publishable, true);
assert.equal(complete.launchReady, true);
assert.equal(complete.blockerCount, 0);
assert.equal(complete.dimensions.reduce((sum, row) => sum + row.maxScore, 0), 100);
assert.match(complete.sourceFingerprint, /^[a-f0-9]{64}$/);

const blocked = catalogQualityService.evaluateOne({
  tenantId,
  master: { ...master, categoryId: null, brandId: null, status: 'draft' },
  category: null, brand: null, listings: [], variants: [], images: [], attributes: [], variantAttributes: [], searchDocs: [], now,
});
assert.equal(blocked.publishable, false);
assert.equal(blocked.launchReady, false);
assert.ok(blocked.blockerCount >= 5);
assert.ok(blocked.issues.some((row) => row.code === 'VARIANT_NONE_ACTIVE'));
assert.ok(blocked.issues.some((row) => row.code === 'MEDIA_IMAGE_MISSING'));
assert.ok(blocked.issues.some((row) => row.code === 'LISTING_NONE_ACTIVE'));

const query = catalogQualityQuerySchema.validate({ search: 'Rose', grade: 'A', readiness: 'ready', page: 1, limit: 20 });
assert.equal(query.error, undefined);
assert.ok(catalogQualityQuerySchema.validate({ limit: 101 }).error);
assert.ok(catalogQualityQuerySchema.validate({ issueCode: 'bad-code' }).error);
assert.equal(qualityMasterParamSchema.validate({ masterId }).error, undefined);
assert.ok(qualityMasterParamSchema.validate({ masterId: 'not-an-id' }).error);

console.log('catalog quality tests passed');
