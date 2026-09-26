#!/usr/bin/env node
/**
 * Seed a large deterministic product registry into the parallel `sandbox-*`
 * taxonomy. Existing brands are resolved exactly and are never created or
 * modified. Every master has three active variants, all mandatory scoped EAV,
 * rich commerce structure and empty media. No compliance rows are generated.
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
import ProductBundleComponent from '../src/models/productBundleComponent.model.js';
import productMasterService from '../src/services/productMaster.service.js';
import catalogStructureService from '../src/services/catalogStructure.service.js';
import { masterCreateSchema } from '../src/utils/validators/catalog.validators.js';
import { CATEGORY_PLAYBOOKS } from '../src/data/catalogCategoryPlaybooks.js';
import { CATEGORY_BRAND_ASSIGNMENTS } from '../src/data/catalogBrandBlueprints.js';
import {
  buildSandboxProductBlueprints,
  buildSandboxTaxonomyBlueprints,
  CATALOG_SANDBOX_COUNTS,
} from '../src/data/catalogSandboxBlueprints.js';

const DEFAULT_ACTOR_ID = '6a97b0e9a61173c01d040435';
const DUMMY_ID = '000000000000000000000001';
const argv = process.argv.slice(2);
const args = new Set(argv);
const valueArg = (name) => argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const options = {
  apply: args.has('--apply'),
  validateOnly: args.has('--validate-only'),
  continueOnError: args.has('--continue-on-error'),
  active: args.has('--active'),
  acknowledged: args.has('--acknowledge-noncompliant-sandbox'),
  actorId: valueArg('--actor') || DEFAULT_ACTOR_ID,
};

const fail = (message) => { throw new Error(message); };
const id = (value) => String(value?._id || value?.id || value || '');
const normalizeName = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const brandSlug = (value) => String(value || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/['’]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
const fieldContract = (field) => ({
  key: field.key, type: field.type || 'string', required: Boolean(field.required),
  appliesTo: field.appliesTo || 'master', options: [...(field.options || [])],
  unit: field.unit || null, min: field.min ?? null, max: field.max ?? null, regex: field.regex || null,
});

function servicePayload(row, categoryId = DUMMY_ID, brandId = DUMMY_ID) {
  return {
    ...row.payload,
    categoryId,
    brandId,
    variants: row.payload.variants.map(({ attributes: _attributes, ...variant }) => variant),
  };
}

function fieldValueError(field, value) {
  if (value === undefined || value === null || value === '') return 'required value is empty';
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
    if (field.min != null && value < field.min) return `must be >= ${field.min}`;
    if (field.max != null && value > field.max) return `must be <= ${field.max}`;
  }
  if (field.type === 'boolean' && typeof value !== 'boolean') return 'must be boolean';
  if (field.type === 'multi_select' && (!Array.isArray(value) || !value.length)) return 'must be a non-empty array';
  if (field.type === 'json' && (!value || typeof value !== 'object' || Array.isArray(value))) return 'must be an object';
  if (field.type === 'select' && field.options?.length && !field.options.includes(value)) return `must be one of ${field.options.join(', ')}`;
  if (field.type === 'multi_select' && field.options?.length && value.some((entry) => !field.options.includes(entry))) return 'contains an unsupported selection';
  if (field.regex && typeof value === 'string' && !new RegExp(field.regex).test(value)) return `does not match ${field.regex}`;
  return null;
}

function validateBlueprint(rows) {
  const errors = [];
  const masterSkus = new Set();
  const masterSlugs = new Set();
  const variantSkus = new Set();
  const playbookById = new Map(CATEGORY_PLAYBOOKS.map((playbook) => [playbook.id, playbook]));
  let masterAttributes = 0;
  let variantAttributes = 0;
  let bundleComponents = 0;

  if (rows.length !== CATALOG_SANDBOX_COUNTS.productMasters) errors.push(`Expected ${CATALOG_SANDBOX_COUNTS.productMasters} masters, generated ${rows.length}`);
  for (const row of rows) {
    const playbook = playbookById.get(row.canonicalCategorySlug);
    if (!playbook) { errors.push(`${row.reference}: canonical category is unknown`); continue; }
    if (!CATEGORY_BRAND_ASSIGNMENTS[row.canonicalCategorySlug]?.includes(row.brandName)) errors.push(`${row.reference}: invalid category/brand relationship`);
    if (row.compliance.length) errors.push(`${row.reference}: compliance must remain empty`);
    if (!row.payload.tags.includes('sandbox-data')) errors.push(`${row.reference}: sandbox ownership marker is missing`);
    if (row.payload.images.length || row.payload.variants.some((variant) => variant.images.length)) errors.push(`${row.reference}: all media must remain empty`);
    if (masterSkus.has(row.payload.skuGlobal)) errors.push(`${row.reference}: duplicate master SKU`);
    if (masterSlugs.has(row.payload.slug)) errors.push(`${row.reference}: duplicate master slug`);
    masterSkus.add(row.payload.skuGlobal); masterSlugs.add(row.payload.slug);
    if (row.payload.variants.length !== 3) errors.push(`${row.reference}: exactly three variants are required`);
    if (row.payload.variants.filter((variant) => variant.isDefault).length !== 1) errors.push(`${row.reference}: exactly one default variant is required`);
    bundleComponents += row.bundleComponentCategorySlugs.length;

    const requiredMaster = playbook.attributes.filter((field) => field.required && ['master', 'both'].includes(field.appliesTo || 'master'));
    const requiredVariant = playbook.attributes.filter((field) => field.required && ['variant', 'both'].includes(field.appliesTo));
    const masterByKey = new Map(row.payload.attributes.map((attribute) => [attribute.key, attribute]));
    if (masterByKey.size !== requiredMaster.length) errors.push(`${row.reference}: expected ${requiredMaster.length} mandatory master attributes, generated ${masterByKey.size}`);
    for (const field of requiredMaster) {
      const attribute = masterByKey.get(field.key);
      if (!attribute) errors.push(`${row.reference}: missing master attribute ${field.key}`);
      else {
        const issue = fieldValueError(field, attribute.value);
        if (issue) errors.push(`${row.reference}/${field.key}: ${issue}`);
      }
    }
    masterAttributes += row.payload.attributes.length;

    for (const variant of row.payload.variants) {
      if (variantSkus.has(variant.sku) || masterSkus.has(variant.sku)) errors.push(`${variant.sku}: duplicate variant SKU`);
      variantSkus.add(variant.sku);
      const byKey = new Map(variant.attributes.map((attribute) => [attribute.key, attribute]));
      if (byKey.size !== requiredVariant.length) errors.push(`${variant.sku}: expected ${requiredVariant.length} mandatory variant attributes, generated ${byKey.size}`);
      for (const field of requiredVariant) {
        const attribute = byKey.get(field.key);
        if (!attribute) errors.push(`${variant.sku}: missing variant attribute ${field.key}`);
        else {
          const issue = fieldValueError(field, attribute.value);
          if (issue) errors.push(`${variant.sku}/${field.key}: ${issue}`);
        }
      }
      variantAttributes += variant.attributes.length;
    }
    const contract = masterCreateSchema.validate(servicePayload(row), { abortEarly: false });
    if (contract.error) errors.push(`${row.reference}: ${contract.error.details.map((detail) => detail.message).join('; ')}`);
  }
  if (variantSkus.size !== CATALOG_SANDBOX_COUNTS.variants) errors.push(`Expected ${CATALOG_SANDBOX_COUNTS.variants} unique variant SKUs, generated ${variantSkus.size}`);
  if (errors.length) fail(`Sandbox product validation failed:\n- ${errors.slice(0, 100).join('\n- ')}${errors.length > 100 ? `\n- … ${errors.length - 100} more` : ''}`);
  return { rows, masterAttributes, variantAttributes, bundleComponents };
}

function printCoverage(metrics) {
  console.log('\nNon-compliance sandbox product registry');
  console.log(`  ${CATALOG_SANDBOX_COUNTS.productMasters} masters · ${CATALOG_SANDBOX_COUNTS.variants} variants · ${CATALOG_SANDBOX_COUNTS.leaves} categories`);
  console.log(`  ${CATALOG_SANDBOX_COUNTS.uniqueBrands} existing brands · ${CATALOG_SANDBOX_COUNTS.categoryBrandRelationships} category/brand relationships`);
  console.log(`  ${metrics.masterAttributes} mandatory master EAV · ${metrics.variantAttributes} mandatory variant EAV`);
  console.log(`  ${metrics.bundleComponents} bundle component relationships · 0 compliance records · 0 media records`);
}

async function verifyActor() {
  if (!mongoose.isValidObjectId(options.actorId)) fail(`Invalid --actor ObjectId: ${options.actorId}`);
  const actor = await User.findById(options.actorId).select('role status');
  if (!actor) fail(`Super-admin actor ${options.actorId} does not exist`);
  if (actor.role !== 'super_admin' || actor.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin`);
}

async function loadDependencies(rows) {
  await verifyActor();
  const expectedTaxonomy = buildSandboxTaxonomyBlueprints().filter((row) => row.kind === 'leaf');
  const categories = await Category.find({ slug: { $in: expectedTaxonomy.map((row) => row.slug) }, isDeleted: { $ne: true } });
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const missingCategories = expectedTaxonomy.filter((row) => !categoryBySlug.has(row.slug)).map((row) => row.slug);
  if (missingCategories.length) fail(`Run the sandbox taxonomy seed first; missing categories: ${missingCategories.join(', ')}`);

  for (const expected of expectedTaxonomy) {
    const category = categoryBySlug.get(expected.slug);
    if ((category.complianceRequirements || []).length) fail(`${expected.slug}: sandbox category unexpectedly has compliance requirements`);
    const actualContract = (category.attributeSchema || []).map(fieldContract);
    const expectedContract = expected.attributeSchema.map(fieldContract);
    if (JSON.stringify(actualContract) !== JSON.stringify(expectedContract)) {
      fail(`${expected.slug}: mandatory schema contract differs from the sandbox blueprint; rerun the taxonomy seed`);
    }
  }

  const wantedNames = [...new Set(rows.map((row) => row.brandName))];
  const wantedSlugs = wantedNames.map(brandSlug);
  const brands = await Brand.find({
    isDeleted: { $ne: true },
    $or: [{ name: { $in: wantedNames } }, { slug: { $in: wantedSlugs } }],
  });
  const brandsByName = new Map();
  const brandsBySlug = new Map();
  for (const brand of brands) {
    const nameKey = normalizeName(brand.name);
    if (brandsByName.has(nameKey) && id(brandsByName.get(nameKey)) !== id(brand)) fail(`Ambiguous brand name: ${brand.name}`);
    brandsByName.set(nameKey, brand);
    if (brand.slug) brandsBySlug.set(brand.slug, brand);
  }
  const brandByRequestedName = new Map();
  for (const name of wantedNames) {
    const brand = brandsByName.get(normalizeName(name)) || brandsBySlug.get(brandSlug(name));
    if (!brand) fail(`Existing brand not found: ${name}. Run the canonical brand seed first.`);
    brandByRequestedName.set(name, brand);
  }

  return { categoryBySlug, brandByRequestedName };
}

async function buildPlan(rows, dependencies) {
  const masterSkus = rows.map((row) => row.payload.skuGlobal);
  const masterSlugs = rows.map((row) => row.payload.slug);
  const variantSkus = rows.flatMap((row) => row.payload.variants.map((variant) => variant.sku));
  const [masters, slugCollisions, variants] = await Promise.all([
    ProductMaster.find({ skuGlobal: { $in: masterSkus } }),
    ProductMaster.find({ slug: { $in: masterSlugs } }).select('_id skuGlobal slug'),
    ProductVariant.find({ sku: { $in: variantSkus } }),
  ]);
  const masterBySku = new Map(masters.map((master) => [master.skuGlobal, master]));
  const masterById = new Map(masters.map((master) => [id(master), master]));
  const slugByValue = new Map(slugCollisions.map((master) => [master.slug, master]));
  const variantBySku = new Map();
  const variantsByMaster = new Map();
  for (const variant of variants) {
    if (variantBySku.has(variant.sku) && id(variantBySku.get(variant.sku)) !== id(variant)) fail(`Duplicate existing variant SKU: ${variant.sku}`);
    variantBySku.set(variant.sku, variant);
    const key = id(variant.productMasterId);
    if (!variantsByMaster.has(key)) variantsByMaster.set(key, []);
    variantsByMaster.get(key).push(variant);
  }

  const [masterEav, variantEav, components] = await Promise.all([
    ProductAttributeValue.find({ productMasterId: { $in: masters.map((master) => master._id) } }).lean(),
    ProductVariantAttributeValue.find({ productMasterId: { $in: masters.map((master) => master._id) } }).lean(),
    ProductBundleComponent.find({ bundleMasterId: { $in: masters.map((master) => master._id) } }).select('bundleMasterId').lean(),
  ]);
  const masterKeys = new Map();
  for (const attribute of masterEav) {
    const key = id(attribute.productMasterId);
    if (!masterKeys.has(key)) masterKeys.set(key, new Set());
    masterKeys.get(key).add(attribute.attributeKey);
  }
  const variantKeys = new Map();
  for (const attribute of variantEav) {
    const key = id(attribute.productVariantId);
    if (!variantKeys.has(key)) variantKeys.set(key, new Set());
    variantKeys.get(key).add(attribute.attributeKey);
  }
  const componentMasterIds = new Set(components.map((component) => id(component.bundleMasterId)));

  return rows.map((row) => {
    const category = dependencies.categoryBySlug.get(row.categorySlug);
    const brand = dependencies.brandByRequestedName.get(row.brandName);
    const existing = masterBySku.get(row.payload.skuGlobal);
    const slugOwner = slugByValue.get(row.payload.slug);
    if (slugOwner && (!existing || id(slugOwner) !== id(existing))) fail(`${row.reference}: slug is owned by another master`);
    if (!existing) {
      const variantCollision = row.payload.variants.find((variant) => variantBySku.has(variant.sku));
      if (variantCollision) fail(`${row.reference}: variant SKU ${variantCollision.sku} is already owned by another master`);
      return { action: 'create', row, category, brand };
    }
    if (!existing.tags?.includes('sandbox-data')) fail(`${row.reference}: SKU collision with a non-sandbox master`);
    if (id(existing.categoryId) !== id(category) || id(existing.brandId) !== id(brand)) fail(`${row.reference}: existing master identity differs from the blueprint`);
    masterById.set(id(existing), existing);
    const existingVariants = variantsByMaster.get(id(existing)) || [];
    const existingVariantBySku = new Map(existingVariants.map((variant) => [variant.sku, variant]));
    for (const expectedVariant of row.payload.variants) {
      const owner = variantBySku.get(expectedVariant.sku);
      if (owner && id(owner.productMasterId) !== id(existing)) fail(`${row.reference}: variant SKU ${expectedVariant.sku} belongs to another master`);
    }
    const missingMasterAttributes = row.payload.attributes.filter((attribute) => !masterKeys.get(id(existing))?.has(attribute.key));
    const missingVariants = row.payload.variants.filter((variant) => !existingVariantBySku.has(variant.sku));
    const missingVariantAttributes = row.payload.variants.flatMap((variant) => {
      const current = existingVariantBySku.get(variant.sku);
      if (!current) return [];
      const missing = variant.attributes.filter((attribute) => !variantKeys.get(id(current))?.has(attribute.key));
      return missing.length ? [{ blueprint: variant, current, missing }] : [];
    });
    const missingBundle = row.bundleComponentCategorySlugs.length > 0 && !componentMasterIds.has(id(existing));
    const repair = missingMasterAttributes.length || missingVariants.length || missingVariantAttributes.length || missingBundle;
    return {
      action: repair ? 'repair' : 'unchanged', row, category, brand, existing,
      missingMasterAttributes, missingVariants, missingVariantAttributes, missingBundle,
    };
  });
}

function printPlan(plan) {
  const count = (action) => plan.filter((item) => item.action === action).length;
  const missingMasterAttributes = plan.reduce((sum, item) => sum + (item.missingMasterAttributes?.length || 0), 0);
  const missingVariants = plan.reduce((sum, item) => sum + (item.missingVariants?.length || 0), 0);
  const missingVariantAttributes = plan.reduce((sum, item) => sum + (item.missingVariantAttributes?.reduce((n, entry) => n + entry.missing.length, 0) || 0), 0);
  console.log('\nDatabase plan');
  console.log(`  create ${count('create')} · repair ${count('repair')} · unchanged ${count('unchanged')}`);
  if (count('repair')) console.log(`  repairs: ${missingMasterAttributes} master EAV · ${missingVariants} variants · ${missingVariantAttributes} variant EAV · ${plan.filter((item) => item.missingBundle).length} bundles`);
}

async function insertVariantAttributes(masterId, pairs) {
  const documents = pairs.flatMap(({ blueprint, current }) => blueprint.attributes.map((attribute, index) => ({
    productMasterId: masterId,
    productVariantId: current._id,
    attributeKey: attribute.key,
    value: attribute.value,
    unit: attribute.unit || null,
    sortOrder: index,
  })));
  if (documents.length) await ProductVariantAttributeValue.insertMany(documents, { ordered: true });
}

async function createOne(item) {
  const master = await productMasterService.createMaster({
    payload: servicePayload(item.row, item.category._id, item.brand._id),
    actorId: options.actorId,
    status: options.active ? 'active' : 'pending_review',
  });
  const createdVariants = await ProductVariant.find({ productMasterId: master._id });
  const bySku = new Map(createdVariants.map((variant) => [variant.sku, variant]));
  const pairs = item.row.payload.variants.map((blueprint) => {
    const current = bySku.get(blueprint.sku);
    if (!current) fail(`${item.row.reference}: service did not create ${blueprint.sku}`);
    return { blueprint, current };
  });
  await insertVariantAttributes(master._id, pairs);
  return { variants: createdVariants.length };
}

async function repairOne(item) {
  let master = await ProductMaster.findById(item.existing._id);
  if (item.missingMasterAttributes.length) {
    const existing = await ProductAttributeValue.find({ productMasterId: master._id }).lean();
    const merged = new Map(existing.map((attribute) => [attribute.attributeKey, { key: attribute.attributeKey, value: attribute.value, unit: attribute.unit || null }]));
    for (const attribute of item.missingMasterAttributes) merged.set(attribute.key, attribute);
    await productMasterService.setAttributes({ id: master._id, attributes: [...merged.values()], expectedVersion: master.version, actorId: options.actorId });
    master = await ProductMaster.findById(master._id);
  }
  const newPairs = [];
  for (const blueprint of item.missingVariants) {
    const { attributes, ...payload } = blueprint;
    // Optimistic versions and deterministic audit order require sequential writes.
    // eslint-disable-next-line no-await-in-loop
    const current = await productMasterService.addVariant({ id: master._id, payload, expectedVersion: master.version, actorId: options.actorId });
    newPairs.push({ blueprint, current });
    // The next variant write requires the version produced by the previous write.
    // eslint-disable-next-line no-await-in-loop
    master = await ProductMaster.findById(master._id);
  }
  await insertVariantAttributes(master._id, newPairs);
  for (const entry of item.missingVariantAttributes) {
    const existing = await ProductVariantAttributeValue.find({ productVariantId: entry.current._id }).lean();
    const merged = new Map(existing.map((attribute) => [attribute.attributeKey, { key: attribute.attributeKey, value: attribute.value, unit: attribute.unit || null }]));
    for (const attribute of entry.missing) merged.set(attribute.key, attribute);
    // Each EAV replacement increments the same master version, so writes are sequential.
    // eslint-disable-next-line no-await-in-loop
    await catalogStructureService.setVariantAttributes({
      masterId: master._id, variantId: entry.current._id, attributes: [...merged.values()],
      expectedVersion: master.version, actorId: options.actorId,
    });
    // This reread must remain sequential because the next repair consumes the version it returns.
    // eslint-disable-next-line no-await-in-loop
    master = await ProductMaster.findById(master._id);
  }
  return { variants: item.missingVariants.length };
}

async function ensureBundleComponents(rows, result) {
  const masters = await ProductMaster.find({ skuGlobal: { $in: rows.map((row) => row.payload.skuGlobal) } })
    .select('_id skuGlobal version defaultSellingUnit').lean();
  const bySku = new Map(masters.map((master) => [master.skuGlobal, master]));
  const byCategoryEdition = new Map();
  for (const row of rows) {
    const key = `${row.categorySlug}:${row.editionCode}`;
    if (!byCategoryEdition.has(key)) byCategoryEdition.set(key, []);
    byCategoryEdition.get(key).push(row);
  }
  for (const row of rows.filter((candidate) => candidate.bundleComponentCategorySlugs.length)) {
    const bundle = bySku.get(row.payload.skuGlobal);
    if (!bundle) continue;
    // This existence check must remain sequential with replacement so operator-authored composition always wins.
    // eslint-disable-next-line no-await-in-loop
    if (await ProductBundleComponent.exists({ bundleMasterId: bundle._id })) continue;
    try {
      const components = row.bundleComponentCategorySlugs.map((categorySlug, index) => {
        const candidates = byCategoryEdition.get(`${categorySlug}:${row.editionCode}`) || [];
        const blueprint = candidates.find((candidate) => candidate.brandName === row.brandName) || candidates[0];
        const component = blueprint && bySku.get(blueprint.payload.skuGlobal);
        if (!component) fail(`${row.reference}: missing bundle component target ${categorySlug}`);
        return {
          componentMasterId: component._id, componentVariantId: null, quantity: 1,
          unitCode: component.defaultSellingUnit, selectionGroup: categorySlug.replace(/-/g, '_').slice(0, 40),
          required: true, defaultSelected: true, minSelections: 1, maxSelections: 1,
          priceAdjustment: 0, sortOrder: index, status: 'active',
        };
      });
      // Each bundle replacement is an audited optimistic transaction.
      // eslint-disable-next-line no-await-in-loop
      await catalogStructureService.replaceBundleComponents({
        masterId: bundle._id, components, expectedVersion: bundle.version, actorId: options.actorId,
      });
      result.bundleComponents += components.length;
    } catch (error) {
      result.failures.push({ reference: row.reference, error: error.message });
      if (!options.continueOnError) throw error;
    }
  }
}

async function applyPlan(plan, rows) {
  const result = { created: 0, repaired: 0, unchanged: 0, variants: 0, bundleComponents: 0, failures: [] };
  for (const item of plan) {
    try {
      if (item.action === 'unchanged') { result.unchanged += 1; continue; }
      // Domain service writes intentionally remain ordered for deterministic audit/event streams.
      // eslint-disable-next-line no-await-in-loop
      const outcome = item.action === 'create' ? await createOne(item) : await repairOne(item);
      result[item.action === 'create' ? 'created' : 'repaired'] += 1;
      result.variants += outcome.variants;
    } catch (error) {
      result.failures.push({ reference: item.row.reference, error: error.message });
      if (!options.continueOnError) throw error;
    }
  }
  await ensureBundleComponents(rows, result);
  return result;
}

async function main() {
  const metrics = validateBlueprint(buildSandboxProductBlueprints());
  printCoverage(metrics);
  if (options.validateOnly) {
    console.log('\n✓ Sandbox product registry is internally valid and matches the master mutation contract.');
    return;
  }
  await connectDb();
  const dependencies = await loadDependencies(metrics.rows);
  const plan = await buildPlan(metrics.rows, dependencies);
  printPlan(plan);
  if (!options.apply) {
    console.log('\nDRY RUN — no documents were changed.');
    console.log(`Apply requires --apply --acknowledge-noncompliant-sandbox${options.active ? ' --active' : ''}.`);
    return;
  }
  if (!options.acknowledged) fail('Refusing apply: pass --acknowledge-noncompliant-sandbox to confirm these products use a category taxonomy with no compliance gates');
  const result = await applyPlan(plan, metrics.rows);
  console.log(`\n✓ Sandbox products applied: ${result.created} created · ${result.repaired} repaired · ${result.unchanged} unchanged.`);
  console.log(`  ${result.variants} variants created/repaired · ${result.bundleComponents} bundle components · status ${options.active ? 'active' : 'pending_review'}`);
  console.log('  0 compliance records · master media 0 · variant media 0 · existing brands unchanged');
  if (result.failures.length) {
    for (const failure of result.failures) console.error(`  ${failure.reference}: ${failure.error}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`\n✗ Sandbox product seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await disconnectDb();
  });
