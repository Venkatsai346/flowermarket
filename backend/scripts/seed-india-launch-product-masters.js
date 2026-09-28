#!/usr/bin/env node
/** Separate India-launch master seed. Requires launch taxonomy + brands; never creates listings. */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import User from '../src/models/user.model.js'; import Category from '../src/models/category.model.js'; import Brand from '../src/models/brand.model.js';
import ProductMaster from '../src/models/productMaster.model.js'; import ProductVariant from '../src/models/productVariant.model.js'; import ProductVariantAttributeValue from '../src/models/productVariantAttributeValue.model.js';
import productMasterService from '../src/services/productMaster.service.js';
import { masterCreateSchema } from '../src/utils/validators/catalog.validators.js';
import { buildIndiaLaunchProducts, INDIA_LAUNCH_CATEGORIES, INDIA_LAUNCH_BRANDS } from '../src/data/indiaLaunchCatalogBlueprints.js';

const argv = process.argv.slice(2); const args = new Set(argv); const valueArg = (name) => argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
const options = { apply: args.has('--apply'), validateOnly: args.has('--validate-only'), continueOnError: args.has('--continue-on-error'), status: args.has('--active') ? 'active' : 'pending_review', actorId: valueArg('--actor') || '6a97b0e9a61173c01d040435' };
const fail = (message) => { throw new Error(message); }; const rows = buildIndiaLaunchProducts();
async function validate() {
  const errors = []; const eavCandidates = []; const masterSkus = new Set(); const slugs = new Set(); const variantSkus = new Set(); const categories = new Map(INDIA_LAUNCH_CATEGORIES.map((row) => [row.slug, row])); const brands = new Set(INDIA_LAUNCH_BRANDS.map((row) => row.slug));
  if (rows.length !== 1000) errors.push(`expected 1000 masters, found ${rows.length}`);
  for (const row of rows) {
    if (masterSkus.has(row.skuGlobal)) errors.push(`duplicate SKU ${row.skuGlobal}`); if (slugs.has(row.slug)) errors.push(`duplicate slug ${row.slug}`); masterSkus.add(row.skuGlobal); slugs.add(row.slug);
    const category = categories.get(row.categorySlug); if (!category || category.level !== 'leaf') errors.push(`${row.skuGlobal}: invalid leaf category`); if (!brands.has(row.brandSlug)) errors.push(`${row.skuGlobal}: unknown brand`);
    if (!row.variants.length || row.variants.filter((variant) => variant.isDefault).length !== 1) errors.push(`${row.skuGlobal}: variants/default invalid`); if (!row.images.length) errors.push(`${row.skuGlobal}: master media missing`);
    const { categorySlug: ignoredCategory, brandSlug: ignoredBrand, variants, ...payload } = row; const candidate = { ...payload, categoryId: '000000000000000000000001', brandId: '000000000000000000000001', variants: variants.map(({ attributes: ignored, ...variant }) => variant) }; const contract = masterCreateSchema.validate(candidate, { abortEarly: false }); if (contract.error) errors.push(`${row.skuGlobal}: mutation contract: ${contract.error.message}`);
    try { productMasterService.normalizeStructure(candidate); } catch (error) { errors.push(`${row.skuGlobal}: structural invariant: ${error.message}`); }
    const masterKeys = new Set(row.attributes.map((item) => item.key)); for (const field of category?.attributeSchema.filter((item) => item.appliesTo === 'master') || []) if (!masterKeys.has(field.key)) errors.push(`${row.skuGlobal}: missing ${field.key}`);
    for (const variant of row.variants) { if (variantSkus.has(variant.sku)) errors.push(`duplicate variant SKU ${variant.sku}`); variantSkus.add(variant.sku); if (!variant.images.length) errors.push(`${variant.sku}: media missing`); const keys = new Set(variant.attributes.map((item) => item.key)); for (const field of category?.attributeSchema.filter((item) => item.appliesTo === 'variant') || []) if (!keys.has(field.key)) errors.push(`${variant.sku}: missing ${field.key}`); variant.attributes.forEach((attribute, sortOrder) => eavCandidates.push(new ProductVariantAttributeValue({ productMasterId: '000000000000000000000001', productVariantId: '000000000000000000000002', attributeKey: attribute.key, value: attribute.value, unit: attribute.unit || null, sortOrder }))); }
  }
  const settled = await Promise.allSettled(eavCandidates.map((candidate) => candidate.validate())); settled.forEach((result) => { if (result.status === 'rejected') errors.push(`variant EAV contract: ${result.reason.message}`); });
  if (errors.length) fail(`Blueprint invalid (${errors.length}):\n- ${errors.slice(0, 100).join('\n- ')}`); console.log(`India launch products: ${rows.length} masters · ${rows.reduce((n, row) => n + row.variants.length, 0)} variants · media on every master and variant`);
}
async function actor() { const user = mongoose.isValidObjectId(options.actorId) && await User.findById(options.actorId).select('role status').lean(); if (!user || user.role !== 'super_admin' || user.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin`); }
async function ensureVariants(masterId, blueprints) {
  let master = await ProductMaster.findById(masterId); const existing = await ProductVariant.find({ productMasterId: masterId }).select('sku').lean(); const present = new Set(existing.map((variant) => variant.sku));
  for (const blueprint of blueprints) { if (present.has(blueprint.sku)) continue; const { attributes: ignored, ...payload } = blueprint;
    // Ordered optimistic writes repair an interrupted creation and advance version.
    // eslint-disable-next-line no-await-in-loop
    await productMasterService.addVariant({ id: masterId, payload, expectedVersion: master.version, actorId: options.actorId });
    // The next write requires the version produced by the preceding variant.
    // eslint-disable-next-line no-await-in-loop
    master = await ProductMaster.findById(masterId); }
}
async function ensureVariantAttributes(masterId, blueprints) {
  const variants = await ProductVariant.find({ productMasterId: masterId }).select('_id sku').lean(); const bySku = new Map(variants.map((variant) => [variant.sku, variant])); const existing = await ProductVariantAttributeValue.find({ productVariantId: { $in: variants.map((variant) => variant._id) }, isDeleted: false }).select('productVariantId attributeKey').lean(); const present = new Set(existing.map((attribute) => `${attribute.productVariantId}:${attribute.attributeKey}`)); const documents = [];
  for (const blueprint of blueprints) { const variant = bySku.get(blueprint.sku); if (!variant) fail(`${blueprint.sku}: service-created variant missing`); blueprint.attributes.forEach((attribute, sortOrder) => { if (!present.has(`${variant._id}:${attribute.key}`)) documents.push({ productMasterId: masterId, productVariantId: variant._id, attributeKey: attribute.key, value: attribute.value, unit: attribute.unit || null, sortOrder, createdBy: options.actorId, updatedBy: options.actorId }); }); }
  if (documents.length) { const candidates = documents.map((document) => new ProductVariantAttributeValue(document)); await Promise.all(candidates.map((candidate) => candidate.validate())); await ProductVariantAttributeValue.insertMany(documents, { ordered: true }); } return variants.length;
}
async function main() {
  await validate(); if (options.validateOnly) return console.log('✓ Product blueprint valid (database not opened).'); await connectDb(); await actor();
  const [categoryDocs, brandDocs] = await Promise.all([Category.find({ slug: { $in: [...new Set(rows.map((row) => row.categorySlug))] }, isDeleted: false }).lean(), Brand.find({ slug: { $in: [...new Set(rows.map((row) => row.brandSlug))] }, isDeleted: false }).lean()]); const categories = new Map(categoryDocs.map((doc) => [doc.slug, doc])); const brands = new Map(brandDocs.map((doc) => [doc.slug, doc]));
  const missingCategories = [...new Set(rows.map((row) => row.categorySlug))].filter((slug) => !categories.has(slug)); const missingBrands = [...new Set(rows.map((row) => row.brandSlug))].filter((slug) => !brands.has(slug)); if (missingCategories.length || missingBrands.length) fail(`Dependencies missing: ${missingCategories.length} categories, ${missingBrands.length} brands. Apply taxonomy and brand seeds first.`);
  const existing = await ProductMaster.find({ skuGlobal: { $in: rows.map((row) => row.skuGlobal) } }).select('_id skuGlobal').lean(); const bySku = new Map(existing.map((doc) => [doc.skuGlobal, doc])); const summary = { create: rows.length - existing.length, repair: existing.length, variants: 0, failures: [] };
  console.log(`${options.apply ? 'APPLY' : 'DRY RUN'}: ${summary.create} create · ${summary.repair} verify/repair`); if (!options.apply) return console.log('No documents changed. Add --apply to execute. New masters default to pending_review; add --active only after governance review.');
  for (const row of rows) {
    try { let master = bySku.get(row.skuGlobal); if (!master) { const { categorySlug, brandSlug, attributes, variants, ...payload } = row;
        // Master writes remain ordered for deterministic audit and outbox events.
        // eslint-disable-next-line no-await-in-loop
        master = await productMasterService.createMaster({ payload: { ...payload, categoryId: categories.get(categorySlug)._id, brandId: brands.get(brandSlug)._id, attributes, variants: variants.map(({ attributes: ignored, ...variant }) => variant) }, actorId: options.actorId, status: options.status }); }
      // Missing variants must be repaired before their EAV rows can be resolved.
      // eslint-disable-next-line no-await-in-loop
      await ensureVariants(master._id, row.variants);
      // EAV repair is sequential because it depends on variant IDs from the previous operation.
      // eslint-disable-next-line no-await-in-loop
      summary.variants += await ensureVariantAttributes(master._id, row.variants);
    } catch (error) { const failure = { sku: row.skuGlobal, category: row.categorySlug, brand: row.brandSlug, code: error.code || 'SEED_WRITE_FAILED', error: error.message }; summary.failures.push(failure); if (!options.continueOnError) throw new Error(`${failure.sku} (${failure.brand} / ${failure.category}) [${failure.code}]: ${failure.error}`, { cause: error }); }
  }
  console.log(`✓ Applied ${rows.length - summary.failures.length}/${rows.length} masters; verified ${summary.variants} variants.`); if (summary.failures.length) { console.error(summary.failures); process.exitCode = 1; }
}
main().catch((error) => { console.error(`✗ India product seed failed: ${error.message}`); process.exitCode = 1; }).finally(async () => { if (mongoose.connection.readyState) await disconnectDb(); });
