import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleVariantLabel, serializeBundleComponents } from './bundleComponentUtils.js';

test('bundle variant labels prefer customer labels and describe option combinations', () => {
  assert.equal(bundleVariantLabel({ displayLabel: 'Midnight · 256 GB' }), 'Midnight · 256 GB');
  assert.equal(bundleVariantLabel({ optionValues: [{ name: 'Color', value: 'Blue' }, { code: 'size', value: 'M' }] }), 'Color: Blue · size: M');
});

test('bundle payload strips joined display records and normalizes numeric fields', () => {
  assert.deepEqual(serializeBundleComponents([{
    _id: 'row',
    componentMasterId: 'master-1',
    componentVariantId: 'variant-1',
    product: { title: 'Display only' },
    variant: { displayLabel: 'Display only' },
    quantity: '2',
    unitCode: 'piece',
    selectionGroup: 'included',
    required: true,
    defaultSelected: false,
    minSelections: '0',
    maxSelections: '2',
    priceAdjustment: '49.50',
    status: 'active',
  }]), [{
    componentMasterId: 'master-1',
    componentVariantId: 'variant-1',
    quantity: 2,
    unitCode: 'piece',
    selectionGroup: 'included',
    required: true,
    defaultSelected: false,
    minSelections: 0,
    maxSelections: 2,
    priceAdjustment: 49.5,
    status: 'active',
    sortOrder: 0,
  }]);
});

test('bundle payload rejects missing products, impossible ranges and duplicate identities', () => {
  assert.throws(() => serializeBundleComponents([{ quantity: 1, selectionGroup: 'included' }]), /needs a product/);
  assert.throws(() => serializeBundleComponents([{ componentMasterId: 'm1', quantity: 1, unitCode: 'piece', selectionGroup: 'included', minSelections: 2, maxSelections: 1 }]), /minimum greater/);
  const row = { componentMasterId: 'm1', componentVariantId: 'v1', quantity: 1, unitCode: 'piece', selectionGroup: 'included' };
  assert.throws(() => serializeBundleComponents([row, row]), /duplicates another/);
});
