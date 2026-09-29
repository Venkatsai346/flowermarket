import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import catalogSearchService from '../src/services/catalogSearch.service.js';

const oid = (suffix) => new mongoose.Types.ObjectId(`66b00000000000000000${suffix}`);
const tenantId = oid('0001');
const actorId = oid('0002');
const rootId = oid('0010');
const leafId = oid('0011');
const masterIds = [oid('0101'), oid('0102'), oid('0103')];
const now = new Date('2026-09-29T00:00:00.000Z');

let mongod = null;
let mongoUri = process.env.MONGODB_URI || null;
if (!mongoUri) {
  try {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri();
  } catch (error) {
    if (error?.name === 'DownloadError' || error?.code === 'ECONNRESET') {
      console.log('catalog family pagination: SKIP (local mongod binary unavailable; CI runs against its MongoDB service)');
      process.exit(0);
    }
    throw error;
  }
}

try {
  await mongoose.connect(mongoUri, { dbName: 'catalog-family-pagination' });
  const db = mongoose.connection.db;
  await db.dropDatabase();

  await db.collection('categories').insertMany([
    { _id: rootId, name: 'Food', slug: 'food', parentId: null, status: 'active', isDeleted: false },
    { _id: leafId, name: 'Fruit', slug: 'fruit', parentId: rootId, status: 'active', isDeleted: false },
  ]);
  await db.collection('productmasters').insertMany(masterIds.map((id, index) => ({
    _id: id,
    title: `Family ${index + 1}`,
    slug: `family-${index + 1}`,
    skuGlobal: `FAMILY-${index + 1}`,
    searchText: `family ${index + 1}`,
    categoryId: leafId,
    status: 'active',
    complianceStatus: 'approved',
    soldCount: 30 - (index * 10),
    isDeleted: false,
    createdAt: new Date(now.getTime() + index),
  })));

  const variants = [];
  const listings = [];
  const variantCounts = [3, 1, 1];
  let sequence = 0;
  for (let family = 0; family < masterIds.length; family += 1) {
    for (let variant = 0; variant < variantCounts[family]; variant += 1) {
      sequence += 1;
      const variantId = oid(String(1000 + sequence).padStart(4, '0'));
      variants.push({
        _id: variantId,
        productMasterId: masterIds[family],
        value: `${variant + 1} kg`,
        displayLabel: `${variant + 1} kg`,
        sortOrder: variant,
        isDefault: variant === 0,
        status: 'active',
        isDeleted: false,
      });
      listings.push({
        _id: oid(String(2000 + sequence).padStart(4, '0')),
        tenantId,
        productMasterId: masterIds[family],
        variantId,
        price: { sellingPrice: 10 + (family * 20) + variant, currency: 'INR' },
        priceBasis: { quantity: 1, unitCode: 'kg' },
        stockQty: family === 1 ? 0 : 5,
        status: 'active',
        channels: { storefront: true },
        merchandising: { featured: false, searchBoost: 0 },
        isDeleted: false,
        createdAt: new Date(now.getTime() + sequence),
        createdBy: actorId,
      });
    }
  }
  await db.collection('productvariants').insertMany(variants);
  await db.collection('tenantproducts').insertMany(listings);

  const first = await catalogSearchService.searchGrouped({
    tenantId,
    query: { groupBy: 'master', categoryId: rootId, sort: 'popularity', limit: 2 },
  });
  assert.deepEqual(first.items.map((item) => item.masterId), masterIds.slice(0, 2).map(String));
  assert.equal(first.items[0].variants.length, 3, 'a family must never split at a page boundary');
  assert.equal(first.meta.total, 3, 'total counts masters, not five variant listings');
  assert.equal(first.meta.facets.categories[0].count, 3, 'facets count each family once');
  assert.equal(first.meta.facets.inStock, 2);
  assert.equal(first.meta.facets.outOfStock, 1);
  assert.equal(first.meta.hasMore, true);
  assert.ok(first.meta.nextCursor);

  const second = await catalogSearchService.searchGrouped({
    tenantId,
    query: {
      groupBy: 'master', categoryId: rootId, sort: 'popularity', limit: 2,
      cursor: first.meta.nextCursor,
    },
  });
  assert.deepEqual(second.items.map((item) => item.masterId), [String(masterIds[2])]);
  assert.equal(second.meta.hasMore, false);
  assert.equal(second.meta.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.masterId)).size, 3);

  const inStock = await catalogSearchService.searchGrouped({
    tenantId,
    query: { groupBy: 'master', categoryId: rootId, inStock: true, limit: 10 },
  });
  assert.equal(inStock.meta.total, 2);
  assert.equal(inStock.items.every((item) => item.inStockCount > 0), true);

  console.log('catalog family pagination: master totals, descendant scope, facets and cursor PASS');
} finally {
  if (mongoose.connection.readyState) await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}
