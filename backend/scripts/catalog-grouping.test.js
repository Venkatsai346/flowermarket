import assert from 'node:assert/strict';
import catalogSearchService from '../src/services/catalogSearch.service.js';
import TenantProduct from '../src/models/tenantProduct.model.js';
import ProductVariant from '../src/models/productVariant.model.js';
import ProductImage from '../src/models/productImage.model.js';

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
