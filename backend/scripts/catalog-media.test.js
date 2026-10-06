import assert from 'node:assert/strict';
import catalogMediaService from '../src/services/catalogMedia.service.js';
import ProductMaster from '../src/models/productMaster.model.js';
import {
  mediaOperationsQuerySchema,
  mediaAssetUpdateSchema,
  mediaGalleryOrderSchema,
} from '../src/utils/validators/catalog.validators.js';

const masterId = '66a000000000000000000001';
const imageId = '66a000000000000000000002';

assert.equal(mediaOperationsQuerySchema.validate({ issue: 'missing_alt', sort: 'priority', page: 1, limit: 20 }).error, undefined);
assert.ok(mediaOperationsQuerySchema.validate({ issue: 'unknown' }).error);
assert.ok(mediaOperationsQuerySchema.validate({ limit: 101 }).error);
assert.equal(mediaAssetUpdateSchema.validate({ altText: 'Front view of a red rose bouquet', width: 1200, height: 1200, expectedVersion: 2 }).error, undefined);
assert.ok(mediaAssetUpdateSchema.validate({ expectedVersion: 2 }).error, 'metadata update requires at least one changed field');
assert.ok(mediaAssetUpdateSchema.validate({ focalPoint: { x: 2, y: 0.5 }, expectedVersion: 2 }).error);
assert.equal(mediaGalleryOrderSchema.validate({ items: [{ imageId, sortOrder: 0 }], expectedVersion: 3 }).error, undefined);
assert.ok(mediaGalleryOrderSchema.validate({ items: [], expectedVersion: 3 }).error);
assert.ok(mediaGalleryOrderSchema.validate({ items: [{ imageId: masterId, sortOrder: -1 }], expectedVersion: 3 }).error);

const originalAggregate = ProductMaster.aggregate;
try {
  let summaryPipeline;
  ProductMaster.aggregate = (pipeline) => {
    summaryPipeline = pipeline;
    return { allowDiskUse: async () => [{ families: 10, assets: 24, noMedia: 2, noPrimary: 1, primaryConflicts: 0, missingAlt: 4, unmeasured: 3, lowResolution: 2, uncoveredVariants: 5, healthyFamilies: 3, averageScore: 78.6 }] };
  };
  const summary = await catalogMediaService.summary();
  assert.equal(summary.families, 10);
  assert.equal(summary.averageScore, 79);
  assert.equal(summary.missingAlt, 4);
  assert.ok(summaryPipeline.some((stage) => stage.$lookup?.from === 'productimages'));
  assert.ok(summaryPipeline.some((stage) => stage.$lookup?.from === 'productvariants'));

  let listPipeline;
  ProductMaster.aggregate = (pipeline) => {
    listPipeline = pipeline;
    return { allowDiskUse: async () => [{ items: [{ _id: masterId, mediaScore: 40 }], count: [{ value: 21 }] }] };
  };
  const page = await catalogMediaService.listFamilies({ query: { search: 'rose', issue: 'no_media', page: 2, limit: 10 } });
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.meta, { page: 2, limit: 10, total: 21, totalPages: 3, hasMore: true });
  assert.ok(listPipeline.some((stage) => stage.$match?.noMedia === true), 'issue filter is applied after evidence calculation');
  const facet = listPipeline.find((stage) => stage.$facet)?.$facet;
  assert.equal(facet.items[0].$skip, 10);
  assert.equal(facet.items[1].$limit, 10);
} finally {
  ProductMaster.aggregate = originalAggregate;
}

console.log('catalog media operations tests passed');
