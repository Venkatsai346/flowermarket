import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVariantForOption, selectedOptionValues, variantOptionState } from './productVariants.js';

const family = [
  { listingId: 'a', stockQty: 8, sortOrder: 0, isDefault: true, price: { sellingPrice: 449 }, optionValues: [
    { code: 'pot_size', value: '5 inch' }, { code: 'plant_height', value: '20 cm' }, { code: 'pot_color', value: 'White' },
  ] },
  { listingId: 'b', stockQty: 5, sortOrder: 1, price: { sellingPrice: 599 }, optionValues: [
    { code: 'pot_size', value: '7 inch' }, { code: 'plant_height', value: '35 cm' }, { code: 'pot_color', value: 'Terracotta' },
  ] },
  { listingId: 'c', stockQty: 0, sortOrder: 2, price: { sellingPrice: 749 }, optionValues: [
    { code: 'pot_size', value: '10 inch' }, { code: 'plant_height', value: '50 cm' }, { code: 'pot_color', value: 'Black' },
  ] },
];

test('sparse option clicks move to a valid variant instead of becoming disabled', () => {
  assert.equal(resolveVariantForOption(family, family[0], 'pot_size', '7 inch')?.listingId, 'b');
  assert.deepEqual(selectedOptionValues(family[1]), {
    pot_size: '7 inch', plant_height: '35 cm', pot_color: 'Terracotta',
  });
});

test('option state distinguishes absent combinations from sold-out variants', () => {
  assert.deepEqual(variantOptionState(family, 'pot_size', '10 inch'), {
    exists: true, inStock: false, candidates: [family[2]], fromPrice: 749,
  });
  assert.equal(variantOptionState(family, 'pot_size', '12 inch').exists, false);
});

test('resolver keeps the maximum number of selected dimensions and prefers stock', () => {
  const alternatives = [
    ...family,
    { listingId: 'd', stockQty: 4, sortOrder: 3, optionValues: [
      { code: 'pot_size', value: '7 inch' }, { code: 'plant_height', value: '20 cm' }, { code: 'pot_color', value: 'White' },
    ] },
  ];
  assert.equal(resolveVariantForOption(alternatives, family[0], 'pot_size', '7 inch')?.listingId, 'd');
});
