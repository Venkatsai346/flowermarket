import assert from 'node:assert/strict';
import { publicBundleComponents } from '../src/utils/catalog/publicBundle.js';

const active = {
  _id: 'component-1',
  componentMasterId: 'master-1',
  componentVariantId: 'variant-1',
  quantity: 2,
  unitCode: 'piece',
  selectionGroup: 'included',
  required: true,
  defaultSelected: true,
  minSelections: 1,
  maxSelections: 1,
  priceAdjustment: 0,
  sortOrder: 0,
  status: 'active',
  createdBy: 'private-actor',
  product: {
    _id: 'master-1', title: 'Travel charger', slug: 'travel-charger', kind: 'physical', type: 'electronics',
    shortDescription: 'Compact fast charger.', manufacturer: 'Acme', modelNumber: 'AC-20', defaultSellingUnit: 'piece',
    imageUrl: 'https://cdn.example/product.jpg', searchText: 'private denormalized search text',
  },
  variant: {
    _id: 'variant-1', displayLabel: 'Black · 20 W', value: 'Black', combinationKey: 'color=Black|power=20W',
    optionValues: [{ code: 'color', name: 'Color', value: 'Black' }], sku: 'PRIVATE-SKU',
  },
  media: { url: 'https://cdn.example/variant.jpg', altText: 'Black charger', mediaType: 'image', source: 'variant', checksum: 'private' },
};

const projected = publicBundleComponents([active, { ...active, _id: 'component-2', status: 'archived' }]);
assert.equal(projected.length, 1, 'inactive bundle options never reach the storefront');
assert.equal(projected[0].product.title, 'Travel charger');
assert.equal(projected[0].variant.displayLabel, 'Black · 20 W');
assert.equal(projected[0].media.source, 'variant');
assert.equal(projected[0].product.searchText, undefined, 'internal search fields are stripped');
assert.equal(projected[0].variant.sku, undefined, 'internal component SKU is stripped');
assert.equal(projected[0].media.checksum, undefined, 'private media metadata is stripped');
assert.equal(projected[0].createdBy, undefined, 'audit ownership is stripped');

console.log('bundle public projection: 8 assertions passed ✔'); // eslint-disable-line no-console
