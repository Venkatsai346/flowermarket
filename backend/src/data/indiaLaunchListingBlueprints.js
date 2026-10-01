import { createHash } from 'node:crypto';
import { normalizeUnitPolicy, assertQuantity } from '../utils/catalog/unitConversion.js';

export const INDIA_LAUNCH_LISTING_ACTOR_ID = '6a97b0e9a61173c01d040435';
export const INDIA_LAUNCH_LISTING_MARKER = 'INL26';
export const INDIA_LAUNCH_LISTING_EXPECTED_COUNTS = Object.freeze({
  FLOWER1: { masters: 60, listings: 120 }, FLOWER2: { masters: 60, listings: 120 }, GROCERY: { masters: 164, listings: 328 },
  FASHION: { masters: 128, listings: 384 }, DAIRYEGG: { masters: 72, listings: 144 }, ELECTRO: { masters: 172, listings: 344 },
  BEAUTY: { masters: 116, listings: 232 }, VEGGIES: { masters: 276, listings: 552 }, totalListings: 2224,
});
export const INDIA_LAUNCH_LISTING_TENANTS = Object.freeze([
  { id: '6a97b0e9a61173c01d040435', code: 'FLOWER1', label: 'flower store 1', verticals: ['flowers'] },
  { id: '6aa2acaaf23bef4d46ce4c1e', code: 'FLOWER2', label: 'flower store 2', verticals: ['flowers'] },
  { id: '6ab7a306154d0153e5aae538', code: 'GROCERY', label: 'grocery store', verticals: ['grocery'] },
  { id: '6aba82c6ee308adc0c75e9c8', code: 'FASHION', label: 'fashion store', verticals: ['fashion'] },
  { id: '6aba8342ee308adc0c75eb18', code: 'DAIRYEGG', label: 'dairy and egg store', verticals: ['dairy', 'eggs'] },
  { id: '6aba83a1ee308adc0c75ec46', code: 'ELECTRO', label: 'electronics store', verticals: ['electronics'] },
  { id: '6aba8405ee308adc0c75ed44', code: 'BEAUTY', label: 'beauty store', verticals: ['beauty'] },
  { id: '6aba847eee308adc0c75ee7b', code: 'VEGGIES', label: 'vegetable store', verticals: ['vegetables'] },
]);

const PRICE_RULES = Object.freeze({
  grocery: [[/rice|oil|ghee|dry-fruit|nut/, 499], [/tea|coffee|health-drink/, 349], [/chocolate|confectionery/, 249], [/.*/, 179]],
  vegetables: [[/mushroom|broccoli|asparagus|artichoke|avocado|zucchini|kale/, 199], [/leaf|spinach|mint|coriander|curry/, 59], [/.*/, 79]],
  fashion: [[/jewellery|watch|luggage/, 2499], [/footwear|handbag|jacket/, 1799], [/saree|salwar|ethnic/, 1499], [/.*/, 999]],
  beauty: [[/perfume|serum|foundation/, 999], [/sunscreen|moisturizer|hair-color/, 699], [/.*/, 399]],
  electronics: [[/smartphone/, 19999], [/laptop|desktop/, 54999], [/television|camera|gaming-console|drone/, 34999], [/refrigerator|washing-machine|air-conditioner/, 29999], [/tablet|monitor|printer|water-purifier|vacuum/, 14999], [/watch|headphone|earbud|speaker|router|storage-drive/, 3999], [/.*/, 1499]],
  dairy: [[/cheese|ghee/, 399], [/paneer|butter/, 249], [/.*/, 79]],
  eggs: [[/quail/, 179], [/omega|free-range|country/, 149], [/.*/, 99]],
  flowers: [[/bouquet|arrangement/, 799], [/orchid|lily|tulip|carnation/, 499], [/plant/, 599], [/.*/, 299]],
});
const VARIANT_MULTIPLIERS = Object.freeze([1, 1.72, 2.35, 2.9]);
const digest = (value, length = 12) => createHash('sha256').update(String(value)).digest('hex').slice(0, length).toUpperCase();
const roundPrice = (value) => Math.max(1, Math.round(value));

export function launchVertical(master) {
  return (master.tags || []).find((tag) => INDIA_LAUNCH_LISTING_TENANTS.some((tenant) => tenant.verticals.includes(tag))) || null;
}

function basePrice(vertical, categorySlug) {
  const rule = PRICE_RULES[vertical]?.find(([pattern]) => pattern.test(categorySlug));
  if (!rule) throw new Error(`No India launch price rule for ${vertical}/${categorySlug}`);
  return rule[1];
}

export function buildIndiaLaunchListingRequirement({ tenant, master, variant, categorySlug }) {
  const vertical = launchVertical(master);
  if (!vertical || !tenant.verticals.includes(vertical)) throw new Error(`${tenant.code}/${master.skuGlobal}: vertical ${vertical || 'missing'} is outside tenant scope`);
  const multiplier = VARIANT_MULTIPLIERS[Math.min(variant.sortOrder || 0, VARIANT_MULTIPLIERS.length - 1)];
  const priceJitter = 0.94 + ((parseInt(digest(`${tenant.id}:${variant.sku}`, 4), 16) % 13) / 100);
  const sellingPrice = roundPrice(basePrice(vertical, categorySlug) * multiplier * priceJitter);
  const mrp = roundPrice(sellingPrice * (vertical === 'electronics' ? 1.12 : 1.18));
  const stockQty = (['vegetables', 'dairy', 'eggs', 'flowers'].includes(vertical) ? 35 : 18) + (parseInt(digest(variant.sku, 6), 16) % 83);
  const minOrderQty = master.minOrderQty || 1;
  const maxOrderQty = Math.max(minOrderQty, Math.min(master.maxOrderQty || 100, ['vegetables', 'dairy', 'eggs', 'flowers'].includes(vertical) ? 20 : 10));
  const unitPolicy = normalizeUnitPolicy(master.unitPolicy, master.defaultSellingUnit); const priceBasis = { quantity: variant.sellQuantity?.value || 1, unitCode: variant.sellQuantity?.unitCode || unitPolicy.baseUnit }; assertQuantity(priceBasis.quantity, priceBasis.unitCode, unitPolicy);
  return {
    tenantId: tenant.id,
    tenantCode: tenant.code,
    reference: `${tenant.code}/${variant.sku}`,
    masterSku: master.skuGlobal,
    variantSku: variant.sku,
    sellerSku: `${INDIA_LAUNCH_LISTING_MARKER}-${tenant.code}-${digest(`${master.skuGlobal}:${variant.sku}`)}`,
    vertical,
    categorySlug,
    price: { mrp, sellingPrice, costPrice: roundPrice(sellingPrice * 0.64), saleStartsAt: null, saleEndsAt: null, taxInclusive: true, currency: 'INR' },
    priceBasis,
    orderLimits: { minOrderQty, maxOrderQty },
    sellingPolicy: { allowBackorder: false, preorder: false, availableFrom: null, availableUntil: null, leadTimeDays: ['vegetables', 'dairy', 'eggs', 'flowers'].includes(vertical) ? 1 : 0 },
    merchandising: {
      titleOverride: null,
      descriptionOverride: null,
      badges: ['vegetables', 'dairy', 'eggs', 'flowers'].includes(vertical) ? ['Fresh selection'] : ['India launch'],
      featured: Boolean(variant.isDefault),
      searchBoost: variant.isDefault ? 8 : 0,
    },
    channels: { storefront: true, marketplace: true, pos: true, wholesale: false },
    stockQty,
  };
}

export function validateIndiaLaunchListingConfiguration() {
  const errors = []; const ids = new Set(); const codes = new Set();
  for (const tenant of INDIA_LAUNCH_LISTING_TENANTS) {
    if (!/^[a-f0-9]{24}$/.test(tenant.id)) errors.push(`${tenant.code}: invalid tenant ObjectId`);
    if (ids.has(tenant.id)) errors.push(`${tenant.code}: duplicate tenant ID`); ids.add(tenant.id);
    if (codes.has(tenant.code)) errors.push(`${tenant.code}: duplicate tenant code`); codes.add(tenant.code);
    if (!tenant.verticals.length || tenant.verticals.some((vertical) => !PRICE_RULES[vertical])) errors.push(`${tenant.code}: unsupported vertical scope`);
  }
  if (INDIA_LAUNCH_LISTING_TENANTS.length !== 8) errors.push(`Expected 8 launch tenants, found ${INDIA_LAUNCH_LISTING_TENANTS.length}`);
  if (errors.length) throw new Error(`India launch listing configuration failed:\n- ${errors.join('\n- ')}`);
  return INDIA_LAUNCH_LISTING_TENANTS;
}
