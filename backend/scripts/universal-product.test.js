import assert from 'node:assert/strict';
import {
  normalizeOptionDefinitions,
  normalizeOptionValues,
  combinationKey,
  normalizeMeasurements,
} from '../src/utils/catalog/productStructure.js';
import ProductVariant from '../src/models/productVariant.model.js';
import ProductPackage from '../src/models/productPackage.model.js';
import ProductBundleComponent from '../src/models/productBundleComponent.model.js';
import ProductCompliance from '../src/models/productCompliance.model.js';
import { normalizeUnitPolicy, convertQuantity, assertQuantity } from '../src/utils/catalog/unitConversion.js';
import { normalizeOptionRules, evaluateOptionCombination } from '../src/utils/catalog/optionDependencies.js';
import { assertUniversalVariantIndexContract } from '../src/utils/catalog/indexContracts.js';

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

const unitPolicy = normalizeUnitPolicy({
  dimension: 'mass', baseUnit: 'kg', allowFractional: true, precision: 3,
  units: [
    { code: 'kg', label: 'Kilogram', toBaseFactor: 1, precision: 3 },
    { code: 'g', label: 'Gram', toBaseFactor: 0.001, precision: 0 },
  ],
});
assert.equal(convertQuantity(500, 'g', 'kg', unitPolicy), 0.5);
assert.equal(convertQuantity(2, 'kg', 'g', unitPolicy), 2000);
assert.equal(assertQuantity(0.25, 'kg', unitPolicy), 0.25);
assert.throws(() => assertQuantity(1.5, 'piece', normalizeUnitPolicy(null, 'piece')), (err) => err.code === 'FRACTIONAL_QUANTITY_NOT_ALLOWED');
assert.throws(() => normalizeUnitPolicy({ dimension: 'mass', baseUnit: 'kg', units: [{ code: 'kg', label: 'Kilogram', toBaseFactor: 1000 }] }), (err) => err.code === 'UNIT_BASE_FACTOR_INVALID');

const optionRules = normalizeOptionRules([{
  code: 'red_sizes', when: { code: 'color', values: ['Red'] },
  then: { code: 'size', allowedValues: ['S', 'M'], excludedValues: [] },
}], options);
assert.equal(evaluateOptionCombination(a, optionRules).valid, true);
assert.equal(evaluateOptionCombination([{ code: 'color', value: 'Red' }, { code: 'size', value: 'L' }], optionRules).valid, false);
assert.throws(() => normalizeOptionRules([{ when: { code: 'color', values: ['Green'] }, then: { code: 'size' } }], options), (err) => err.code === 'OPTION_RULE_VALUE_INVALID');

const packageRow = new ProductPackage({
  productMasterId: '507f1f77bcf86cd799439011', code: 'case', label: 'Case', level: 'case', quantity: 12, unitCode: 'piece',
});
assert.equal(packageRow.validateSync(), undefined);
const component = new ProductBundleComponent({
  bundleMasterId: '507f1f77bcf86cd799439011', componentMasterId: '507f191e810c19729de860ea', quantity: 1, unitCode: 'piece',
});
assert.equal(component.validateSync(), undefined);
const compliance = new ProductCompliance({
  productMasterId: '507f1f77bcf86cd799439011', type: 'certificate', code: 'BIS-123', title: 'BIS conformity', status: 'verified', issuerReference: 'BIS/2026/123',
});
assert.equal(compliance.validateSync(), undefined);

const connectionWithIndexes = (indexes) => ({ collection: () => ({ indexes: async () => indexes }) });
await assertUniversalVariantIndexContract(connectionWithIndexes([{
  name: 'productMasterId_1_variantType_1_value_1',
  key: { productMasterId: 1, variantType: 1, value: 1 },
  unique: false,
}]));
await assert.rejects(
  assertUniversalVariantIndexContract(connectionWithIndexes([{
    name: 'productMasterId_1_variantType_1_value_1',
    key: { productMasterId: 1, variantType: 1, value: 1 },
    unique: true,
  }])),
  /Database schema is stale.*npm run db:migrate/s,
);
await assertUniversalVariantIndexContract({
  collection: () => ({ indexes: async () => { const error = new Error('namespace missing'); error.code = 26; throw error; } }),
});

console.log('UNIVERSAL PRODUCT STRUCTURE: all invariants passed ✔'); // eslint-disable-line no-console
