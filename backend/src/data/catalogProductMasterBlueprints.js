import { createHash } from 'node:crypto';
import { CATEGORY_PLAYBOOKS } from './catalogCategoryPlaybooks.js';
import { CATEGORY_BRAND_ASSIGNMENTS } from './catalogBrandBlueprints.js';

const slugify = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120);
const code = (value) => slugify(value).replace(/-/g, '_').slice(0, 40);
const hash = (value, length = 6) => createHash('sha1').update(value).digest('hex').slice(0, length).toUpperCase();
const titleCase = (value) => String(value).replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
const trim = (value, length) => value.length <= length ? value : `${value.slice(0, length - 1).trim()}…`;

const TITLE_BY_CATEGORY = Object.freeze({
  'fresh-flowers': 'Premium Rose Collection', bouquets: 'Celebration Bouquet Collection', 'live-plants': 'Golden Money Plant Collection',
  'seeds-bulbs': 'Hybrid Marigold Seed Collection', smartphones: 'Nova 5G Smartphone Series', tablets: 'Tab Pro Series',
  laptops: 'Air 14 Laptop Series', 'televisions-monitors': 'Vision Display Series', 'audio-wearables': 'Connected Audio & Wearable Series',
  cameras: 'Creator Imaging Series', 'major-appliances': 'Smart Home Appliance Series', furniture: 'Home Furniture Collection',
  apparel: 'Everyday Apparel Collection', footwear: 'Everyday Footwear Collection', jewellery: 'Floral Jewellery Collection',
  'beauty-cosmetics': 'Daily Beauty & Personal Care Collection', 'packaged-food': 'Signature Food & Beverage Collection',
  'fresh-produce': 'Premium Fresh Produce Collection', supplements: 'Daily Nutrition Supplement Series',
  books: 'Principles of Modern Horticulture, 3rd Edition', toys: 'Creative Learning Toy Collection',
  'automotive-parts': 'Vehicle Parts & Accessories Series', batteries: 'Power Storage Series',
  'medical-devices': 'Digital Health Device Series', 'digital-products': 'Professional Digital Suite',
  services: 'Professional Service Appointment', 'gift-hampers': 'Festive Gift Hamper Collection',
});

const CLASS_BY_CATEGORY = Object.freeze({
  'fresh-flowers': 'fresh_flower', bouquets: 'flower_bouquet', 'live-plants': 'plant', 'seeds-bulbs': 'seed',
  smartphones: 'electronics', tablets: 'electronics', laptops: 'electronics', 'televisions-monitors': 'electronics',
  'audio-wearables': 'electronics', cameras: 'electronics', 'major-appliances': 'home', furniture: 'furniture',
  apparel: 'apparel', footwear: 'footwear', jewellery: 'jewellery', 'beauty-cosmetics': 'beauty',
  'packaged-food': 'grocery', 'fresh-produce': 'grocery', supplements: 'grocery', books: 'book', toys: 'toy',
  'automotive-parts': 'automotive', batteries: 'automotive', 'medical-devices': 'other',
  'digital-products': 'digital_good', services: 'service', 'gift-hampers': 'bundle',
});

const UNIT_BY_CATEGORY = Object.freeze({
  'fresh-flowers': ['bunch', 'count'], bouquets: ['bouquet', 'count'], 'live-plants': ['pot', 'count'],
  'seeds-bulbs': ['pack', 'count'], footwear: ['pair', 'count'], jewellery: ['piece', 'count'],
  'beauty-cosmetics': ['bottle', 'count'], 'packaged-food': ['pack', 'count'], 'fresh-produce': ['kilogram', 'mass'],
  supplements: ['pack', 'count'], books: ['piece', 'count'], toys: ['set', 'count'],
  'automotive-parts': ['set', 'count'], batteries: ['piece', 'count'], 'digital-products': ['download', 'digital'],
  services: ['service', 'time'], 'gift-hampers': ['set', 'count'],
});
const defaultUnit = (categorySlug) => UNIT_BY_CATEGORY[categorySlug] || ['piece', 'count'];

const AXIS_SAMPLES = Object.freeze({
  color: ['Black', 'Blue', 'Silver'], colour: ['red', 'white', 'pink'], dominant_color: ['Blush', 'Ivory', 'Vibrant'],
  colour_theme: ['Blush', 'Classic', 'Vibrant'], size: ['Small', 'Medium', 'Large'], pack_size: ['Standard', 'Value', 'Family'],
  stem_count: ['10', '20', '30'], grade: ['Standard', 'Premium', 'Export'], vase_option: ['Without Vase', 'Glass Vase', 'Ceramic Vase'],
  pot_size: ['5 inch', '7 inch', '10 inch'], plant_height: ['20 cm', '35 cm', '50 cm'], pot_color: ['White', 'Terracotta', 'Black'],
  variety: ['Classic', 'Premium', 'Special'], ram: ['8 GB', '12 GB', '16 GB'], ram_gb: ['8', '12', '16'],
  storage: ['128 GB', '256 GB', '512 GB'], storage_gb: ['128', '256', '512'], connectivity: ['Wi-Fi', 'Wi-Fi + Cellular', '5G'],
  operating_system: ['Standard OS', 'Professional OS', 'Premium OS'], screen_size: ['43 inch', '55 inch', '65 inch'], screen_size_in: ['43', '55', '65'],
  kit: ['Body Only', 'Standard Kit', 'Creator Kit'], capacity: ['Standard', 'Large', 'Extra Large'], finish: ['Natural', 'Walnut', 'Dark Oak'],
  metal_color: ['Yellow Gold', 'Rose Gold', 'White Gold'], shade: ['Natural', 'Rosewood', 'Deep Berry'], flavour: ['Classic', 'Chocolate', 'Vanilla'],
  flavor: ['Classic', 'Chocolate', 'Vanilla'], format: ['paperback', 'hardcover', 'board_book'], language: ['English', 'Hindi', 'Telugu'],
  vehicle_fitment: ['Compact', 'Sedan', 'SUV'], terminal_layout: ['Left Positive', 'Right Positive', 'Universal'],
  configuration: ['Device Only', 'Device + Case', 'Complete Kit'], platform: ['Windows', 'macOS', 'Web'], term: ['Monthly', 'Annual', 'Perpetual'],
  license_term: ['monthly', 'annual', 'one_time'], seat_count: ['1 seat', '5 seats', '10 seats'], duration: ['60 minutes', '120 minutes', '180 minutes'],
  duration_minutes: ['60', '120', '180'], service_mode: ['at_customer', 'at_provider', 'remote'], theme: ['Classic', 'Festive', 'Premium'],
  net_quantity: ['100', '250', '500'], width: ['Standard', 'Wide', 'Extra Wide'], material: ['Standard', 'Premium', 'Deluxe'],
});

const NUMERIC_SAMPLES = Object.freeze({
  vase_life_days: 7, germination_percent: 85, warranty_months: 12, display_size_in: 6.5, battery_mah: 5000,
  width_cm: 120, depth_cm: 60, height_cm: 75, net_metal_weight_g: 5, gross_weight_g: 6,
  net_quantity: 250, shelf_life_days: 180, minimum_age_years: 3, voltage_v: 12,
});

function namedSample(key, category, brand, reference) {
  const samples = {
    brand,
    model_name: `${brand} ${reference}`,
    model_number: `${code(brand).slice(0, 8).toUpperCase()}-${reference}`,
    flower_variety: 'Premium mixed seasonal variety',
    botanical_name: category.id === 'live-plants' ? 'Epipremnum aureum' : 'Rosa hybrida',
    common_name: 'Golden Money Plant', crop_or_species: 'African marigold', lot_number: `LOT-${reference}`,
    care_instructions: 'Follow the approved care label; keep in suitable light and temperature conditions.',
    processor: 'Current-generation processor — verify exact chipset from manufacturer specification',
    in_the_box: ['Main product', 'Standard accessories', 'Documentation'],
    display_resolution: '1920 × 1080 or better — verify model', operating_system: brand === 'Apple' ? 'iOS' : 'Android',
    primary_material: 'Manufacturer-declared primary material', upper_material: 'Manufacturer-declared upper material',
    sole_material: 'Manufacturer-declared sole material', purity: 'Verify hallmark and invoice',
    ingredients: 'Copy the complete approved ingredient declaration from the product label',
    usage_instructions: 'Use only as directed on the approved product label', batch_number: `BATCH-${reference}`,
    manufacturer_name: brand, storage_instructions: 'Store according to the approved label in a cool, dry place away from direct sunlight',
    fssai_license_number: `PENDING-${reference}`, batch_or_lot: `LOT-${reference}`, serving_size: 'As declared on pack',
    recommended_usage: 'Use only according to the approved label and professional guidance where applicable',
    warnings: 'Copy all mandatory warnings verbatim from the approved label or licence',
    variety: 'Premium reference variety', country_or_region: 'India — verify actual origin',
    author: 'Reference author — replace with the published credit', publisher: brand, isbn13: '0000000000000',
    materials: ['Manufacturer-declared material'], safety_warnings: 'Use under appropriate supervision; retain all warnings from certified packaging',
    manufacturer_part_number: `${code(brand).slice(0, 8).toUpperCase()}-${reference}`,
    intended_use: 'Use only for the manufacturer-approved intended purpose',
    system_requirements: 'Confirm supported operating system, memory, storage and connectivity before activation',
    activation_instructions: 'Deliver the entitlement securely and follow the publisher activation workflow',
    service_scope: 'Standard service scope as described in the confirmed booking; exclusions require customer acceptance',
    included_items: ['Assessment', 'Standard labour', 'Completion checklist'],
    cancellation_terms: 'Rescheduling and cancellation terms must be accepted before booking',
    flower_mix: ['Seasonal focal flowers', 'Foliage'],
  };
  return samples[key];
}

function sampleValue(field, category, brand, reference) {
  const named = namedSample(field.key, category, brand, reference);
  if (named !== undefined) return named;
  if (field.key === 'network_generation') return '5G';
  if (field.type === 'select') return field.options?.[0] ?? 'standard';
  if (field.type === 'multi_select') return field.options?.slice(0, Math.min(2, field.options.length)) ?? [`Verified ${titleCase(field.key)}`];
  if (field.type === 'number') {
    if (NUMERIC_SAMPLES[field.key] !== undefined) return NUMERIC_SAMPLES[field.key];
    const minimum = field.min ?? 1;
    return field.max != null ? Math.min(field.max, Math.max(minimum, Math.round((minimum + field.max) / 2))) : Math.max(minimum, 1);
  }
  if (field.type === 'boolean') return field.key === 'contains_perishable_items';
  if (field.type === 'date') return '2026-08-01';
  if (field.type === 'json') return field.key === 'nutrition_per_100'
    ? { energy_kcal: '<verify>', protein_g: '<verify>', carbohydrate_g: '<verify>', fat_g: '<verify>' }
    : { name: '<verified value>', amount: '<verified amount>' };
  if (field.type === 'text') return `Enter the complete manufacturer-approved ${titleCase(field.label || field.key).toLowerCase()} without unsupported claims.`;
  return `Verified ${titleCase(field.label || field.key).toLowerCase()} for ${brand}`;
}

function valuesFor(field, axis) {
  if (field?.options?.length) return field.options.slice(0, 3);
  return AXIS_SAMPLES[field?.key || code(axis)] || AXIS_SAMPLES[code(axis)] || ['Standard', 'Plus', 'Premium'];
}

function buildOptions(category) {
  const variantFields = category.attributes.filter((field) => field.appliesTo === 'variant');
  const selected = [];
  for (const axis of category.variantAxes || []) {
    const normalized = code(axis).replace('colour', 'color');
    const field = variantFields.find((candidate) => {
      const key = candidate.key.replace('colour', 'color');
      return key === normalized || key.includes(normalized) || normalized.includes(key);
    });
    const optionCode = field?.key || code(axis);
    if (!selected.some((option) => option.code === optionCode)) {
      selected.push({ field, code: optionCode, name: field?.label || titleCase(axis), values: valuesFor(field, axis) });
    }
    if (selected.length === 6) break;
  }
  for (const field of variantFields.filter((candidate) => candidate.required)) {
    if (!selected.some((option) => option.code === field.key) && selected.length < 6) {
      selected.push({ field, code: field.key, name: field.label, values: valuesFor(field, field.key) });
    }
  }
  if (!selected.length) selected.push({ code: 'edition', name: 'Edition', values: ['Standard', 'Plus', 'Premium'] });
  return selected;
}

function variantType(optionCode) {
  const key = optionCode.toLowerCase();
  if (key.includes('stem_count')) return 'stem_count';
  if (key.includes('pack') || key.includes('quantity')) return 'pack_size';
  if (key.includes('color') || key.includes('colour')) return 'color';
  if (key.includes('size')) return 'size';
  if (key.includes('flavour') || key.includes('flavor')) return 'flavor';
  if (key.includes('capacity')) return 'capacity';
  if (key.includes('storage')) return 'storage';
  if (key.includes('ram') || key.includes('memory')) return 'memory';
  if (key.includes('format')) return 'format';
  if (key.includes('term') || key.includes('license')) return 'license';
  if (key.includes('duration')) return 'duration';
  if (key.includes('material')) return 'material';
  return 'other';
}

function unitPolicy(categorySlug) {
  const [sellingUnit, dimension] = defaultUnit(categorySlug);
  if (sellingUnit === 'kilogram') {
    return {
      dimension, baseUnit: 'gram', allowFractional: false, precision: 0,
      units: [
        { code: 'gram', label: 'Gram', toBaseFactor: 1, precision: 0 },
        { code: 'kilogram', label: 'Kilogram', toBaseFactor: 1000, precision: 3 },
      ],
    };
  }
  return {
    dimension, baseUnit: sellingUnit, allowFractional: false, precision: 0,
    units: [{ code: sellingUnit, label: titleCase(sellingUnit), toBaseFactor: 1, precision: 0 }],
  };
}

function buildCompliance(category, reference) {
  return (category.compliance || []).map((requirement) => ({
    variantId: null,
    type: requirement.type,
    code: requirement.code,
    title: requirement.label,
    authority: null,
    jurisdiction: {
      country: requirement.jurisdictions?.[0] || 'IN',
      state: null,
      regions: [],
    },
    status: 'pending',
    validFrom: null,
    validUntil: null,
    issuerReference: null,
    documents: [],
    restrictions: ['Commercial activation requires authoritative evidence review'],
    metadata: {
      source: 'catalog-product-master-seed',
      reference,
      categorySlug: category.id,
      categoryRequired: requirement.required !== false,
      requiresExpiry: Boolean(requirement.requiresExpiry),
      evidencePending: true,
    },
  }));
}

function makeBlueprint(category, brand, index) {
  const identity = `${category.id}:${brand}`;
  const reference = hash(identity, 5);
  const categoryPrefix = code(category.id).split('_').map((part) => part.slice(0, 3)).join('').slice(0, 10).toUpperCase();
  const brandPrefix = code(brand).replaceAll('_', '').slice(0, 10).toUpperCase();
  const skuGlobal = `${categoryPrefix}-${brandPrefix}-${reference}`.slice(0, 80);
  const title = trim(`${brand} ${TITLE_BY_CATEGORY[category.id] || category.example.title.replaceAll('Acme', '')}`.replace(/\s+/g, ' ').trim(), 160);
  const options = buildOptions(category);
  const policy = unitPolicy(category.id);
  const variants = [0, 1, 2].map((variantIndex) => {
    const optionValues = options.map((option) => ({
      code: option.code, name: option.name, value: option.values[variantIndex % option.values.length],
    }));
    const displayLabel = optionValues.map((option) => option.value).join(' / ');
    return {
      variantType: variantType(options[0].code), value: optionValues[0].value, optionValues, displayLabel,
      sku: `${skuGlobal}-${String(variantIndex + 1).padStart(2, '0')}`.slice(0, 80),
      barcode: null, identifiers: { gtin: null, mpn: null },
      sellQuantity: { value: 1, unitCode: defaultUnit(category.id)[0] }, sortOrder: variantIndex,
      isDefault: variantIndex === 0, weight: { value: null, unit: 'g' },
      dimensions: { length: null, width: null, height: null, unit: 'cm' }, images: [],
      attributes: category.attributes
        .filter((field) => ['variant', 'both'].includes(field.appliesTo))
        .map((field) => {
          const option = optionValues.find((candidate) => candidate.code === field.key);
          const rawValue = option?.value ?? sampleValue(field, category, brand, reference);
          return {
            key: field.key,
            value: field.type === 'number' && typeof rawValue !== 'number' ? Number.parseFloat(rawValue) : rawValue,
            unit: field.unit || null,
          };
        }),
    };
  });
  const durable = ['smartphones', 'tablets', 'laptops', 'televisions-monitors', 'audio-wearables', 'cameras', 'major-appliances', 'furniture', 'automotive-parts', 'batteries', 'medical-devices'].includes(category.id);
  const perishable = ['fresh-flowers', 'bouquets', 'live-plants', 'fresh-produce'].includes(category.id);
  const noShipping = ['digital-products', 'services'].includes(category.id);
  const type = CLASS_BY_CATEGORY[category.id] || code(category.id);
  const bundleComponentCategorySlugs = category.id === 'bouquets'
    ? ['fresh-flowers']
    : category.id === 'gift-hampers' ? ['fresh-flowers', 'packaged-food'] : [];
  return {
    index, reference, categorySlug: category.id, categoryName: category.name, brandName: brand,
    compliance: buildCompliance(category, reference),
    bundleComponentCategorySlugs,
    payload: {
      skuGlobal, type, kind: category.kind, title,
      slug: `${slugify(brand)}-${category.id}-reference-${reference.toLowerCase()}`.slice(0, 200),
      shortDescription: trim(`${brand} reference ${category.name.toLowerCase()} product family with governed taxonomy, explicit selling-unit identity and three sellable variants. Verify model-specific claims before publishing.`, 300),
      description: trim(`${title} is a catalog-authoring reference for the ${category.name} taxonomy. It demonstrates a complete product master, a controlled option vocabulary and three distinct sellable variants while deliberately excluding all media. ${category.summary} Copy only the structure into the admin console; confirm manufacturer specifications, identifiers, origin, regulatory evidence, warranty terms and packaging declarations against an authoritative source before activation.`, 4000),
      barcode: null, manufacturer: brand, modelNumber: `${brandPrefix}-${reference}`, countryOfOrigin: null,
      condition: 'new',
      identifiers: { gtin: null, mpn: null, isbn: null, hsn: null },
      warranty: durable
        ? { duration: 12, unit: 'month', description: 'Reference only — replace with the exact manufacturer warranty terms and exclusions.' }
        : { duration: null, unit: 'month', description: null },
      seo: {
        title: trim(`${brand} ${category.name} | Reference Product`, 70),
        description: trim(`Explore the ${brand} ${category.name.toLowerCase()} reference with governed specifications, selling-unit identity and selectable variants. Verify details before publishing.`, 180),
        keywords: [brand, category.name, `${brand} ${category.name}`, type, 'reference catalog'],
      },
      tags: [...new Set([slugify(brand), category.id, code(category.group), type, 'reference-data'])],
      defaultSellingUnit: defaultUnit(category.id)[0], unitPolicy: policy, minOrderQty: 1, maxOrderQty: durable ? 5 : 100,
      fulfillmentProfile: {
        requiresShipping: !noShipping,
        shippingClass: noShipping ? 'none' : perishable ? 'perishable' : category.id === 'batteries' ? 'hazardous' : 'standard',
        weight: { value: null, unit: 'g' }, dimensions: { length: null, width: null, height: null, unit: 'cm' },
        fragile: ['jewellery', 'cameras', 'televisions-monitors', 'medical-devices'].includes(category.id),
        hazardous: category.id === 'batteries', ageRestricted: false,
        requiresSerialTracking: ['smartphones', 'tablets', 'laptops', 'cameras', 'major-appliances', 'medical-devices'].includes(category.id),
      },
      isPerishable: perishable,
      requiresColdChain: ['fresh-flowers', 'bouquets', 'fresh-produce'].includes(category.id),
      options: options.map((option, optionIndex) => ({
        code: option.code, name: option.name, values: option.values,
        displayType: /color|colour/i.test(option.code) ? 'swatch' : 'text', sortOrder: optionIndex,
      })),
      optionRules: [],
      attributes: category.attributes
        .filter((field) => ['master', 'both'].includes(field.appliesTo || 'master'))
        .map((field) => ({ key: field.key, value: sampleValue(field, category, brand, reference), unit: field.unit || null })),
      variants,
      images: [],
    },
  };
}

export function buildCatalogProductMasterBlueprints() {
  const rows = [];
  for (const category of CATEGORY_PLAYBOOKS) {
    for (const brand of CATEGORY_BRAND_ASSIGNMENTS[category.id] || []) {
      rows.push(makeBlueprint(category, brand, rows.length + 1));
    }
  }
  return rows;
}

const complianceRecords = CATEGORY_PLAYBOOKS.reduce((total, category) =>
  total + (CATEGORY_BRAND_ASSIGNMENTS[category.id]?.length || 0) * (category.compliance?.length || 0), 0);
const requiredComplianceRecords = CATEGORY_PLAYBOOKS.reduce((total, category) =>
  total + (CATEGORY_BRAND_ASSIGNMENTS[category.id]?.length || 0)
    * (category.compliance || []).filter((requirement) => requirement.required !== false).length, 0);
const bundleComponents = (CATEGORY_BRAND_ASSIGNMENTS.bouquets?.length || 0)
  + (CATEGORY_BRAND_ASSIGNMENTS['gift-hampers']?.length || 0) * 2;

export const CATALOG_PRODUCT_MASTER_COUNTS = Object.freeze({
  categories: CATEGORY_PLAYBOOKS.length,
  uniqueBrands: new Set(Object.values(CATEGORY_BRAND_ASSIGNMENTS).flat()).size,
  relationships: Object.values(CATEGORY_BRAND_ASSIGNMENTS).flat().length,
  productMasters: 409,
  variants: 1227,
  complianceRecords,
  requiredComplianceRecords,
  bundleComponents,
});
