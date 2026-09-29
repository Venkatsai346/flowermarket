import assert from 'node:assert/strict';
import catalogSearchService from '../src/services/catalogSearch.service.js';
import TenantProduct from '../src/models/tenantProduct.model.js';
import ProductVariant from '../src/models/productVariant.model.js';
import ProductImage from '../src/models/productImage.model.js';
import ProductMaster from '../src/models/productMaster.model.js';
import Category from '../src/models/category.model.js';
import productMasterService from '../src/services/productMaster.service.js';

const masterId = '66a000000000000000000001';
const listingId = '66a000000000000000000002';
const variantId = '66a000000000000000000003';
const tenantId = '66a000000000000000000004';

const originals = {
  tenantFind: TenantProduct.find,
  variantFind: ProductVariant.find,
  imageFind: ProductImage.find,
};

try {
  let tenantQuery = null;
  TenantProduct.find = (query) => {
    tenantQuery = query;
    return {
      select: () => ({
        lean: async () => [{
          _id: listingId,
          productMasterId: masterId,
          variantId,
          price: { sellingPrice: 125, mrp: 150 },
          priceBasis: { quantity: 1, unitCode: 'piece' },
          stockQty: 3,
          availability: { status: 'in_stock' },
        }],
      }),
    };
  };
  ProductVariant.find = () => ({
    lean: async () => [{
      _id: variantId,
      productMasterId: masterId,
      value: 'Standard',
      sku: 'VAR-001',
      sortOrder: 0,
      isDefault: true,
      status: 'active',
    }],
  });
  // Regression: seeded products intentionally have no media. Grouping must
  // return a card with a null image instead of reading index 0 of undefined.
  ProductImage.find = () => ({ sort: () => ({ lean: async () => [] }) });

  const cards = await catalogSearchService.groupListingRows({
    tenantId,
    rows: [{
      listingId,
      variantId,
      product: { id: masterId, title: 'Media-free reference product', imageUrl: null },
      price: { sellingPrice: 125 },
    }],
  });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].product.imageUrl, null);
  assert.equal(cards[0].defaultListingId, listingId);
  assert.equal(cards[0].variants.length, 1);
  assert.equal(cards[0].variants[0].priceBasis.unitCode, 'piece');
  assert.equal(tenantQuery.status, 'active');
  assert.equal(tenantQuery['channels.storefront'].$ne, false);
  assert.equal(tenantQuery['price.sellingPrice'].$ne, null);
  console.log('catalog grouping: media-free and storefront-gated card PASS');
} finally {
  TenantProduct.find = originals.tenantFind;
  ProductVariant.find = originals.variantFind;
  ProductImage.find = originals.imageFind;
}

const originalMasterFind = ProductMaster.find;
const originalMasterCount = ProductMaster.countDocuments;
try {
  let captured = null;
  ProductMaster.find = (query) => {
    captured = query;
    return {
      sort: () => ({
        skip: () => ({
          limit: () => ({ lean: async () => [] }),
        }),
      }),
    };
  };
  ProductMaster.countDocuments = async () => 0;

  const result = await productMasterService.listMasters({
    query: { search: 'ap(ple)+[x]', page: 1, limit: 20 },
  });
  assert.equal(result.meta.total, 0);
  assert.equal(captured.$or.length, 3);
  for (const clause of captured.$or) {
    const rx = Object.values(clause)[0];
    assert.ok(rx instanceof RegExp);
    assert.equal(rx.test('AP(PLE)+[X] reference'), true);
    assert.equal(rx.test('appleeeeeex'), false);
  }
  console.log('product master search: imported literal matcher and regex-safe query PASS');
} finally {
  ProductMaster.find = originalMasterFind;
  ProductMaster.countDocuments = originalMasterCount;
}

// Product-family pagination contract: aggregate/group happens before facet and
// the continuation cursor uses keyset matching rather than skip arithmetic.
const originalTenantAggregate = TenantProduct.aggregate;
const originalCategoryAggregate = Category.aggregate;
const originalCategoryFind = Category.find;
const originalGrouping = catalogSearchService.groupListingRows;
try {
  const masters = [
    '66a000000000000000000011',
    '66a000000000000000000012',
    '66a000000000000000000013',
  ];
  let capturedPipeline = null;
  Category.aggregate = async () => [{ ids: ['66a000000000000000000099'] }];
  Category.find = () => ({ select: () => ({ lean: async () => [{ _id: '66a000000000000000000099', name: 'Leaf' }] }) });
  TenantProduct.aggregate = async (pipeline) => {
    capturedPipeline = pipeline;
    return [{
      items: masters.map((id, index) => ({
        _id: id,
        _sort: 100 - index,
        master: { _id: id, title: `Master ${index}`, categoryId: '66a000000000000000000099' },
      })),
      total: [{ count: 3 }],
      categories: [{ _id: '66a000000000000000000099', count: 3 }],
      availability: [{ _id: 1, count: 2 }, { _id: 0, count: 1 }],
      price: [{ min: 10, max: 90 }],
    }];
  };
  catalogSearchService.groupListingRows = async ({ rows }) => rows.map((row) => ({
    masterId: row.product.id,
    product: row.product,
    variants: [{ listingId: `listing-${row.product.id}` }],
  }));

  const first = await catalogSearchService.searchGrouped({
    tenantId,
    query: { groupBy: 'master', categoryId: '66a000000000000000000099', sort: 'popularity', limit: 2 },
  });
  assert.equal(first.items.length, 2);
  assert.equal(first.meta.total, 3);
  assert.equal(first.meta.hasMore, true);
  assert.equal(first.meta.pagination, 'master_cursor');
  assert.ok(first.meta.nextCursor);
  assert.equal(first.meta.facets.categories[0].count, 3);
  const groupIndex = capturedPipeline.findIndex((stage) => stage.$group?._id === '$master._id');
  const facetIndex = capturedPipeline.findIndex((stage) => stage.$facet);
  assert.ok(groupIndex >= 0 && facetIndex > groupIndex, 'master grouping must precede pagination facets');
  assert.equal(capturedPipeline[facetIndex].$facet.items.some((stage) => Object.hasOwn(stage, '$skip')), true);

  await catalogSearchService.searchGrouped({
    tenantId,
    query: { groupBy: 'master', categoryId: '66a000000000000000000099', sort: 'popularity', limit: 2, cursor: first.meta.nextCursor },
  });
  const cursorFacet = capturedPipeline.find((stage) => stage.$facet);
  assert.equal(cursorFacet.$facet.items.some((stage) => stage.$skip), false);
  assert.equal(Boolean(cursorFacet.$facet.items[0].$match?.$or), true);
  console.log('catalog grouping: master-first facets and stable keyset cursor PASS');
} finally {
  TenantProduct.aggregate = originalTenantAggregate;
  Category.aggregate = originalCategoryAggregate;
  Category.find = originalCategoryFind;
  catalogSearchService.groupListingRows = originalGrouping;
}
