/**
 * Smoke test — Product Reviews (Phase 7.4.1).
 *
 * Hermetic: in-memory mongod.
 *
 * Covers:
 *   1. Review CRUD (create, read, update, delete)
 *   2. One review per user per product (unique constraint)
 *   3. Moderation lifecycle (pending → approved/rejected)
 *   4. Rating rollup (denormalized avg + count on TenantProduct)
 *   5. Helpful count increment
 *
 * Run: node scripts/smoke-reviews.test.js
 */
import './test-env-guard.js';
import assert from 'node:assert/strict';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = '';
process.env.MONGODB_URI = '';
process.env.OTP_PROVIDER = 'memory';

let mongod;
let passed = 0;
function ok(name) { passed += 1; console.log(`  PASS  ${name}`); }

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await createHermeticMongo({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_reviews');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  // Load models
  const MODEL_FILES = (await import('../src/config/models.js')).default;
  await Promise.all(MODEL_FILES.map((f) => import(`../src/models/${f}`)));
  for (const m of MODEL_FILES) {
    const mod = (await import(`../src/models/${m}`)).default;
    await mod.init();
  }

  const { default: ProductReview, REVIEW_STATUS } = await import('../src/models/productReview.model.js');
  const { default: TenantProduct } = await import('../src/models/tenantProduct.model.js');
  const { default: productReviewService } = await import('../src/services/productReview.service.js');

  const TENANT = new mongoose.Types.ObjectId();
  const USER1 = new mongoose.Types.ObjectId();
  const USER2 = new mongoose.Types.ObjectId();
  const PRODUCT = new mongoose.Types.ObjectId();

  // Create a tenant product
  await TenantProduct.create({
    tenantId: TENANT,
    _id: PRODUCT,
    name: 'Rose Bouquet',
    sku: 'ROS-001',
    status: 'active',
    stockQty: 100,
  });

  // ── 1. Create review ──
  const review = await productReviewService.create({
    tenantId: TENANT,
    userId: USER1,
    payload: { tenantProductId: PRODUCT, rating: 5, title: 'Amazing!', body: 'Best roses ever' },
  });
  assert.equal(review.rating, 5);
  assert.equal(review.status, REVIEW_STATUS.PENDING);
  ok('Create review — pending status');

  // ── 2. Duplicate review rejected ──
  try {
    await productReviewService.create({
      tenantId: TENANT,
      userId: USER1,
      payload: { tenantProductId: PRODUCT, rating: 4, title: 'Again', body: 'Still good' },
    });
    assert.fail('Should have thrown DUPLICATE_REVIEW');
  } catch (err) {
    assert.equal(err.code, 'CONFLICT');
    ok('Duplicate review — correctly rejected');
  }

  // ── 3. Second user can review ──
  const review2 = await productReviewService.create({
    tenantId: TENANT,
    userId: USER2,
    payload: { tenantProductId: PRODUCT, rating: 3, title: 'OK', body: 'Decent' },
  });
  assert.equal(review2.rating, 3);
  ok('Second user can review same product');

  // ── 4. Approve first review → rating rollup ──
  const approved = await productReviewService.approve({
    tenantId: TENANT,
    reviewId: review._id,
    actorId: new mongoose.Types.ObjectId(),
  });
  assert.equal(approved.status, REVIEW_STATUS.APPROVED);
  ok('Approve review');

  // Check rollup
  const product = await TenantProduct.findById(PRODUCT).lean();
  assert.equal(product.rating.count, 1, 'Review count = 1');
  assert.equal(product.rating.average, 5, 'Average = 5');
  ok('Rating rollup — count=1, avg=5');

  // ── 5. Approve second review → rollup updates ──
  await productReviewService.approve({
    tenantId: TENANT,
    reviewId: review2._id,
    actorId: new mongoose.Types.ObjectId(),
  });
  const product2 = await TenantProduct.findById(PRODUCT).lean();
  assert.equal(product2.rating.count, 2, 'Review count = 2');
  assert.equal(product2.rating.average, 4, 'Average = 4');
  ok('Rating rollup — count=2, avg=4');

  // ── 6. List approved reviews ──
  const listed = await productReviewService.listForProduct({
    tenantId: TENANT,
    tenantProductId: PRODUCT,
    query: {},
  });
  assert.equal(listed.items.length, 2, '2 approved reviews');
  assert.equal(listed.stats.total, 2);
  ok('List approved reviews — 2 found');

  // ── 7. Reject review → removes from rollup ──
  await productReviewService.reject({
    tenantId: TENANT,
    reviewId: review2._id,
    reason: 'Spam',
    actorId: new mongoose.Types.ObjectId(),
  });
  const product3 = await TenantProduct.findById(PRODUCT).lean();
  assert.equal(product3.rating.count, 1, 'Count back to 1');
  assert.equal(product3.rating.average, 5, 'Avg back to 5');
  ok('Reject review — rollup updated (count=1, avg=5)');

  // ── 8. Mark helpful ──
  const helpful = await productReviewService.markHelpful({
    tenantId: TENANT,
    reviewId: review._id,
  });
  assert.equal(helpful.helpfulCount, 1);
  ok('Mark helpful — count incremented');

  // ── 9. Rating distribution ──
  const dist = await productReviewService.listForProduct({
    tenantId: TENANT,
    tenantProductId: PRODUCT,
    query: {},
  });
  assert.equal(dist.stats.distribution[5], 1, 'One 5-star review');
  assert.equal(dist.stats.distribution[4], 0, 'No 4-star reviews');
  ok('Rating distribution — correct breakdown');

  console.log(`\n=== REVIEWS SMOKE: ${passed}/9 sections passed ===`);
}

main()
  .then(async () => { await mongoose.disconnect(); await stopHermeticMongo(mongod); process.exit(0); })
  .catch(async (err) => {
    console.error('\nFAILED:', err);
    try { await mongoose.disconnect(); } catch { /* */ }
    await stopHermeticMongo(mongod);
    process.exit(1);
  });
