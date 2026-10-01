#!/usr/bin/env node
/**
 * Seed every product master + variant in PRODUCT_MASTER_VARIANT_REFERENCE_CATALOG.md.
 *
 * Safety model:
 *   - --validate-only performs deterministic, database-free contract checks
 *   - no --apply performs a database-backed dependency/collision dry run
 *   - --apply creates or repairs only deterministic reference SKUs
 *   - dependencies are resolved by exact category slug and brand name/slug;
 *     this script never creates or silently substitutes categories or brands
 *   - all master/variant media arrays remain empty
 *   - reference masters default to pending_review; --active is explicit
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import User from '../src/models/user.model.js';
import Category from '../src/models/category.model.js';
import Brand from '../src/models/brand.model.js';
import ProductMaster from '../src/models/productMaster.model.js';
import ProductVariant from '../src/models/productVariant.model.js';
import ProductAttributeValue from '../src/models/productAttributeValue.model.js';
import ProductVariantAttributeValue from '../src/models/productVariantAttributeValue.model.js';
import ProductCompliance from '../src/models/productCompliance.model.js';
import ProductBundleComponent from '../src/models/productBundleComponent.model.js';
import productMasterService from '../src/services/productMaster.service.js';
import catalogStructureService from '../src/services/catalogStructure.service.js';
import categoryService from '../src/services/category.service.js';
import { assertUniversalVariantIndexContract } from '../src/utils/catalog/indexContracts.js';
import { masterCreateSchema } from '../src/utils/validators/catalog.validators.js';
import {
  buildCatalogProductMasterBlueprints,
  CATALOG_PRODUCT_MASTER_COUNTS,
} from '../src/data/catalogProductMasterBlueprints.js';
import { CATEGORY_PLAYBOOKS } from '../src/data/catalogCategoryPlaybooks.js';
import { CATEGORY_BRAND_ASSIGNMENTS } from '../src/data/catalogBrandBlueprints.js';

const DEFAULT_ACTOR_ID = '6a97b0e9a61173c01d040435';
const argv = process.argv.slice(2);
const args = new Set(argv);
const valueArg = (name) => argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const options = {
  apply: args.has('--apply'),
  validateOnly: args.has('--validate-only'),
  continueOnError: args.has('--continue-on-error'),
  status: args.has('--active') ? 'active' : 'pending_review',
  actorId: valueArg('--actor') || DEFAULT_ACTOR_ID,
};

const DUMMY_ID = '000000000000000000000001';
const fail = (message) => { throw new Error(message); };
const id = (value) => String(value?._id || value?.id || value || '');
const normalizeName = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const isLegacyPlaceholder = (value) => typeof value === 'string' && /^<REPLACE[_ ].*>$/i.test(value.trim());
const brandSlug = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ')
  .replace(/['’]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 140);

function servicePayload(row, categoryId = DUMMY_ID, brandId = DUMMY_ID) {
  return {
    ...row.payload,
    categoryId,
    brandId,
    variants: row.payload.variants.map(({ attributes: _attributes, ...variant }) => variant),
  };
}

function fieldValueError(field, value) {
  if (value === undefined || value === null || value === '') return field.required ? 'required value is empty' : null;
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
    if (field.min != null && value < field.min) return `must be >= ${field.min}`;
    if (field.max != null && value > field.max) return `must be <= ${field.max}`;
  }
  if (field.type === 'boolean' && typeof value !== 'boolean') return 'must be boolean';
  if (field.type === 'multi_select' && !Array.isArray(value)) return 'must be an array';
  if (field.type === 'json' && (!value || typeof value !== 'object' || Array.isArray(value))) return 'must be an object';
  if (field.type === 'select' && field.options?.length && !field.options.includes(value)) return `must be one of ${field.options.join(', ')}`;
  if (field.type === 'multi_select' && field.options?.length && value.some((item) => !field.options.includes(item))) return `contains a value outside ${field.options.join(', ')}`;
  if (field.regex && typeof value === 'string' && !(new RegExp(field.regex).test(value))) return `does not match ${field.regex}`;
  return null;
}

function assertBlueprint() {
  const rows = buildCatalogProductMasterBlueprints();
  const errors = [];
  const masterSkus = new Set();
  const masterSlugs = new Set();
  const variantSkus = new Set();
  let complianceRecordCount = 0;
  let masterAttributeCount = 0;
  let variantAttributeCount = 0;
  let bundleComponentCount = 0;
  const playbookBySlug = new Map(CATEGORY_PLAYBOOKS.map((playbook) => [playbook.id, playbook]));

  if (rows.length !== CATALOG_PRODUCT_MASTER_COUNTS.productMasters) {
    errors.push(`Expected ${CATALOG_PRODUCT_MASTER_COUNTS.productMasters} masters, generated ${rows.length}`);
  }
  for (const row of rows) {
    const playbook = playbookBySlug.get(row.categorySlug);
    if (!playbook) { errors.push(`${row.payload.skuGlobal}: unknown category ${row.categorySlug}`); continue; }
    if (!CATEGORY_BRAND_ASSIGNMENTS[row.categorySlug]?.includes(row.brandName)) {
      errors.push(`${row.payload.skuGlobal}: ${row.brandName} is not assigned to ${row.categorySlug}`);
    }
    if (masterSkus.has(row.payload.skuGlobal)) errors.push(`Duplicate master SKU ${row.payload.skuGlobal}`);
    if (masterSlugs.has(row.payload.slug)) errors.push(`Duplicate master slug ${row.payload.slug}`);
    masterSkus.add(row.payload.skuGlobal); masterSlugs.add(row.payload.slug);

    if (row.payload.images.length) errors.push(`${row.payload.skuGlobal}: master media must be empty`);
    bundleComponentCount += row.bundleComponentCategorySlugs.length;
    if (row.payload.kind === 'bundle' && !row.bundleComponentCategorySlugs.length) errors.push(`${row.payload.skuGlobal}: bundle requires component blueprints`);
    if (row.payload.kind !== 'bundle' && row.bundleComponentCategorySlugs.length) errors.push(`${row.payload.skuGlobal}: non-bundle cannot define components`);
    if (row.payload.variants.length !== 3) errors.push(`${row.payload.skuGlobal}: expected exactly 3 reference variants`);
    if (row.payload.variants.filter((variant) => variant.isDefault).length !== 1) errors.push(`${row.payload.skuGlobal}: needs exactly one default variant`);

    const masterFields = playbook.attributes.filter((field) => ['master', 'both'].includes(field.appliesTo || 'master'));
    const variantFields = playbook.attributes.filter((field) => ['variant', 'both'].includes(field.appliesTo));
    const requiredMaster = masterFields.filter((field) => field.required).map((field) => field.key);
    const requiredVariant = variantFields.filter((field) => field.required).map((field) => field.key);
    const masterKeys = new Set(row.payload.attributes.map((attribute) => attribute.key));
    masterAttributeCount += row.payload.attributes.length;
    for (const key of requiredMaster) if (!masterKeys.has(key)) errors.push(`${row.payload.skuGlobal}: missing master attribute ${key}`);
    for (const field of masterFields) if (!masterKeys.has(field.key)) errors.push(`${row.payload.skuGlobal}: missing production master attribute ${field.key}`);
    for (const attribute of row.payload.attributes) {
      const field = playbook.attributes.find((candidate) => candidate.key === attribute.key);
      if (!field || field.appliesTo === 'variant') errors.push(`${row.payload.skuGlobal}: invalid master attribute ${attribute.key}`);
      else {
        const issue = fieldValueError(field, attribute.value);
        if (issue) errors.push(`${row.payload.skuGlobal}/${attribute.key}: ${issue}`);
      }
    }

    for (const variant of row.payload.variants) {
      if (variant.images.length) errors.push(`${variant.sku}: variant media must be empty`);
      if (variantSkus.has(variant.sku) || masterSkus.has(variant.sku)) errors.push(`Duplicate variant SKU ${variant.sku}`);
      variantSkus.add(variant.sku);
      const variantKeys = new Set(variant.attributes.map((attribute) => attribute.key));
      variantAttributeCount += variant.attributes.length;
      for (const key of requiredVariant) if (!variantKeys.has(key)) errors.push(`${variant.sku}: missing variant attribute ${key}`);
      for (const field of variantFields) if (!variantKeys.has(field.key)) errors.push(`${variant.sku}: missing production variant attribute ${field.key}`);
      for (const attribute of variant.attributes) {
        const field = playbook.attributes.find((candidate) => candidate.key === attribute.key);
        if (!field || field.appliesTo !== 'variant') errors.push(`${variant.sku}: invalid variant attribute ${attribute.key}`);
        else {
          const issue = fieldValueError(field, attribute.value);
          if (issue) errors.push(`${variant.sku}/${attribute.key}: ${issue}`);
        }
      }
    }

    complianceRecordCount += row.compliance.length;
    if (row.compliance.length !== (playbook.compliance || []).length) {
      errors.push(`${row.payload.skuGlobal}: expected ${(playbook.compliance || []).length} compliance records, generated ${row.compliance.length}`);
    }
    for (const requirement of playbook.compliance || []) {
      const record = row.compliance.find((candidate) => candidate.code === requirement.code && candidate.type === requirement.type);
      if (!record) errors.push(`${row.payload.skuGlobal}: missing compliance ${requirement.type}/${requirement.code}`);
      else {
        if (record.status !== 'pending') errors.push(`${row.payload.skuGlobal}/${requirement.code}: seeded compliance must remain pending`);
        if (record.documents.length) errors.push(`${row.payload.skuGlobal}/${requirement.code}: compliance evidence must not be fabricated`);
        const modelError = new ProductCompliance({
          ...record, productMasterId: DUMMY_ID,
        }).validateSync();
        if (modelError) errors.push(`${row.payload.skuGlobal}/${requirement.code}: ${modelError.message}`);
      }
    }

    const contract = masterCreateSchema.validate(servicePayload(row), { abortEarly: false });
    if (contract.error) errors.push(`${row.payload.skuGlobal}: ${contract.error.details.map((detail) => detail.message).join('; ')}`);
    try {
      productMasterService.normalizeStructure(servicePayload(row));
    } catch (error) {
      errors.push(`${row.payload.skuGlobal}: domain normalization failed: ${error.message}`);
    }
  }

  const expectedVariants = CATALOG_PRODUCT_MASTER_COUNTS.variants;
  if (variantSkus.size !== expectedVariants) errors.push(`Expected ${expectedVariants} unique variant SKUs, generated ${variantSkus.size}`);
  if (complianceRecordCount !== CATALOG_PRODUCT_MASTER_COUNTS.complianceRecords) errors.push(`Expected ${CATALOG_PRODUCT_MASTER_COUNTS.complianceRecords} compliance records, generated ${complianceRecordCount}`);
  if (bundleComponentCount !== CATALOG_PRODUCT_MASTER_COUNTS.bundleComponents) errors.push(`Expected ${CATALOG_PRODUCT_MASTER_COUNTS.bundleComponents} bundle components, generated ${bundleComponentCount}`);
  if (!masterAttributeCount || !variantAttributeCount) errors.push('Production attribute coverage cannot be empty');
  if (new Set(rows.map((row) => row.categorySlug)).size !== CATALOG_PRODUCT_MASTER_COUNTS.categories) errors.push('Not every governed category is covered');
  if (new Set(rows.map((row) => normalizeName(row.brandName))).size !== CATALOG_PRODUCT_MASTER_COUNTS.uniqueBrands) errors.push('Not every governed brand is covered');
  if (errors.length) fail(`Product blueprint validation failed:\n- ${errors.join('\n- ')}`);
  return rows;
}

function printCoverage(rows) {
  console.log('\nCatalog product-master blueprint');
  console.log(`  ${rows.length} product masters · ${rows.length * 3} variants · ${CATALOG_PRODUCT_MASTER_COUNTS.categories} categories`);
  console.log(`  ${CATALOG_PRODUCT_MASTER_COUNTS.uniqueBrands} unique brands · ${CATALOG_PRODUCT_MASTER_COUNTS.relationships} category/brand relationships`);
  const masterAttributes = rows.reduce((total, row) => total + row.payload.attributes.length, 0);
  const variantAttributes = rows.reduce((total, row) => total + row.payload.variants.reduce((sum, variant) => sum + variant.attributes.length, 0), 0);
  console.log(`  ${rows.length * 4} unique master/variant SKUs · 0 media records`);
  console.log(`  ${masterAttributes} master attributes · ${variantAttributes} variant attributes · ${CATALOG_PRODUCT_MASTER_COUNTS.complianceRecords} pending compliance records`);
  console.log(`  ${CATALOG_PRODUCT_MASTER_COUNTS.bundleComponents} deterministic bundle component relationships`);
}

async function loadDependencies(rows) {
  if (!mongoose.isValidObjectId(options.actorId)) fail(`Invalid --actor ObjectId: ${options.actorId}`);
  const categorySlugs = [...new Set(rows.map((row) => row.categorySlug))];
  const brandNames = [...new Set(rows.map((row) => row.brandName))];
  const brandSlugs = brandNames.map(brandSlug);
  const [actor, categories, brands] = await Promise.all([
    User.findById(options.actorId).select('role status'),
    Category.find({ slug: { $in: categorySlugs }, isDeleted: { $ne: true } }).lean(),
    Brand.find({ $or: [{ name: { $in: brandNames } }, { slug: { $in: brandSlugs } }], isDeleted: { $ne: true } }).lean(),
  ]);
  if (!actor) fail(`Super-admin actor ${options.actorId} does not exist`);
  if (actor.role !== 'super_admin' || actor.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin (found ${actor.role}/${actor.status})`);

  const categoryBySlug = new Map();
  for (const category of categories) {
    if (categoryBySlug.has(category.slug)) fail(`Duplicate category slug in database: ${category.slug}`);
    categoryBySlug.set(category.slug, category);
  }
  const missingCategories = categorySlugs.filter((slug) => !categoryBySlug.has(slug));
  if (missingCategories.length) fail(`Missing ${missingCategories.length} required categories: ${missingCategories.join(', ')}. Apply the taxonomy seed first.`);
  const invalidCategories = categories.filter((category) => category.status !== 'active' || Number(category.level) < 1);
  if (invalidCategories.length) fail(`Categories must be active non-root records: ${invalidCategories.map((category) => `${category.slug}(${category.status}/level-${category.level})`).join(', ')}`);

  const brandByName = new Map();
  const brandBySlug = new Map();
  for (const brand of brands) {
    const nameKey = normalizeName(brand.name);
    if (brandByName.has(nameKey) && id(brandByName.get(nameKey)) !== id(brand)) fail(`Duplicate brand name in database: ${brand.name}`);
    if (brandBySlug.has(brand.slug) && id(brandBySlug.get(brand.slug)) !== id(brand)) fail(`Duplicate brand slug in database: ${brand.slug}`);
    brandByName.set(nameKey, brand); brandBySlug.set(brand.slug, brand);
  }
  const brandByRequestedName = new Map();
  for (const name of brandNames) {
    const byName = brandByName.get(normalizeName(name));
    const bySlug = brandBySlug.get(brandSlug(name));
    if (byName && bySlug && id(byName) !== id(bySlug)) fail(`Brand identity collision for ${name}: name and slug resolve to different documents`);
    const brand = byName || bySlug;
    if (!brand) fail(`Required brand is missing: ${name} (${brandSlug(name)}). Apply the brand seed first.`);
    if (brand.status !== 'active') fail(`Required brand ${brand.name} is not active (${brand.status})`);
    brandByRequestedName.set(name, brand);
  }

  // Validate the generated values against the actual category schemas, once per
  // category (brand substitutions do not change field types or option domains).
  for (const categorySlug of categorySlugs) {
    const row = rows.find((candidate) => candidate.categorySlug === categorySlug);
    const category = categoryBySlug.get(categorySlug);
    const databaseRequirements = category.complianceRequirements || [];
    const expectedComplianceKeys = new Set(row.compliance.map((record) => `${record.type}:${record.code}`));
    const databaseComplianceKeys = new Set(databaseRequirements.map((requirement) => `${requirement.type}:${requirement.code}`));
    const missingCompliance = [...databaseComplianceKeys].filter((key) => !expectedComplianceKeys.has(key));
    const staleCompliance = [...expectedComplianceKeys].filter((key) => !databaseComplianceKeys.has(key));
    if (missingCompliance.length || staleCompliance.length) {
      fail(`${categorySlug}: compliance blueprint differs from the database (missing ${missingCompliance.join(', ') || 'none'}; stale ${staleCompliance.join(', ') || 'none'})`);
    }
    const masterValidation = await categoryService.validateAttributes(category._id, row.payload.attributes, { scope: 'master' });
    if (!masterValidation.ok) fail(`${categorySlug}: master attributes do not match the database schema: ${JSON.stringify(masterValidation.errors)}`);
    for (const variant of row.payload.variants) {
      const validation = await categoryService.validateAttributes(category._id, variant.attributes, { scope: 'variant' });
      if (!validation.ok) fail(`${categorySlug}/${variant.sku}: variant attributes do not match the database schema: ${JSON.stringify(validation.errors)}`);
    }
  }
  return { categoryBySlug, brandByRequestedName };
}

async function buildPlan(rows, dependencies) {
  const masterSkus = rows.map((row) => row.payload.skuGlobal);
  const masterSlugs = rows.map((row) => row.payload.slug);
  const masterTitles = rows.map((row) => row.payload.title);
  const variantSkus = rows.flatMap((row) => row.payload.variants.map((variant) => variant.sku));
  const [masters, foreignVariants] = await Promise.all([
    ProductMaster.find({ $or: [{ skuGlobal: { $in: masterSkus } }, { slug: { $in: masterSlugs } }, { title: { $in: masterTitles } }] }),
    ProductVariant.find({ sku: { $in: masterSkus } }).select('sku productMasterId').lean(),
  ]);
  if (foreignVariants.length) fail(`A master SKU is already used by a variant: ${foreignVariants.map((variant) => variant.sku).join(', ')}`);
  const variants = await ProductVariant.find({
    $or: [
      { sku: { $in: variantSkus } },
      { productMasterId: { $in: masters.map((master) => master._id) } },
    ],
  }).lean();
  const [masterAttributes, variantAttributes, complianceRecords, bundleComponents] = await Promise.all([
    ProductAttributeValue.find({ productMasterId: { $in: masters.map((master) => master._id) } })
      .select('productMasterId attributeKey value unit').lean(),
    ProductVariantAttributeValue.find({ productVariantId: { $in: variants.map((variant) => variant._id) } })
      .select('productVariantId attributeKey value unit').lean(),
    ProductCompliance.find({ productMasterId: { $in: masters.map((master) => master._id) } }).lean(),
    ProductBundleComponent.find({ bundleMasterId: { $in: masters.map((master) => master._id) } })
      .select('bundleMasterId').lean(),
  ]);

  const masterBySku = new Map(); const masterBySlug = new Map(); const liveMasterByTitle = new Map();
  for (const master of masters) {
    masterBySku.set(master.skuGlobal, master); masterBySlug.set(master.slug, master);
    if (['active', 'pending_review'].includes(master.status)) liveMasterByTitle.set(master.title, master);
  }
  const variantBySku = new Map(variants.filter((variant) => variant.sku).map((variant) => [variant.sku, variant]));
  const variantsByMaster = new Map();
  for (const variant of variants) {
    const key = id(variant.productMasterId);
    if (!variantsByMaster.has(key)) variantsByMaster.set(key, []);
    variantsByMaster.get(key).push(variant);
  }
  const masterAttributesByKey = new Map();
  for (const attribute of masterAttributes) {
    const key = id(attribute.productMasterId);
    if (!masterAttributesByKey.has(key)) masterAttributesByKey.set(key, new Map());
    masterAttributesByKey.get(key).set(attribute.attributeKey, attribute);
  }
  const variantAttributesByKey = new Map();
  for (const attribute of variantAttributes) {
    const key = id(attribute.productVariantId);
    if (!variantAttributesByKey.has(key)) variantAttributesByKey.set(key, new Map());
    variantAttributesByKey.get(key).set(attribute.attributeKey, attribute);
  }
  const complianceByMaster = new Map();
  for (const record of complianceRecords) {
    const key = id(record.productMasterId);
    if (!complianceByMaster.has(key)) complianceByMaster.set(key, []);
    complianceByMaster.get(key).push(record);
  }
  const bundleMasterIds = new Set(bundleComponents.map((component) => id(component.bundleMasterId)));

  return rows.map((row) => {
    const skuMatch = masterBySku.get(row.payload.skuGlobal);
    const slugMatch = masterBySlug.get(row.payload.slug);
    if (skuMatch && slugMatch && id(skuMatch) !== id(slugMatch)) fail(`${row.payload.skuGlobal}: SKU and slug belong to different masters`);
    const existing = skuMatch || slugMatch;
    const category = dependencies.categoryBySlug.get(row.categorySlug);
    const brand = dependencies.brandByRequestedName.get(row.brandName);
    if (!existing) {
      const titleCollision = liveMasterByTitle.get(row.payload.title);
      if (titleCollision) fail(`${row.payload.skuGlobal}: title is already used by ${titleCollision.skuGlobal}`);
      for (const variant of row.payload.variants) {
        const collision = variantBySku.get(variant.sku);
        if (collision) fail(`${variant.sku}: variant SKU already belongs to master ${collision.productMasterId}`);
      }
      return { action: 'create', row, category, brand };
    }
    if (existing.skuGlobal !== row.payload.skuGlobal || existing.slug !== row.payload.slug) fail(`${row.payload.skuGlobal}: identity collides with existing ${existing.skuGlobal}/${existing.slug}`);
    if (id(existing.categoryId) !== id(category) || id(existing.brandId) !== id(brand)) {
      fail(`${row.payload.skuGlobal}: existing master points to category/brand ${existing.categoryId}/${existing.brandId}, expected ${id(category)}/${id(brand)}`);
    }

    const normalizedVariants = productMasterService.normalizeStructure(servicePayload(row)).variants;
    const normalizedBySku = new Map(normalizedVariants.map((variant) => [variant.sku, variant]));
    const existingOnMaster = variantsByMaster.get(id(existing)) || [];
    for (const variant of row.payload.variants) {
      const existingVariant = variantBySku.get(variant.sku);
      const expectedCombination = normalizedBySku.get(variant.sku).combinationKey;
      if (existingVariant && id(existingVariant.productMasterId) !== id(existing)) fail(`${variant.sku}: variant belongs to another master`);
      if (existingVariant && existingVariant.combinationKey !== expectedCombination) {
        fail(`${variant.sku}: existing option combination differs from the reference blueprint`);
      }
      if (!existingVariant) {
        const combinationCollision = existingOnMaster.find((candidate) => candidate.combinationKey === expectedCombination);
        if (combinationCollision) fail(`${variant.sku}: expected combination already exists as SKU ${combinationCollision.sku || '(blank)'}`);
      }
    }

    const existingMasterAttributes = masterAttributesByKey.get(id(existing));
    const missingMasterAttributes = row.payload.attributes.filter((attribute) => {
      const current = existingMasterAttributes?.get(attribute.key);
      return !current || isLegacyPlaceholder(current.value);
    });
    const missingVariants = row.payload.variants.filter((variant) => !variantBySku.has(variant.sku));
    const missingVariantAttributes = [];
    for (const variant of row.payload.variants) {
      const existingVariant = variantBySku.get(variant.sku);
      if (!existingVariant) continue;
      const currentAttributes = variantAttributesByKey.get(id(existingVariant));
      const missing = variant.attributes.filter((attribute) => {
        const current = currentAttributes?.get(attribute.key);
        return !current || isLegacyPlaceholder(current.value);
      });
      if (missing.length) missingVariantAttributes.push({ blueprint: variant, existing: existingVariant, missing });
    }
    const existingCompliance = complianceByMaster.get(id(existing)) || [];
    const existingComplianceKeys = new Set(existingCompliance
      .filter((record) => !record.variantId)
      .map((record) => `${record.type}:${record.code}`));
    const missingCompliance = row.compliance.filter((record) => !existingComplianceKeys.has(`${record.type}:${record.code}`));
    const missingBundleComponents = row.bundleComponentCategorySlugs.length > 0 && !bundleMasterIds.has(id(existing));
    const incomplete = missingMasterAttributes.length || missingVariants.length || missingVariantAttributes.length || missingCompliance.length || missingBundleComponents;
    return {
      action: incomplete ? 'repair' : 'unchanged', row, category, brand, existing,
      missingMasterAttributes, missingVariants, missingVariantAttributes, missingCompliance, missingBundleComponents,
    };
  });
}

function printPlan(plan) {
  const count = (action) => plan.filter((item) => item.action === action).length;
  console.log('\nDatabase plan');
  console.log(`  create ${count('create')} · repair ${count('repair')} · unchanged ${count('unchanged')}`);
  const missingMasterAttributes = plan.reduce((sum, item) => sum + (item.missingMasterAttributes?.length || 0), 0);
  const missingVariants = plan.reduce((sum, item) => sum + (item.missingVariants?.length || 0), 0);
  const missingVariantAttributes = plan.reduce((sum, item) => sum + (item.missingVariantAttributes?.reduce((n, entry) => n + entry.missing.length, 0) || 0), 0);
  const missingCompliance = plan.reduce((sum, item) => sum + (item.missingCompliance?.length || 0), 0);
  const missingBundles = plan.filter((item) => item.missingBundleComponents).length;
  if (count('repair')) console.log(`  repairs: ${missingMasterAttributes} master attributes · ${missingVariants} variants · ${missingVariantAttributes} variant attributes · ${missingCompliance} compliance records · ${missingBundles} bundle structures`);
  for (const item of plan.filter((entry) => entry.action !== 'unchanged')) {
    console.log(`  ${item.action.toUpperCase().padEnd(6)} ${item.row.payload.skuGlobal} · ${item.row.categorySlug} · ${item.row.brandName}`);
  }
}

async function insertVariantAttributes(masterId, variantPairs) {
  const docs = variantPairs.flatMap(({ blueprint, existing }) => blueprint.attributes.map((attribute, sortOrder) => ({
    productMasterId: masterId, productVariantId: existing._id,
    attributeKey: attribute.key, value: attribute.value, unit: attribute.unit || null, sortOrder,
  })));
  if (!docs.length) return 0;
  const candidates = docs.map((document) => new ProductVariantAttributeValue(document));
  await Promise.all(candidates.map((candidate) => candidate.validate()));
  await ProductVariantAttributeValue.insertMany(docs, { ordered: true });
  return docs.length;
}

async function createOne(item) {
  // Validate subordinate EAV rows before creating a master; this makes the only
  // post-create insert deterministic and schema-safe.
  const dummyMaster = new mongoose.Types.ObjectId();
  const dummyVariants = item.row.payload.variants.map(() => new mongoose.Types.ObjectId());
  const candidates = item.row.payload.variants.flatMap((variant, index) => variant.attributes.map((attribute, sortOrder) => new ProductVariantAttributeValue({
    productMasterId: dummyMaster, productVariantId: dummyVariants[index],
    attributeKey: attribute.key, value: attribute.value, unit: attribute.unit || null, sortOrder,
  })));
  await Promise.all(candidates.map((candidate) => candidate.validate()));

  const master = await productMasterService.createMaster({
    payload: servicePayload(item.row, item.category._id, item.brand._id),
    actorId: options.actorId,
    status: options.status,
  });
  const createdVariants = await ProductVariant.find({ productMasterId: master._id });
  const bySku = new Map(createdVariants.map((variant) => [variant.sku, variant]));
  const pairs = item.row.payload.variants.map((blueprint) => {
    const existing = bySku.get(blueprint.sku);
    if (!existing) fail(`${item.row.payload.skuGlobal}: service did not create variant ${blueprint.sku}`);
    return { blueprint, existing };
  });
  await insertVariantAttributes(master._id, pairs);
  let completedMaster = master;
  if (item.row.compliance.length) {
    await catalogStructureService.replaceCompliance({
      masterId: master._id,
      records: item.row.compliance,
      expectedVersion: master.version,
      actorId: options.actorId,
    });
    completedMaster = await ProductMaster.findById(master._id);
  }
  return { master: completedMaster, variants: createdVariants.length, compliance: item.row.compliance.length };
}

function compliancePayload(record) {
  return {
    variantId: record.variantId || null,
    type: record.type,
    code: record.code,
    title: record.title,
    authority: record.authority || null,
    jurisdiction: {
      country: record.jurisdiction?.country || 'IN',
      state: record.jurisdiction?.state || null,
      regions: record.jurisdiction?.regions || [],
    },
    status: record.status || 'draft',
    validFrom: record.validFrom || null,
    validUntil: record.validUntil || null,
    issuerReference: record.issuerReference || null,
    documents: (record.documents || []).map((document) => ({
      name: document.name, url: document.url, mimeType: document.mimeType || null, checksum: document.checksum || null,
    })),
    restrictions: record.restrictions || [],
    metadata: record.metadata || {},
    verifiedBy: record.verifiedBy || null,
    verifiedAt: record.verifiedAt || null,
  };
}

async function repairOne(item) {
  let master = await ProductMaster.findById(item.existing._id);
  if (item.missingMasterAttributes.length) {
    const existingAttributes = await ProductAttributeValue.find({ productMasterId: master._id }).lean();
    const mergedByKey = new Map(existingAttributes.map((attribute) => [
      attribute.attributeKey,
      { key: attribute.attributeKey, value: attribute.value, unit: attribute.unit || null },
    ]));
    for (const attribute of item.missingMasterAttributes) mergedByKey.set(attribute.key, attribute);
    const merged = [...mergedByKey.values()];
    await productMasterService.setAttributes({
      id: master._id, attributes: merged, expectedVersion: master.version,
      actorId: options.actorId,
    });
    master = await ProductMaster.findById(master._id);
  }

  const createdPairs = [];
  for (const variant of item.missingVariants) {
    const { attributes, ...payload } = variant;
    // Domain writes intentionally remain ordered to preserve optimistic versions.
    // eslint-disable-next-line no-await-in-loop
    const created = await productMasterService.addVariant({
      id: master._id, payload, expectedVersion: master.version, actorId: options.actorId,
    });
    createdPairs.push({ blueprint: variant, existing: created });
    // This reread must be sequential: the next write needs the preceding version.
    // eslint-disable-next-line no-await-in-loop
    master = await ProductMaster.findById(master._id);
  }
  await insertVariantAttributes(master._id, createdPairs);

  for (const entry of item.missingVariantAttributes) {
    const existingRows = await ProductVariantAttributeValue.find({ productVariantId: entry.existing._id }).lean();
    const mergedByKey = new Map(existingRows.map((attribute) => [
      attribute.attributeKey,
      { key: attribute.attributeKey, value: attribute.value, unit: attribute.unit || null },
    ]));
    for (const attribute of entry.missing) mergedByKey.set(attribute.key, attribute);
    const merged = [...mergedByKey.values()];
    // Ordered service writes preserve auditing and optimistic-lock semantics.
    // eslint-disable-next-line no-await-in-loop
    await catalogStructureService.setVariantAttributes({
      masterId: master._id, variantId: entry.existing._id, attributes: merged,
      expectedVersion: master.version, actorId: options.actorId,
    });
    // This reread must be sequential: the next repair needs the preceding version.
    // eslint-disable-next-line no-await-in-loop
    master = await ProductMaster.findById(master._id);
  }

  if (item.missingCompliance.length) {
    const existingCompliance = await ProductCompliance.find({ productMasterId: master._id }).lean();
    const merged = [
      ...existingCompliance.map(compliancePayload),
      ...item.missingCompliance,
    ];
    await catalogStructureService.replaceCompliance({
      masterId: master._id,
      records: merged,
      expectedVersion: master.version,
      actorId: options.actorId,
    });
    master = await ProductMaster.findById(master._id);
  }
  return { master, variants: item.missingVariants.length, compliance: item.missingCompliance.length };
}

async function ensureBundleComponents(rows, result) {
  const masterRows = await ProductMaster.find({ skuGlobal: { $in: rows.map((row) => row.payload.skuGlobal) } })
    .select('_id skuGlobal version defaultSellingUnit').lean();
  const masterBySku = new Map(masterRows.map((master) => [master.skuGlobal, master]));
  const blueprintsByCategory = new Map();
  for (const row of rows) {
    if (!blueprintsByCategory.has(row.categorySlug)) blueprintsByCategory.set(row.categorySlug, []);
    blueprintsByCategory.get(row.categorySlug).push(row);
  }

  for (const row of rows.filter((candidate) => candidate.bundleComponentCategorySlugs.length)) {
    const bundle = masterBySku.get(row.payload.skuGlobal);
    if (!bundle) continue;
    // Each replacement is an audited optimistic-version transaction and must remain sequential.
    // eslint-disable-next-line no-await-in-loop
    const existing = await ProductBundleComponent.find({ bundleMasterId: bundle._id }).lean();
    if (existing.length) continue; // Any operator-authored composition wins; never replace it silently.
    try {
      const components = row.bundleComponentCategorySlugs.map((categorySlug, index) => {
        const candidates = blueprintsByCategory.get(categorySlug) || [];
        const targetBlueprint = candidates.find((candidate) => candidate.brandName === row.brandName) || candidates[0];
        const target = targetBlueprint && masterBySku.get(targetBlueprint.payload.skuGlobal);
        if (!target) fail(`${row.reference}: component target for ${categorySlug} was not created`);
        return {
          componentMasterId: target._id,
          componentVariantId: null,
          quantity: 1,
          unitCode: target.defaultSellingUnit,
          selectionGroup: categorySlug.replace(/-/g, '_'),
          required: true,
          defaultSelected: true,
          minSelections: 1,
          maxSelections: 1,
          priceAdjustment: 0,
          sortOrder: index,
          status: 'active',
        };
      });
      // Bundle writes are sequential so optimistic versions and audit events remain deterministic.
      // eslint-disable-next-line no-await-in-loop
      await catalogStructureService.replaceBundleComponents({
        masterId: bundle._id,
        components,
        expectedVersion: bundle.version,
        actorId: options.actorId,
      });
      result.bundleComponentsCreated += components.length;
    } catch (error) {
      result.failures.push({ sku: row.payload.skuGlobal, error: `bundle components: ${error.message}` });
      if (!options.continueOnError) throw error;
    }
  }
}

async function applyPlan(plan, rows) {
  const result = { created: 0, repaired: 0, unchanged: 0, variantsCreated: 0, complianceCreated: 0, bundleComponentsCreated: 0, failures: [] };
  for (const item of plan) {
    try {
      if (item.action === 'unchanged') { result.unchanged += 1; continue; }
      // Catalog audit/event order and deterministic failure reporting are more
      // valuable than unbounded parallel writes for a one-time registry seed.
      // eslint-disable-next-line no-await-in-loop
      const outcome = item.action === 'create' ? await createOne(item) : await repairOne(item);
      if (item.action === 'create') result.created += 1;
      else result.repaired += 1;
      result.variantsCreated += outcome.variants;
      result.complianceCreated += outcome.compliance || 0;
    } catch (error) {
      result.failures.push({ sku: item.row.payload.skuGlobal, error: error.message });
      if (!options.continueOnError) throw error;
    }
  }
  await ensureBundleComponents(rows, result);
  return result;
}

async function main() {
  const rows = assertBlueprint();
  printCoverage(rows);
  if (options.validateOnly) {
    console.log('\n✓ Product-master blueprint is internally valid and matches the create contract.');
    return;
  }

  await connectDb();
  await assertUniversalVariantIndexContract(mongoose.connection);
  const dependencies = await loadDependencies(rows);
  const plan = await buildPlan(rows, dependencies);
  printPlan(plan);

  if (!options.apply) {
    console.log(`\nDRY RUN — no product documents were changed. Add --apply to create them as ${options.status}.`);
    if (options.status !== 'active') console.log('Use --active only after accepting that reference records may become globally discoverable.');
    return;
  }

  const result = await applyPlan(plan, rows);
  console.log(`\n✓ Product registry applied: ${result.created} created · ${result.repaired} repaired · ${result.unchanged} unchanged.`);
  console.log(`  ${result.variantsCreated} variants · ${result.complianceCreated} pending compliance records · ${result.bundleComponentsCreated} bundle components created during this run`);
  console.log(`  master media 0 · variant media 0 · status ${options.status}`);
  if (result.failures.length) {
    console.error(`\n${result.failures.length} product master(s) failed and can be retried safely:`);
    for (const failure of result.failures) console.error(`  ${failure.sku}: ${failure.error}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`\n✗ Catalog product-master seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await disconnectDb();
  });
