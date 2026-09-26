#!/usr/bin/env node
/**
 * Materialize deterministic, fully stocked tenant listings from the active
 * sandbox catalog. This script never creates masters, variants, categories,
 * brands or tenants. Existing merchant listings are preserved and accepted
 * only when already complete and sellable.
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import User from '../src/models/user.model.js';
import Tenant from '../src/models/tenant.model.js';
import Category from '../src/models/category.model.js';
import ProductMaster from '../src/models/productMaster.model.js';
import ProductVariant from '../src/models/productVariant.model.js';
import TenantProduct from '../src/models/tenantProduct.model.js';
import Inventory from '../src/models/inventory.model.js';
import SearchDocument from '../src/models/searchDocument.model.js';
import searchIndexerService from '../src/services/searchIndexer.service.js';
import {
  CATALOG_SANDBOX_LISTING_ACTOR_ID,
  CATALOG_SANDBOX_LISTING_MARKER,
  CATALOG_SANDBOX_LISTING_TENANTS,
  buildSandboxListingBlueprints,
  validateSandboxListingBlueprints,
} from '../src/data/catalogSandboxListingBlueprints.js';
import { PRODUCT_MASTER_STATUS, ENTITY_STATUS, TENANT_LISTING_STATUS, AVAILABILITY_STATUS } from '../src/constants/enums.js';

const argv = process.argv.slice(2);
const flags = new Set(argv);
const valueArg = (name) => argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const tenantSelectors = argv.filter((argument) => argument.startsWith('--tenant=')).map((argument) => argument.slice('--tenant='.length));
const options = {
  apply: flags.has('--apply'),
  validateOnly: flags.has('--validate-only'),
  acknowledged: flags.has('--acknowledge-sandbox-listings'),
  actorId: valueArg('--actor') || CATALOG_SANDBOX_LISTING_ACTOR_ID,
  tenantSelectors,
};

const fail = (message) => { throw new Error(message); };
const id = (value) => String(value?._id || value?.id || value || '');
const isFiniteNonNegative = (value) => Number.isFinite(value) && value >= 0;
const chunked = (items, size = 200) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

function selectedBlueprints() {
  const blueprints = validateSandboxListingBlueprints(buildSandboxListingBlueprints());
  if (!options.tenantSelectors.length) return blueprints;
  const wanted = new Set(options.tenantSelectors.map((value) => value.toUpperCase()));
  const selected = blueprints.filter((tenant) => wanted.has(tenant.id.toUpperCase()) || wanted.has(tenant.code));
  const matched = new Set(selected.flatMap((tenant) => [tenant.id.toUpperCase(), tenant.code]));
  const unknown = [...wanted].filter((selector) => !matched.has(selector));
  if (unknown.length) fail(`Unknown --tenant selector(s): ${unknown.join(', ')}. Use a configured tenant ObjectId or ${CATALOG_SANDBOX_LISTING_TENANTS.map((tenant) => tenant.code).join(', ')}.`);
  return selected;
}

function printCoverage(blueprints) {
  console.log('\nSandbox tenant listing registry');
  for (const tenant of blueprints) {
    console.log(`  ${tenant.code} ${tenant.id}: ${tenant.masterCount} masters · ${tenant.listingCount} variant listings · ${tenant.categoryCoverage.length} categories`);
  }
  console.log(`  Total: ${blueprints.reduce((sum, tenant) => sum + tenant.listingCount, 0)} tenant listing requirements`);
}

async function verifyDependencies(blueprints) {
  if (!mongoose.isValidObjectId(options.actorId)) fail(`Invalid --actor ObjectId: ${options.actorId}`);
  const [actor, tenants] = await Promise.all([
    User.findById(options.actorId).select('role status'),
    Tenant.find({ _id: { $in: blueprints.map((tenant) => tenant.id) } }).select('name slug status'),
  ]);
  if (!actor) fail(`Super-admin actor ${options.actorId} does not exist`);
  if (actor.role !== 'super_admin' || actor.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin`);

  const tenantById = new Map(tenants.map((tenant) => [id(tenant), tenant]));
  for (const expected of blueprints) {
    const tenant = tenantById.get(expected.id);
    if (!tenant) fail(`${expected.code}: tenant ${expected.id} does not exist`);
    if (tenant.status !== 'active') fail(`${expected.code}: tenant ${expected.id} must be active (found ${tenant.status})`);
  }
  return tenantById;
}

async function resolveCatalog(blueprints) {
  const allRequirements = blueprints.flatMap((tenant) => tenant.listings);
  const masterSkus = [...new Set(allRequirements.map((row) => row.masterSku))];
  const variantSkus = [...new Set(allRequirements.map((row) => row.variantSku))];
  const categorySlugs = [...new Set(allRequirements.map((row) => row.categorySlug))];
  const [masters, variants, categories] = await Promise.all([
    ProductMaster.find({ skuGlobal: { $in: masterSkus } }),
    ProductVariant.find({ sku: { $in: variantSkus } }),
    Category.find({ slug: { $in: categorySlugs } }).select('slug'),
  ]);
  const masterBySku = new Map(masters.map((master) => [master.skuGlobal, master]));
  const variantBySku = new Map(variants.map((variant) => [variant.sku, variant]));
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const issues = [];
  const seenIssues = new Set();
  const addIssue = (code, reference, message) => {
    const key = `${code}:${reference}`;
    if (!seenIssues.has(key)) issues.push({ code, reference, message });
    seenIssues.add(key);
  };

  for (const requirement of allRequirements) {
    const master = masterBySku.get(requirement.masterSku);
    const variant = variantBySku.get(requirement.variantSku);
    const category = categoryBySlug.get(requirement.categorySlug);
    if (!category) addIssue('CATEGORY_MISSING', requirement.categorySlug, `sandbox category ${requirement.categorySlug} is missing`);
    if (!master) {
      addIssue('MASTER_MISSING', requirement.masterSku, `sandbox master ${requirement.masterSku} is missing`);
      continue;
    }
    if (!master.tags?.includes('sandbox-data')) addIssue('MASTER_OWNERSHIP', requirement.masterSku, 'master is not owned by the sandbox dataset');
    if (master.status !== PRODUCT_MASTER_STATUS.ACTIVE) {
      addIssue('MASTER_NOT_ACTIVE', requirement.masterSku, `master must be active before listing (found ${master.status})`);
    }
    if (category && id(master.categoryId) !== id(category)) addIssue('MASTER_CATEGORY', requirement.masterSku, `master category does not match ${requirement.categorySlug}`);
    if (!variant) {
      addIssue('VARIANT_MISSING', requirement.variantSku, `required variant ${requirement.variantSku} is missing`);
      continue;
    }
    if (id(variant.productMasterId) !== id(master)) addIssue('VARIANT_OWNER', requirement.variantSku, 'variant belongs to a different master');
    if (variant.status !== ENTITY_STATUS.ACTIVE) addIssue('VARIANT_NOT_ACTIVE', requirement.variantSku, `variant must be active (found ${variant.status})`);
  }
  if (issues.length) {
    const counts = issues.reduce((result, issue) => {
      result[issue.code] = (result[issue.code] || 0) + 1;
      return result;
    }, {});
    console.error('\nCatalog prerequisite report');
    for (const [code, count] of Object.entries(counts)) console.error(`  ${code}: ${count}`);
    for (const issue of issues.slice(0, 30)) console.error(`  ${issue.code} ${issue.reference}: ${issue.message}`);
    if (issues.length > 30) console.error(`  … ${issues.length - 30} more catalog prerequisite issues`);
    const repairable = issues.some((issue) => ['MASTER_MISSING', 'VARIANT_MISSING'].includes(issue.code));
    const lifecycle = issues.some((issue) => issue.code === 'MASTER_NOT_ACTIVE');
    const guidance = [
      repairable ? 'repair missing sandbox structures with `npm run catalog:sandbox:products:plan` followed by `npm run catalog:sandbox:products:seed -- --acknowledge-noncompliant-sandbox --active`' : null,
      lifecycle ? 'approve any existing pending-review masters through the catalog lifecycle (the product seed never overwrites existing lifecycle state)' : null,
      'rerun the listing plan before apply',
    ].filter(Boolean).join('; then ');
    fail(`Catalog prerequisites are incomplete (${issues.length} unique issue${issues.length === 1 ? '' : 's'}); ${guidance}. No tenant listings were changed.`);
  }
  return { masterBySku, variantBySku };
}

function listingPayload(requirement, master, variant) {
  const quantity = variant.sellQuantity?.value || 1;
  const unitCode = variant.sellQuantity?.unitCode || master.unitPolicy?.baseUnit || master.defaultSellingUnit;
  return {
    tenantId: requirement.tenantId,
    productMasterId: master._id,
    variantId: variant._id,
    sellerSku: requirement.sellerSku,
    price: requirement.price,
    priceBasis: { quantity, unitCode },
    orderLimits: requirement.orderLimits,
    sellingPolicy: requirement.sellingPolicy,
    merchandising: requirement.merchandising,
    channels: requirement.channels,
    stockQty: requirement.stockQty,
    availability: { status: AVAILABILITY_STATUS.IN_STOCK, updatedAt: new Date() },
    status: TENANT_LISTING_STATUS.ACTIVE,
    version: 1,
    listedBy: options.actorId,
    lastPriceChangedAt: new Date(),
    lastStockChangedAt: new Date(),
    lastStatusChangedAt: new Date(),
    updatedBy: options.actorId,
    isDeleted: false,
  };
}

function listingIssue(listing) {
  if (listing.status !== TENANT_LISTING_STATUS.ACTIVE) return `listing status is ${listing.status}, expected active`;
  if (!listing.channels?.storefront) return 'storefront channel is disabled';
  if (!isFiniteNonNegative(listing.price?.sellingPrice) || listing.price.sellingPrice <= 0) return 'selling price is missing or invalid';
  if (!isFiniteNonNegative(listing.price?.mrp) || listing.price.mrp < listing.price.sellingPrice) return 'MRP is lower than selling price';
  if (!Number.isFinite(listing.stockQty) || listing.stockQty <= 0) return 'stock snapshot must be positive';
  if (!listing.priceBasis?.unitCode || !Number.isFinite(listing.priceBasis?.quantity) || listing.priceBasis.quantity <= 0) return 'price basis is incomplete';
  if (!listing.orderLimits?.minOrderQty || !listing.orderLimits?.maxOrderQty || listing.orderLimits.minOrderQty > listing.orderLimits.maxOrderQty) return 'order limits are incomplete';
  return null;
}

async function buildPlan(blueprints, catalog) {
  const plan = { create: [], createInventory: [], reindex: [], unchanged: [], conflicts: [] };
  for (const tenant of blueprints) {
    const masterIds = tenant.masterSkus.map((sku) => catalog.masterBySku.get(sku)._id);
    const expectedSellerSkus = tenant.listings.map((row) => row.sellerSku);
    const [existingListings, sellerSkuOwners] = await Promise.all([
      TenantProduct.find({ tenantId: tenant.id, productMasterId: { $in: masterIds } }),
      TenantProduct.find({ tenantId: tenant.id, sellerSku: { $in: expectedSellerSkus } }).select('productMasterId variantId sellerSku'),
    ]);
    const listingByTriple = new Map(existingListings.map((listing) => [`${id(listing.productMasterId)}:${id(listing.variantId)}`, listing]));
    const sellerOwnerBySku = new Map(sellerSkuOwners.map((listing) => [listing.sellerSku, listing]));
    const existingIds = existingListings.map((listing) => listing._id);
    const [inventories, searchDocuments] = existingIds.length ? await Promise.all([
      Inventory.find({ tenantId: tenant.id, tenantProductId: { $in: existingIds }, warehouseId: null }),
      SearchDocument.find({ tenantId: tenant.id, listingId: { $in: existingIds } }).select('listingId status inStock pricePaise stockQty sourceVersion'),
    ]) : [[], []];
    const inventoryByListing = new Map(inventories.map((inventory) => [id(inventory.tenantProductId), inventory]));
    const searchByListing = new Map(searchDocuments.map((document) => [id(document.listingId), document]));

    for (const requirement of tenant.listings) {
      const master = catalog.masterBySku.get(requirement.masterSku);
      const variant = catalog.variantBySku.get(requirement.variantSku);
      const key = `${id(master)}:${id(variant)}`;
      const listing = listingByTriple.get(key);
      const sellerSkuOwner = sellerOwnerBySku.get(requirement.sellerSku);
      if (!listing) {
        if (sellerSkuOwner) {
          plan.conflicts.push({ reference: requirement.reference, reason: `seller SKU belongs to listing ${id(sellerSkuOwner)}` });
          continue;
        }
        const payload = listingPayload(requirement, master, variant);
        const validationError = new TenantProduct(payload).validateSync();
        if (validationError) fail(`${requirement.reference}: generated listing is invalid: ${validationError.message}`);
        plan.create.push({ requirement, payload });
        continue;
      }
      const issue = listingIssue(listing);
      if (issue) {
        plan.conflicts.push({ reference: requirement.reference, reason: issue, listingId: id(listing) });
        continue;
      }
      const inventory = inventoryByListing.get(id(listing));
      if (!inventory) {
        plan.createInventory.push({ requirement, listing });
        continue;
      }
      if (inventory.qtyOnHand !== listing.stockQty || inventory.qtyReserved > inventory.qtyOnHand || inventory.status !== ENTITY_STATUS.ACTIVE) {
        plan.conflicts.push({ reference: requirement.reference, reason: `inventory ${id(inventory)} is not aligned with the listing stock snapshot`, listingId: id(listing) });
        continue;
      }
      const searchDocument = searchByListing.get(id(listing));
      const sourceVersion = (listing.version || 1) + (master.version || 1);
      if (
        !searchDocument
        || searchDocument.status !== 'active'
        || !searchDocument.inStock
        || searchDocument.pricePaise !== Math.round(listing.price.sellingPrice * 100)
        || searchDocument.stockQty !== listing.stockQty
        || searchDocument.sourceVersion !== sourceVersion
      ) {
        plan.reindex.push({ requirement, listing });
        continue;
      }
      plan.unchanged.push({ requirement, listing });
    }
  }
  return plan;
}

function printPlan(plan) {
  console.log('\nDatabase plan');
  console.log(`  ${plan.create.length} listings to create · ${plan.createInventory.length} inventories to recover · ${plan.reindex.length} search documents to refresh · ${plan.unchanged.length} settled · ${plan.conflicts.length} conflicts`);
  for (const conflict of plan.conflicts.slice(0, 20)) console.error(`  CONFLICT ${conflict.reference}: ${conflict.reason}`);
  if (plan.conflicts.length > 20) console.error(`  … ${plan.conflicts.length - 20} more conflicts`);
}

async function insertListings(rows) {
  for (const chunk of chunked(rows)) {
    // Ordered chunks make failures precisely resumable: prior chunks remain
    // settled and a rerun plans only the remainder.
    // eslint-disable-next-line no-await-in-loop
    await TenantProduct.insertMany(chunk.map((item) => item.payload), { ordered: true });
  }
}

async function ensureInventories(blueprints, catalog) {
  for (const tenant of blueprints) {
    const masterIds = tenant.masterSkus.map((sku) => catalog.masterBySku.get(sku)._id);
    // Tenant batches remain sequential to bound memory and database pressure during a large seed.
    // eslint-disable-next-line no-await-in-loop
    const listings = await TenantProduct.find({ tenantId: tenant.id, productMasterId: { $in: masterIds } });
    const expectedVariantIds = new Set(tenant.listings.map((row) => id(catalog.variantBySku.get(row.variantSku))));
    const targetListings = listings.filter((listing) => expectedVariantIds.has(id(listing.variantId)));
    const operations = targetListings.map((listing) => ({
      updateOne: {
        filter: { tenantId: tenant.id, tenantProductId: listing._id, warehouseId: null },
        update: { $setOnInsert: {
          tenantId: tenant.id,
          tenantProductId: listing._id,
          warehouseId: null,
          qtyOnHand: listing.stockQty,
          qtyReserved: 0,
          status: ENTITY_STATUS.ACTIVE,
          version: 1,
          lastUpdatedAt: new Date(),
          updatedBy: options.actorId,
          isDeleted: false,
        } },
        upsert: true,
      },
    }));
    for (const chunk of chunked(operations)) {
      // Ordered inventory chunks keep failures resumable and cap write pressure.
      // eslint-disable-next-line no-await-in-loop
      await Inventory.bulkWrite(chunk, { ordered: true });
    }
  }
}

async function rebuildSearch(blueprints) {
  let indexed = 0;
  for (const tenant of blueprints) {
    // Tenant rebuilds remain sequential so each bounded cursor pass completes before the next store starts.
    // eslint-disable-next-line no-await-in-loop
    const result = await searchIndexerService.reindexAll({ tenantId: tenant.id, batchSize: 200 });
    indexed += result.indexed;
  }
  return indexed;
}

async function main() {
  if (flags.has('\\')) {
    console.warn('Warning: `\\` is a Bash line-continuation character, not a PowerShell one. It was ignored; in PowerShell, run the command on one line or use a backtick (`).');
  }
  const blueprints = selectedBlueprints();
  printCoverage(blueprints);
  if (options.validateOnly) {
    console.log('\n✓ Sandbox tenant listing registry is internally valid, deterministic and category-complete.');
    return;
  }

  await connectDb();
  if (!mongoose.connection.name) fail('MongoDB connected without a resolved database name');
  console.log(`\nDatabase target: ${mongoose.connection.name}`);
  const tenants = await verifyDependencies(blueprints);
  for (const blueprint of blueprints) console.log(`  Resolved ${blueprint.code}: ${tenants.get(blueprint.id).name}`);
  const catalog = await resolveCatalog(blueprints);
  const plan = await buildPlan(blueprints, catalog);
  printPlan(plan);

  if (!options.apply) {
    console.log('\nDRY RUN — no documents were changed.');
    console.log('Apply requires --apply --acknowledge-sandbox-listings.');
    return;
  }
  if (!options.acknowledged) fail('Refusing apply: pass --acknowledge-sandbox-listings to confirm active test listings and inventory will be created');
  if (plan.conflicts.length) fail(`Refusing apply while ${plan.conflicts.length} target listing conflict(s) require merchant review`);

  await insertListings(plan.create);
  await ensureInventories(blueprints, catalog);
  const indexed = await rebuildSearch(blueprints);

  const verification = await buildPlan(blueprints, catalog);
  if (verification.create.length || verification.createInventory.length || verification.reindex.length || verification.conflicts.length) {
    fail(`Post-apply verification failed: ${verification.create.length} listings missing, ${verification.createInventory.length} inventories missing, ${verification.reindex.length} search documents stale, ${verification.conflicts.length} conflicts`);
  }
  console.log(`\n✓ Database verification passed: all ${verification.unchanged.length} active variant listings have valid pricing, ordering data, aligned inventory and current search documents.`);
  console.log(`  Created ${plan.create.length} listings · recovered ${plan.createInventory.length} inventory rows · indexed ${indexed} tenant search documents · preserved ${plan.unchanged.length} existing listings.`);
  console.log(`  Ownership marker: ${CATALOG_SANDBOX_LISTING_MARKER} · masters, variants, categories, brands and tenants unchanged.`);
}

main()
  .catch((error) => {
    console.error(`\n✗ Sandbox tenant listing seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await disconnectDb();
  });
