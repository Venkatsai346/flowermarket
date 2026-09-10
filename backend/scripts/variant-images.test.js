/**
 * variant-images unit test — the pure gallery-resolution contract.
 *
 * A variant shows its OWN photos when any exist, else the master gallery.
 * Every case here is a pure function call — no DB, no network.
 *
 * Run: node scripts/variant-images.test.js
 */
import assert from 'node:assert/strict';
import {
  groupImagesByVariant,
  resolveImagesForVariant,
  primaryImageUrlFor,
  attachVariantGalleries,
  variantDisplayLabel,
  pickDefaultVariant,
  sortGallery,
} from '../src/utils/catalog/variantImages.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

// A polo master: 2 master photos + red has its own shoot, white has none.
const M1 = { _id: 'm1', url: 'master-1.jpg', altText: 'Polo', isPrimary: true, sortOrder: 0, variantId: null, status: 'active' };
const M2 = { _id: 'm2', url: 'master-2.jpg', altText: 'Polo back', isPrimary: false, sortOrder: 1, variantId: null, status: 'active' };
const R1 = { _id: 'r1', url: 'red-1.jpg', altText: 'Red polo', isPrimary: true, sortOrder: 0, variantId: 'v-red', status: 'active' };
const R2 = { _id: 'r2', url: 'red-2.jpg', altText: 'Red detail', isPrimary: false, sortOrder: 1, variantId: 'v-red', status: 'active' };
const DEAD = { _id: 'x1', url: 'dead.jpg', isPrimary: false, sortOrder: 0, variantId: 'v-red', status: 'inactive' };
const GONE = { _id: 'x2', url: 'gone.jpg', isPrimary: false, sortOrder: 0, variantId: 'v-red', status: 'active', isDeleted: true };
const flat = [M1, M2, R1, R2, DEAD, GONE];

// ---- grouping ----
{
  const { master, byVariant } = groupImagesByVariant(flat);
  assert.deepEqual(master.map((i) => i._id), ['m1', 'm2']);
  assert.deepEqual(byVariant.get('v-red').map((i) => i._id), ['r1', 'r2']);
  assert.equal(byVariant.has('v-white'), false);
  ok('groupImagesByVariant splits master vs variant galleries, drops inactive/soft-deleted');
}

// ---- resolution ----
{
  const red = resolveImagesForVariant(flat, 'v-red');
  assert.equal(red.source, 'variant');
  assert.deepEqual(red.images.map((i) => i.url), ['red-1.jpg', 'red-2.jpg']);
  ok('variant with its own shoot resolves to variant gallery, primary first');
}
{
  const white = resolveImagesForVariant(flat, 'v-white');
  assert.equal(white.source, 'master');
  assert.deepEqual(white.images.map((i) => i.url), ['master-1.jpg', 'master-2.jpg']);
  ok('variant without photos falls back to the master gallery');
}
{
  const none = resolveImagesForVariant([], 'v-red');
  assert.deepEqual(none.images, []);
  assert.equal(none.source, 'master');
  assert.equal(primaryImageUrlFor([], 'v-red'), null);
  ok('no photos anywhere resolves to an empty gallery (never throws)');
}
{
  assert.equal(primaryImageUrlFor(flat, 'v-red'), 'red-1.jpg');
  assert.equal(primaryImageUrlFor(flat, 'v-white'), 'master-1.jpg');
  ok('primaryImageUrlFor picks the scoped primary for cards/snapshots/index');
}

// ---- ordering ----
{
  const shuffled = [R2, M2, R1, M1];
  assert.deepEqual(sortGallery(shuffled.filter((i) => !i.variantId)).map((i) => i._id), ['m1', 'm2']);
  ok('sortGallery orders primary-first then sortOrder');
}

// ---- batch attach (getMaster / PDP) ----
{
  const variants = [
    { _id: 'v-red', value: 'red', displayLabel: 'Crimson Red', sortOrder: 0, isDefault: true },
    { _id: 'v-white', value: 'white', displayLabel: null, sortOrder: 1, isDefault: false },
  ];
  const out = attachVariantGalleries(variants, flat);
  assert.equal(out[0].imageSource, 'variant');
  assert.equal(out[0].primaryImageUrl, 'red-1.jpg');
  assert.equal(out[0].images.length, 2);
  assert.equal(out[1].imageSource, 'master');
  assert.equal(out[1].primaryImageUrl, 'master-1.jpg');
  assert.equal(out[1].images.length, 2);
  ok('attachVariantGalleries resolves every variant in one pass with source flags');
}

// ---- labels + default pick ----
{
  assert.equal(variantDisplayLabel({ value: 'red', displayLabel: 'Crimson Red' }), 'Crimson Red');
  assert.equal(variantDisplayLabel({ value: 'red', displayLabel: null }), 'red');
  assert.equal(variantDisplayLabel(null), '');
  ok('variantDisplayLabel prefers displayLabel, falls back to value');
}
{
  const rows = [
    { variant: { value: 'white', sortOrder: 1, isDefault: false }, stockQty: 5 },
    { variant: { value: 'red', sortOrder: 0, isDefault: true }, stockQty: 0 },
    { variant: { value: 'black', sortOrder: 2, isDefault: false }, stockQty: 3 },
  ];
  assert.equal(pickDefaultVariant(rows).variant.value, 'red');
  assert.equal(pickDefaultVariant(rows.map((r) => ({ ...r, variant: { ...r.variant, isDefault: false } }))).variant.value, 'white');
  assert.equal(pickDefaultVariant([]), null);
  ok('pickDefaultVariant prefers isDefault, then in-stock, then first');
}

console.log(`\nvariant-images: ${pass} assertions passed`);
