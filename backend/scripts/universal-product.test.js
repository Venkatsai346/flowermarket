import assert from 'node:assert/strict';
import {
  normalizeOptionDefinitions,
  normalizeOptionValues,
  combinationKey,
  normalizeMeasurements,
} from '../src/utils/catalog/productStructure.js';
import ProductVariant from '../src/models/productVariant.model.js';

const options = normalizeOptionDefinitions([
  { name: 'Color', values: ['Red', 'Blue'] },
  { code: 'size', name: 'Size', values: ['S', 'M', 'L'] },
]);
assert.deepEqual(options.map((o) => o.code), ['color', 'size']);

const a = normalizeOptionValues([
  { code: 'size', value: 'M' },
  { code: 'color', value: 'Red' },
], options);
const b = normalizeOptionValues([
  { code: 'color', value: 'Red' },
  { code: 'size', value: 'M' },
], options);
assert.equal(combinationKey(a), combinationKey(b), 'combination identity must be order-independent');
assert.equal(combinationKey(a), 'color=red&size=m');

assert.throws(
  () => normalizeOptionValues([{ code: 'color', value: 'Green' }], options),
  (err) => err.code === 'VARIANT_OPTION_VALUE_INVALID',
);
assert.throws(
  () => normalizeOptionValues([{ code: 'material', value: 'Cotton' }], options),
  (err) => err.code === 'VARIANT_OPTION_UNKNOWN',
);
assert.throws(
  () => normalizeOptionValues([{ code: 'size', value: 'M' }, { code: 'size', value: 'L' }], options),
  (err) => err.code === 'VARIANT_OPTION_DUPLICATE',
);

assert.deepEqual(normalizeMeasurements({ weight: { value: '250', unit: 'g' } }).weight, { value: 250, unit: 'g' });
assert.throws(() => normalizeMeasurements({ weight: { value: -1 } }), (err) => err.code === 'MEASUREMENT_INVALID');

const variant = new ProductVariant({
  productMasterId: '507f1f77bcf86cd799439011',
  optionValues: b,
});
await variant.validate();
assert.equal(variant.combinationKey, 'color=red&size=m');
assert.equal(variant.displayLabel, 'Red / M');

const legacy = new ProductVariant({
  productMasterId: '507f1f77bcf86cd799439011',
  variantType: 'weight',
  value: '500 g',
});
await legacy.validate();
assert.equal(legacy.combinationKey, 'weight=500%20g');

console.log('UNIVERSAL PRODUCT STRUCTURE: all invariants passed ✔'); // eslint-disable-line no-console
