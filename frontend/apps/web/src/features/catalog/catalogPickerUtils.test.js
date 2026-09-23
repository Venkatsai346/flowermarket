import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCategoryTree, filterCategoryTree, resolveSelectedBrand,
} from './catalogPickerUtils.js';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones', parentId: 'electronics', sortOrder: 2 },
  { id: 'root', name: 'Catalog', sortOrder: 1 },
  { id: 'electronics', name: 'Electronics', parentId: { id: 'root' }, sortOrder: 1 },
  { id: 'cases', name: 'Phone Cases', parentId: 'electronics', sortOrder: 1 },
];

describe('catalog picker utilities', () => {
  it('builds a deterministic taxonomy with full paths and leaf state', () => {
    const tree = buildCategoryTree(categories);
    assert.deepEqual(tree.map((item) => item.id), ['root', 'electronics', 'cases', 'phones']);
    assert.equal(tree.find((item) => item.id === 'phones').path, 'Catalog / Electronics / Smartphones');
    assert.equal(tree.find((item) => item.id === 'electronics').isLeaf, false);
    assert.equal(tree.find((item) => item.id === 'cases').isLeaf, true);
  });

  it('searches full taxonomy paths while keeping parent categories unselectable', () => {
    const tree = buildCategoryTree(categories);
    const matches = filterCategoryTree(tree, 'catalog electronics');
    assert.deepEqual(matches.map((item) => item.id), ['electronics', 'cases', 'phones']);
    assert.equal(matches[0].disabled, true);
    assert.equal(matches[1].disabled, false);
  });

  it('retains a chosen or edited brand outside the current registry page', () => {
    const selectedLocal = { id: 'brand-341', name: 'Registry Tail' };
    assert.equal(resolveSelectedBrand({
      value: 'brand-341', remote: [], loaded: [{ id: 'brand-1', name: 'First' }], selectedLocal,
    }).name, 'Registry Tail');

    const selectedBrand = { id: 'legacy', name: 'Legacy Brand' };
    assert.equal(resolveSelectedBrand({
      value: 'legacy', remote: null, loaded: [], selectedBrand,
    }).name, 'Legacy Brand');
  });
});
