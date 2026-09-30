import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWishlist, wishlistIdentity } from './useWishlist.js';

test('wishlist identity isolates variants of the same product', () => {
  assert.equal(wishlistIdentity({ slug: 'peace-lily', variantId: 'v1' }), 'peace-lily::variant:v1');
  assert.equal(wishlistIdentity({ slug: 'peace-lily', variantId: 'v2' }), 'peace-lily::variant:v2');
  assert.notEqual(
    wishlistIdentity({ slug: 'peace-lily', variantId: 'v1' }),
    wishlistIdentity({ slug: 'peace-lily', variantId: 'v2' }),
  );
});

test('listing identity is used when a legacy master-level row has no variant', () => {
  assert.equal(wishlistIdentity({ slug: 'service', listingId: 'listing-7' }), 'service::listing:listing-7');
  assert.equal(wishlistIdentity({ slug: 'legacy-product' }), 'legacy-product');
});

test('legacy slug-only entries migrate safely and malformed duplicates are removed', () => {
  assert.deepEqual(normalizeWishlist([
    { slug: 'legacy-product', title: 'Legacy' },
    { slug: 'legacy-product', title: 'Duplicate' },
    { title: 'No route' },
  ]), [{ slug: 'legacy-product', title: 'Legacy', key: 'legacy-product' }]);
});
