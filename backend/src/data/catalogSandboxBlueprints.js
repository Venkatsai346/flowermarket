import { createHash } from 'node:crypto';
import { CATEGORY_PLAYBOOKS } from './catalogCategoryPlaybooks.js';
import { CATEGORY_BRAND_ASSIGNMENTS } from './catalogBrandBlueprints.js';
import { buildCatalogProductMasterBlueprints } from './catalogProductMasterBlueprints.js';

export const SANDBOX_PREFIX = 'sandbox';
export const SANDBOX_EDITIONS_PER_RELATIONSHIP = 3;

const ROOTS = [
  ['Flowers & plants', 'flowers-plants', 'Fresh flowers, arrangements, live plants and propagation material.'],
  ['Electronics', 'electronics', 'Connected devices, computing, entertainment and imaging electronics.'],
  ['Home & appliances', 'home-appliances', 'Home appliances, furniture and durable household products.'],
  ['Fashion', 'fashion', 'Apparel, footwear, jewellery and wearable style products.'],
  ['Health & beauty', 'health-beauty', 'Beauty, wellness, nutrition and health products.'],
  ['Grocery & food', 'grocery-food', 'Packaged foods, beverages and fresh produce.'],
  ['Media & education', 'media-education', 'Books, publications and educational products.'],
  ['Kids & toys', 'kids-toys', 'Toys, games and child-oriented products.'],
  ['Automotive', 'automotive', 'Vehicle parts, accessories, batteries and power storage.'],
  ['Digital & services', 'digital-services', 'Digital entitlements, professional services and appointments.'],
  ['Bundles', 'bundles', 'Fixed and configurable multi-product sets and gifts.'],
];

const SECTIONS = [
  ['Flowers & plants', 'Cut flowers & arrangements', 'cut-flowers-arrangements', ['fresh-flowers', 'bouquets']],
  ['Flowers & plants', 'Plants & propagation', 'plants-propagation', ['live-plants', 'seeds-bulbs']],
  ['Electronics', 'Mobile & computing', 'mobile-computing', ['smartphones', 'tablets', 'laptops']],
  ['Electronics', 'TV, audio & wearables', 'tv-audio-wearables', ['televisions-monitors', 'audio-wearables']],
  ['Electronics', 'Cameras & imaging', 'cameras-imaging', ['cameras']],
  ['Home & appliances', 'Appliances', 'major-home-appliances', ['major-appliances']],
  ['Home & appliances', 'Furniture', 'home-furniture', ['furniture']],
  ['Fashion', 'Clothing & footwear', 'clothing-footwear', ['apparel', 'footwear']],
  ['Fashion', 'Jewellery', 'fashion-jewellery', ['jewellery']],
  ['Health & beauty', 'Beauty & personal care', 'beauty-personal-care', ['beauty-cosmetics']],
  ['Health & beauty', 'Nutrition & medical', 'nutrition-medical', ['supplements', 'medical-devices']],
  ['Grocery & food', 'Packaged grocery', 'packaged-grocery', ['packaged-food']],
  ['Grocery & food', 'Fresh grocery', 'fresh-grocery', ['fresh-produce']],
  ['Media & education', 'Books & publications', 'books-publications', ['books']],
  ['Kids & toys', 'Toys & games', 'toys-games', ['toys']],
  ['Automotive', 'Parts & power', 'automotive-parts-power', ['automotive-parts', 'batteries']],
  ['Digital & services', 'Digital goods', 'digital-goods', ['digital-products']],
  ['Digital & services', 'Bookable services', 'bookable-services', ['services']],
  ['Bundles', 'Gifts & hampers', 'gifts-hampers', ['gift-hampers']],
];

const EDITIONS = [
  { code: 'ATL', title: 'Atlas Laboratory', label: 'Atlas' },
  { code: 'BOR', title: 'Borealis Evaluation', label: 'Borealis' },
  { code: 'CIT', title: 'Citrine Demonstration', label: 'Citrine' },
];

const truncate = (value, max) => String(value || '').length <= max
  ? String(value || '')
  : `${String(value || '').slice(0, max - 1).trim()}…`;
const digest = (value, length = 8) => createHash('sha1').update(String(value)).digest('hex').slice(0, length).toUpperCase();
export const sandboxSlug = (canonicalSlug) => `${SANDBOX_PREFIX}-${canonicalSlug}`;

export const canonicalAttribute = (field, index = 0) => ({
  key: field.key,
  label: field.label || null,
  type: field.type || 'string',
  required: true,
  appliesTo: field.appliesTo || 'master',
  options: [...(field.options || [])],
  unit: field.unit || null,
  min: field.min ?? null,
  max: field.max ?? null,
  regex: field.regex || null,
  multiple: Boolean(field.multiple || field.type === 'multi_select'),
  filterable: Boolean(field.filterable),
  facetable: Boolean(field.facetable),
  searchable: Boolean(field.searchable),
  group: field.group || null,
  sortOrder: field.sortOrder ?? index,
});

export function buildSandboxTaxonomyBlueprints() {
  const playbookById = new Map(CATEGORY_PLAYBOOKS.map((playbook) => [playbook.id, playbook]));
  const roots = ROOTS.map(([name, slug, description], index) => ({
    kind: 'root',
    canonicalSlug: slug,
    slug: sandboxSlug(slug),
    parentSlug: null,
    name: `Sandbox · ${name}`,
    description: `Non-compliance test taxonomy. ${description}`,
    sortOrder: 50000 + index * 100,
    attributeSchema: [],
    complianceRequirements: [],
  }));
  const sections = SECTIONS.map(([rootName, name, slug, leafIds], index) => {
    const root = roots.find((candidate) => candidate.name === `Sandbox · ${rootName}`);
    if (!root) throw new Error(`Sandbox section ${slug} refers to missing root ${rootName}`);
    for (const leafId of leafIds) if (!playbookById.has(leafId)) throw new Error(`Sandbox section ${slug} refers to missing leaf ${leafId}`);
    return {
      kind: 'section', canonicalSlug: slug, slug: sandboxSlug(slug), parentSlug: root.slug,
      name: `Sandbox · ${name}`,
      description: `${name} test taxonomy with no category compliance requirements.`,
      leafIds, sortOrder: 50000 + index * 10, attributeSchema: [], complianceRequirements: [],
    };
  });
  const sectionByLeaf = new Map();
  for (const section of sections) {
    for (const leafId of section.leafIds) {
      if (sectionByLeaf.has(leafId)) throw new Error(`Sandbox leaf ${leafId} is assigned more than once`);
      sectionByLeaf.set(leafId, section.slug);
    }
  }
  const leaves = CATEGORY_PLAYBOOKS.map((playbook, index) => ({
    kind: 'leaf', canonicalSlug: playbook.id, slug: sandboxSlug(playbook.id),
    parentSlug: sectionByLeaf.get(playbook.id),
    name: `Sandbox · ${playbook.name}`,
    description: truncate(`Non-compliance testing category mirroring ${playbook.name}. It retains every mandatory product and variant specification while intentionally defining no compliance requirements. ${playbook.summary}`, 500),
    sortOrder: 50000 + index * 10,
    attributeSchema: playbook.attributes.filter((field) => field.required).map(canonicalAttribute),
    complianceRequirements: [],
  }));
  if (leaves.some((leaf) => !leaf.parentSlug)) throw new Error('Every sandbox leaf must have a taxonomy section');
  return [...roots, ...sections, ...leaves];
}

function clone(value) {
  return structuredClone(value);
}

export function buildSandboxProductBlueprints() {
  const playbookById = new Map(CATEGORY_PLAYBOOKS.map((playbook) => [playbook.id, playbook]));
  const baseRows = buildCatalogProductMasterBlueprints();
  const rows = [];
  for (const base of baseRows) {
    const playbook = playbookById.get(base.categorySlug);
    const requiredMasterKeys = new Set(playbook.attributes
      .filter((field) => field.required && ['master', 'both'].includes(field.appliesTo || 'master'))
      .map((field) => field.key));
    const requiredVariantKeys = new Set(playbook.attributes
      .filter((field) => field.required && ['variant', 'both'].includes(field.appliesTo))
      .map((field) => field.key));
    for (const edition of EDITIONS.slice(0, SANDBOX_EDITIONS_PER_RELATIONSHIP)) {
      const payload = clone(base.payload);
      const identity = `${base.categorySlug}:${base.brandName}:${edition.code}`;
      const identityHash = digest(identity);
      const skuGlobal = `SBX-${edition.code}-${identityHash}-${base.payload.skuGlobal}`.slice(0, 74);
      payload.skuGlobal = skuGlobal;
      payload.slug = `${SANDBOX_PREFIX}-${edition.code.toLowerCase()}-${identityHash.toLowerCase()}-${base.payload.slug}`.slice(0, 200);
      payload.title = truncate(`${edition.title} ${identityHash} · ${base.brandName} ${base.categoryName}`, 160);
      payload.modelNumber = `SBX-${edition.code}-${identityHash}`;
      payload.countryOfOrigin = 'IN';
      if (payload.fulfillmentProfile?.requiresShipping) {
        payload.fulfillmentProfile.weight = { value: 750, unit: 'g' };
        payload.fulfillmentProfile.dimensions = { length: 30, width: 20, height: 15, unit: 'cm' };
      }
      payload.shortDescription = truncate(`${edition.label} test master for ${base.brandName} ${base.categoryName.toLowerCase()}, with complete mandatory category data and three sellable variants. No category compliance is configured in this sandbox taxonomy.`, 300);
      payload.description = truncate(`${payload.title} is deterministic non-compliance test data for catalog, listing, search, cart and order workflows. It carries every mandatory master and variant attribute defined by the mirrored category, realistic structural details, controlled options and empty media. It is not evidence of a real manufacturer product, certification, licence, approval, origin, warranty or regulatory status.`, 4000);
      payload.tags = [...new Set([...(payload.tags || []), 'sandbox-data', 'no-category-compliance', edition.code.toLowerCase()])];
      payload.seo = {
        title: truncate(`${base.brandName} ${base.categoryName} ${edition.label} Sandbox`, 70),
        description: truncate(`Test ${base.categoryName.toLowerCase()} master with required specifications and variants for governed sandbox workflows.`, 180),
        keywords: [...new Set([base.brandName, base.categoryName, 'sandbox catalog', edition.label])],
      };
      payload.attributes = payload.attributes.filter((attribute) => requiredMasterKeys.has(attribute.key));
      payload.variants = payload.variants.map((variant, variantIndex) => ({
        ...variant,
        sku: `${skuGlobal}-V${String(variantIndex + 1).padStart(2, '0')}`.slice(0, 80),
        barcode: null,
        identifiers: { gtin: null, mpn: null },
        weight: payload.fulfillmentProfile?.requiresShipping ? { value: 500 + variantIndex * 250, unit: 'g' } : { value: null, unit: 'g' },
        dimensions: payload.fulfillmentProfile?.requiresShipping
          ? { length: 25 + variantIndex * 2, width: 18 + variantIndex, height: 12 + variantIndex, unit: 'cm' }
          : { length: null, width: null, height: null, unit: 'cm' },
        attributes: variant.attributes.filter((attribute) => requiredVariantKeys.has(attribute.key)),
        images: [],
      }));
      payload.images = [];
      rows.push({
        index: rows.length + 1,
        reference: `SBX-${edition.code}-${identityHash}`,
        editionCode: edition.code,
        canonicalCategorySlug: base.categorySlug,
        categorySlug: sandboxSlug(base.categorySlug),
        categoryName: `Sandbox · ${base.categoryName}`,
        brandName: base.brandName,
        compliance: [],
        bundleComponentCategorySlugs: base.bundleComponentCategorySlugs.map(sandboxSlug),
        payload,
      });
    }
  }
  return rows;
}

const taxonomy = buildSandboxTaxonomyBlueprints();
const relationships = Object.values(CATEGORY_BRAND_ASSIGNMENTS).flat().length;
const productMasters = relationships * SANDBOX_EDITIONS_PER_RELATIONSHIP;
export const CATALOG_SANDBOX_COUNTS = Object.freeze({
  categories: taxonomy.length,
  roots: taxonomy.filter((row) => row.kind === 'root').length,
  sections: taxonomy.filter((row) => row.kind === 'section').length,
  leaves: taxonomy.filter((row) => row.kind === 'leaf').length,
  requiredAttributeFields: taxonomy.reduce((sum, row) => sum + row.attributeSchema.length, 0),
  complianceRequirements: 0,
  uniqueBrands: new Set(Object.values(CATEGORY_BRAND_ASSIGNMENTS).flat()).size,
  categoryBrandRelationships: relationships,
  productMasters,
  variants: productMasters * 3,
});
