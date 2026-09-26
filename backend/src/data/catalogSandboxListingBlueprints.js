import { createHash } from 'node:crypto';
import { CATEGORY_PLAYBOOKS } from './catalogCategoryPlaybooks.js';
import { buildSandboxProductBlueprints } from './catalogSandboxBlueprints.js';

export const CATALOG_SANDBOX_LISTING_ACTOR_ID = '6a97b0e9a61173c01d040435';
export const CATALOG_SANDBOX_LISTING_MARKER = 'SBXL';
export const CATALOG_SANDBOX_DIVERSE_MASTER_COUNT = 36;

export const CATALOG_SANDBOX_LISTING_TENANTS = Object.freeze([
  {
    id: '6aa2acaaf23bef4d46ce4c1e',
    code: 'FLORA',
    label: 'flower store',
    mode: 'category_scope',
    categorySlugs: ['fresh-flowers', 'bouquets', 'live-plants', 'seeds-bulbs'],
  },
  {
    id: '6ab7a306154d0153e5aae538',
    code: 'GROCERY',
    label: 'grocery store',
    mode: 'category_scope',
    categorySlugs: ['packaged-food', 'fresh-produce'],
  },
  {
    id: '6ab7a0f6154d0153e5aae0e4',
    code: 'MULTI',
    label: 'multi-category store',
    mode: 'diverse_sample',
    masterCount: CATALOG_SANDBOX_DIVERSE_MASTER_COUNT,
  },
  {
    id: '6a97b0e9a61173c01d040435',
    code: 'FLORAGIFT',
    label: 'flower and gift-hamper store',
    mode: 'category_scope',
    categorySlugs: ['fresh-flowers', 'bouquets', 'live-plants', 'seeds-bulbs', 'gift-hampers'],
  },
]);

const BASE_PRICE_BY_CATEGORY = Object.freeze({
  'fresh-flowers': 349, bouquets: 599, 'live-plants': 449, 'seeds-bulbs': 199,
  smartphones: 14999, tablets: 11999, laptops: 42999, 'televisions-monitors': 23999,
  'audio-wearables': 2999, cameras: 32999, 'major-appliances': 27999, furniture: 8999,
  apparel: 999, footwear: 1499, jewellery: 2499, 'beauty-cosmetics': 699,
  'packaged-food': 249, 'fresh-produce': 149, supplements: 799, books: 599, toys: 999,
  'automotive-parts': 1999, batteries: 3499, 'medical-devices': 1799,
  'digital-products': 2499, services: 1499, 'gift-hampers': 1299,
});
const VARIANT_MULTIPLIERS = Object.freeze([1, 1.35, 1.7]);

const digest = (value, length = 12) => createHash('sha256').update(String(value)).digest('hex').slice(0, length).toUpperCase();
const roundToRupees = (value) => Math.max(1, Math.round(value));

function diverseSample(rows, wanted) {
  const categoryOrder = CATEGORY_PLAYBOOKS.map((playbook) => playbook.id);
  const byCategory = new Map(categoryOrder.map((slug) => [slug, []]));
  for (const row of rows) byCategory.get(row.canonicalCategorySlug)?.push(row);
  for (const categoryRows of byCategory.values()) categoryRows.sort((left, right) => left.reference.localeCompare(right.reference));

  const selected = [];
  let round = 0;
  while (selected.length < wanted) {
    let added = false;
    for (const slug of categoryOrder) {
      const row = byCategory.get(slug)?.[round];
      if (!row) continue;
      selected.push(row);
      added = true;
      if (selected.length === wanted) break;
    }
    if (!added) break;
    round += 1;
  }
  if (selected.length !== wanted) throw new Error(`Cannot build ${wanted} diverse sandbox masters; only ${selected.length} are available`);
  return selected;
}

function selectedMasters(tenant, allRows) {
  if (tenant.mode === 'diverse_sample') return diverseSample(allRows, tenant.masterCount);
  const scope = new Set(tenant.categorySlugs);
  return allRows.filter((row) => scope.has(row.canonicalCategorySlug));
}

export function buildSandboxListingBlueprints() {
  const allRows = buildSandboxProductBlueprints();
  return CATALOG_SANDBOX_LISTING_TENANTS.map((tenant) => {
    const masters = selectedMasters(tenant, allRows);
    const listings = masters.flatMap((row) => row.payload.variants.map((variant, variantIndex) => {
      const base = BASE_PRICE_BY_CATEGORY[row.canonicalCategorySlug];
      if (!base) throw new Error(`No listing price profile for ${row.canonicalCategorySlug}`);
      const sellingPrice = roundToRupees(base * VARIANT_MULTIPLIERS[variantIndex]);
      const mrp = roundToRupees(sellingPrice * 1.18);
      const stockQty = 24 + (parseInt(digest(`${tenant.id}:${variant.sku}`, 6), 16) % 97);
      return {
        tenantId: tenant.id,
        tenantCode: tenant.code,
        tenantLabel: tenant.label,
        reference: `${tenant.code}/${variant.sku}`,
        productReference: row.reference,
        masterSku: row.payload.skuGlobal,
        variantSku: variant.sku,
        canonicalCategorySlug: row.canonicalCategorySlug,
        categorySlug: row.categorySlug,
        sellerSku: `${CATALOG_SANDBOX_LISTING_MARKER}-${tenant.code}-${digest(variant.sku)}`,
        price: { mrp, sellingPrice, costPrice: roundToRupees(sellingPrice * 0.62), taxInclusive: true, currency: 'INR' },
        stockQty,
        orderLimits: {
          minOrderQty: row.payload.minOrderQty || 1,
          maxOrderQty: Math.min(row.payload.maxOrderQty || 100, row.payload.isPerishable ? 25 : 10),
        },
        sellingPolicy: { allowBackorder: false, preorder: false, leadTimeDays: row.payload.isPerishable ? 1 : 0 },
        merchandising: {
          titleOverride: null,
          descriptionOverride: null,
          badges: row.payload.isPerishable ? ['Fresh pick'] : [],
          featured: variantIndex === 0,
          searchBoost: variantIndex === 0 ? 8 : 0,
        },
        channels: { storefront: true, marketplace: true, pos: true, wholesale: false },
      };
    }));
    return {
      ...tenant,
      masterSkus: masters.map((row) => row.payload.skuGlobal),
      categoryCoverage: [...new Set(masters.map((row) => row.canonicalCategorySlug))],
      masterCount: masters.length,
      listings,
      listingCount: listings.length,
    };
  });
}

export function validateSandboxListingBlueprints(blueprints = buildSandboxListingBlueprints()) {
  const errors = [];
  const tenantIds = new Set();
  const sellerSkus = new Set();
  for (const tenant of blueprints) {
    if (tenantIds.has(tenant.id)) errors.push(`Duplicate tenant id ${tenant.id}`);
    tenantIds.add(tenant.id);
    if (!tenant.masterCount || tenant.listingCount !== tenant.masterCount * 3) errors.push(`${tenant.code}: every selected master must contribute exactly three variant listings`);
    if (tenant.mode === 'diverse_sample') {
      if (tenant.listingCount < 100 || tenant.listingCount > 120) errors.push(`${tenant.code}: expected 100–120 listings, generated ${tenant.listingCount}`);
      if (tenant.categoryCoverage.length !== CATEGORY_PLAYBOOKS.length) errors.push(`${tenant.code}: expected all ${CATEGORY_PLAYBOOKS.length} category types, covered ${tenant.categoryCoverage.length}`);
    }
    for (const listing of tenant.listings) {
      const localKey = `${tenant.id}:${listing.masterSku}:${listing.variantSku}`;
      if (sellerSkus.has(listing.sellerSku)) errors.push(`${listing.reference}: duplicate seller SKU`);
      sellerSkus.add(listing.sellerSku);
      if (!listing.sellerSku.startsWith(`${CATALOG_SANDBOX_LISTING_MARKER}-${tenant.code}-`)) errors.push(`${listing.reference}: invalid ownership marker`);
      if (!(listing.price.costPrice <= listing.price.sellingPrice && listing.price.sellingPrice <= listing.price.mrp)) errors.push(`${listing.reference}: invalid price ladder`);
      if (listing.stockQty <= 0 || listing.orderLimits.minOrderQty > listing.orderLimits.maxOrderQty) errors.push(`${listing.reference}: invalid stock/order limits`);
      if (!localKey) errors.push(`${listing.reference}: invalid identity`);
    }
  }
  if (errors.length) throw new Error(`Sandbox listing validation failed:\n- ${errors.join('\n- ')}`);
  return blueprints;
}

export const CATALOG_SANDBOX_LISTING_COUNTS = Object.freeze(
  validateSandboxListingBlueprints().reduce((result, tenant) => {
    result[tenant.code] = Object.freeze({ masters: tenant.masterCount, listings: tenant.listingCount, categories: tenant.categoryCoverage.length });
    result.totalMasters += tenant.masterCount;
    result.totalListings += tenant.listingCount;
    return result;
  }, { totalMasters: 0, totalListings: 0 })
);
