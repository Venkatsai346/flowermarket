#!/usr/bin/env node
/**
 * Seed the global, India-oriented catalog taxonomy from the guidance-book
 * playbooks. The operation is deterministic, idempotent, resumable and safe by
 * default: without --apply it only prints a database-backed execution plan.
 *
 * Examples:
 *   npm run catalog:taxonomy:validate
 *   npm run catalog:taxonomy:plan
 *   npm run catalog:taxonomy:seed -- --accept-product-impact
 *
 * Media is intentionally null on INSERT and is NEVER overwritten on UPDATE.
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import Category from '../src/models/category.model.js';
import ProductMaster from '../src/models/productMaster.model.js';
import User from '../src/models/user.model.js';
import categoryService from '../src/services/category.service.js';
import { categoryCreateSchema } from '../src/utils/validators/catalog.validators.js';
import { CATEGORY_PLAYBOOKS } from '../src/data/catalogCategoryPlaybooks.js';

const DEFAULT_ACTOR_ID = '6a97b0e9a61173c01d040435';

const ROOTS = [
  ['Flowers & plants', 'flowers-plants', 'Fresh flowers, arrangements, live plants and propagation material.'],
  ['Electronics', 'electronics', 'Connected devices, computing, entertainment and imaging electronics.'],
  ['Home & appliances', 'home-appliances', 'Home appliances, furniture and durable household products.'],
  ['Fashion', 'fashion', 'Apparel, footwear, jewellery and wearable style products.'],
  ['Health & beauty', 'health-beauty', 'Beauty, wellness, nutrition and regulated health products.'],
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

const LEGACY_LEAF_SLUGS = {
  'live-plants': ['plants'],
};

const args = new Set(process.argv.slice(2));
const valueArg = (prefix) => process.argv.slice(2).find((arg) => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
const options = {
  apply: args.has('--apply'),
  validateOnly: args.has('--validate-only'),
  acceptProductImpact: args.has('--accept-product-impact'),
  continueOnError: args.has('--continue-on-error'),
  actorId: valueArg('--actor') || DEFAULT_ACTOR_ID,
};

const fail = (message) => { throw new Error(message); };
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const canonicalAttributes = (rows) => rows.map((field, index) => ({
  key: field.key,
  label: field.label || null,
  type: field.type || 'string',
  required: Boolean(field.required),
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
}));
const canonicalCompliance = (rows) => rows.map((requirement) => ({
  code: requirement.code.toUpperCase(),
  type: requirement.type,
  label: requirement.label,
  required: requirement.required !== false,
  requiresExpiry: Boolean(requirement.requiresExpiry),
  jurisdictions: [...(requirement.jurisdictions?.length ? requirement.jurisdictions : ['IN'])],
}));
const comparable = (doc) => ({
  name: doc.name,
  slug: doc.slug,
  parentId: doc.parentId ? String(doc.parentId) : null,
  description: doc.description || null,
  attributeSchema: canonicalAttributes(doc.attributeSchema || []),
  complianceRequirements: canonicalCompliance(doc.complianceRequirements || []),
  sortOrder: Number(doc.sortOrder || 0),
  isFeatured: Boolean(doc.isFeatured),
  status: doc.status || 'active',
});

function buildBlueprint() {
  const playbookById = new Map(CATEGORY_PLAYBOOKS.map((item) => [item.id, item]));
  const roots = ROOTS.map(([name, slug, description], sortOrder) => ({
    kind: 'root', name, slug, description, parentSlug: null, sortOrder: sortOrder * 100, attributeSchema: [], complianceRequirements: [],
  }));
  const sections = SECTIONS.map(([rootName, name, slug, leafIds], sortOrder) => {
    const root = roots.find((item) => item.name === rootName);
    if (!root) fail(`Section ${name} refers to missing root ${rootName}`);
    for (const id of leafIds) if (!playbookById.has(id)) fail(`Section ${name} refers to missing playbook ${id}`);
    return { kind: 'section', name, slug, description: `${name} taxonomy and governed product specifications.`, parentSlug: root.slug, leafIds, sortOrder: sortOrder * 10, attributeSchema: [], complianceRequirements: [] };
  });
  const assigned = new Map();
  for (const section of sections) {
    for (const leafId of section.leafIds) {
      if (assigned.has(leafId)) fail(`Playbook ${leafId} is assigned to both ${assigned.get(leafId)} and ${section.slug}`);
      assigned.set(leafId, section.slug);
    }
  }
  const leaves = CATEGORY_PLAYBOOKS.map((playbook, sortOrder) => {
    const parentSlug = assigned.get(playbook.id);
    if (!parentSlug) fail(`Playbook ${playbook.id} has no taxonomy section`);
    return {
      kind: 'leaf', name: playbook.name, slug: playbook.id, parentSlug,
      description: playbook.summary, sortOrder: sortOrder * 10,
      attributeSchema: canonicalAttributes(playbook.attributes),
      complianceRequirements: canonicalCompliance(playbook.compliance),
    };
  });
  return [...roots, ...sections, ...leaves];
}

function validateBlueprint(rows) {
  const errors = [];
  const bySlug = new Map();
  for (const row of rows) {
    if (bySlug.has(row.slug)) errors.push(`Duplicate slug: ${row.slug}`);
    bySlug.set(row.slug, row);
    if (row.parentSlug && !rows.some((candidate) => candidate.slug === row.parentSlug)) errors.push(`${row.slug}: missing parent ${row.parentSlug}`);
    const keys = new Set();
    for (const field of row.attributeSchema) {
      if (keys.has(field.key)) errors.push(`${row.slug}: duplicate attribute ${field.key}`);
      keys.add(field.key);
      if (field.required && field.appliesTo === 'variant' && row.kind !== 'leaf') errors.push(`${row.slug}: variant requirement is only valid on leaves`);
      if (field.min != null && field.max != null && field.min > field.max) errors.push(`${row.slug}.${field.key}: min exceeds max`);
    }
    const codes = new Set();
    for (const requirement of row.complianceRequirements) {
      if (codes.has(requirement.code)) errors.push(`${row.slug}: duplicate compliance code ${requirement.code}`);
      codes.add(requirement.code);
    }
    const validationPayload = {
      name: row.name, slug: row.slug, description: row.description,
      attributeSchema: row.attributeSchema.map((field) => Object.fromEntries(Object.entries(field).filter(([, value]) => value !== null))),
      complianceRequirements: row.complianceRequirements,
      sortOrder: row.sortOrder, isFeatured: false, status: 'active',
    };
    const result = categoryCreateSchema.validate(validationPayload, { abortEarly: false });
    if (result.error) errors.push(`${row.slug}: ${result.error.details.map((detail) => detail.message).join('; ')}`);
  }
  if (errors.length) fail(`Taxonomy blueprint validation failed:\n- ${errors.join('\n- ')}`);
  return {
    total: rows.length,
    roots: rows.filter((row) => row.kind === 'root').length,
    sections: rows.filter((row) => row.kind === 'section').length,
    leaves: rows.filter((row) => row.kind === 'leaf').length,
    attributes: rows.reduce((sum, row) => sum + row.attributeSchema.length, 0),
    requiredAttributes: rows.reduce((sum, row) => sum + row.attributeSchema.filter((field) => field.required).length, 0),
    compliance: rows.reduce((sum, row) => sum + row.complianceRequirements.length, 0),
    requiredCompliance: rows.reduce((sum, row) => sum + row.complianceRequirements.filter((item) => item.required).length, 0),
  };
}

async function loadExisting(rows) {
  const allSlugs = new Set(rows.map((row) => row.slug));
  for (const aliases of Object.values(LEGACY_LEAF_SLUGS)) for (const alias of aliases) allSlugs.add(alias);
  const docs = await Category.find({ slug: { $in: [...allSlugs] } }).select('+updatedBy');
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  for (const [canonicalSlug, aliases] of Object.entries(LEGACY_LEAF_SLUGS)) {
    const canonical = bySlug.get(canonicalSlug);
    const legacy = aliases.map((alias) => bySlug.get(alias)).filter(Boolean);
    if (canonical && legacy.length) fail(`Both canonical category ${canonicalSlug} and legacy alias ${legacy.map((doc) => doc.slug).join(', ')} exist; merge them manually before seeding`);
    if (!canonical && legacy.length > 1) fail(`Several legacy categories map to ${canonicalSlug}; merge them manually before seeding`);
    if (!canonical && legacy[0]) bySlug.set(canonicalSlug, legacy[0]);
  }
  return bySlug;
}

async function plan(rows, existingBySlug) {
  const referencedIds = rows.filter((row) => row.kind === 'leaf' && existingBySlug.get(row.slug)).map((row) => existingBySlug.get(row.slug)._id);
  const productCounts = referencedIds.length ? await ProductMaster.aggregate([
    { $match: { categoryId: { $in: referencedIds }, status: { $in: ['active', 'pending_review'] }, isDeleted: { $ne: true } } },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]) : [];
  const productsByCategory = new Map(productCounts.map((item) => [String(item._id), item.count]));
  const virtualIds = new Map();
  for (const row of rows) {
    const existing = existingBySlug.get(row.slug);
    virtualIds.set(row.slug, existing?._id || new mongoose.Types.ObjectId());
  }
  const actions = [];
  for (const row of rows) {
    const parentId = row.parentSlug ? virtualIds.get(row.parentSlug) : null;
    const existing = existingBySlug.get(row.slug);
    const desired = {
      name: row.name, slug: row.slug, parentId: parentId ? String(parentId) : null,
      description: row.description, attributeSchema: row.attributeSchema,
      complianceRequirements: row.complianceRequirements,
      sortOrder: row.sortOrder,
      isFeatured: existing ? Boolean(existing.isFeatured) : false,
      status: existing?.status || 'active',
    };
    if (!existing) {
      actions.push({ action: 'create', row, desired, parentId, products: 0 });
      continue;
    }
    const changed = !same(comparable(existing), desired);
    const products = changed && row.kind === 'leaf' ? productsByCategory.get(String(existing._id)) || 0 : 0;
    actions.push({ action: changed ? 'update' : 'unchanged', row, desired, parentId, existing, products });
  }
  return actions;
}

function printSummary(stats, actions = []) {
  console.log('\nCatalog taxonomy blueprint');
  console.log(`  ${stats.roots} roots · ${stats.sections} sections · ${stats.leaves} leaf categories`);
  console.log(`  ${stats.attributes} attribute fields (${stats.requiredAttributes} required)`);
  console.log(`  ${stats.compliance} compliance requirements (${stats.requiredCompliance} required)`);
  if (!actions.length) return;
  const count = (name) => actions.filter((item) => item.action === name).length;
  console.log('\nDatabase plan');
  console.log(`  create ${count('create')} · update ${count('update')} · unchanged ${count('unchanged')}`);
  for (const action of actions.filter((item) => item.action !== 'unchanged')) {
    console.log(`  ${action.action.toUpperCase().padEnd(6)} ${action.row.parentSlug ? `${action.row.parentSlug} / ` : ''}${action.row.name}${action.products ? `  ⚠ ${action.products} referenced active/pending product(s)` : ''}`);
  }
}

async function apply(actions) {
  const resolvedIds = new Map();
  const failures = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const item of actions) {
    try {
      const parentId = item.row.parentSlug ? resolvedIds.get(item.row.parentSlug) : null;
      if (item.row.parentSlug && !parentId) fail(`Parent ${item.row.parentSlug} was not resolved`);
      if (item.action === 'unchanged') {
        resolvedIds.set(item.row.slug, item.existing._id);
        unchanged += 1;
        continue;
      }
      const payload = {
        name: item.row.name, slug: item.row.slug, parentId: parentId || null,
        description: item.row.description, attributeSchema: item.row.attributeSchema,
        complianceRequirements: item.row.complianceRequirements,
        sortOrder: item.row.sortOrder, isFeatured: item.desired.isFeatured, status: item.desired.status, updatedBy: options.actorId,
      };
      let doc;
      if (item.action === 'create') {
        // Parent IDs and ordered audit/outbox events require sequential taxonomy writes.
        // eslint-disable-next-line no-await-in-loop
        doc = await categoryService.create({ payload: { ...payload, imageUrl: null, iconUrl: null, bannerUrl: null }, actorId: options.actorId });
        created += 1;
      } else {
        // Parent IDs and ordered audit/outbox events require sequential taxonomy writes.
        // eslint-disable-next-line no-await-in-loop
        doc = await categoryService.update({ id: item.existing._id, patch: payload, actorId: options.actorId });
        updated += 1;
      }
      resolvedIds.set(item.row.slug, doc._id);
    } catch (error) {
      failures.push({ slug: item.row.slug, error: error.message });
      if (!options.continueOnError) throw error;
    }
  }
  return { created, updated, unchanged, failures };
}

async function main() {
  const rows = buildBlueprint();
  const stats = validateBlueprint(rows);
  if (options.validateOnly) {
    printSummary(stats);
    console.log('\n✓ Blueprint is internally valid and matches the category mutation contract.');
    return;
  }

  if (!mongoose.isValidObjectId(options.actorId)) fail(`Invalid --actor ObjectId: ${options.actorId}`);
  await connectDb();
  const actor = await User.findById(options.actorId).select('role status');
  if (!actor) fail(`Super-admin actor ${options.actorId} does not exist`);
  if (actor.role !== 'super_admin' || actor.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin (found ${actor.role}/${actor.status})`);

  const existing = await loadExisting(rows);
  const actions = await plan(rows, existing);
  printSummary(stats, actions);
  const impacted = actions.filter((item) => item.action === 'update' && item.products > 0);

  if (!options.apply) {
    console.log('\nDRY RUN — no documents were changed. Add --apply to execute.');
    if (impacted.length) console.log('Because referenced products are affected, execution will also require --accept-product-impact.');
    return;
  }
  if (impacted.length && !options.acceptProductImpact) {
    fail(`${impacted.reduce((sum, item) => sum + item.products, 0)} active/pending products reference categories whose governed schema will change. Review the plan, backfill product data as needed, then rerun with --accept-product-impact.`);
  }

  const result = await apply(actions);
  console.log(`\n✓ Taxonomy applied: ${result.created} created · ${result.updated} updated · ${result.unchanged} unchanged.`);
  if (result.failures.length) {
    console.error(`\n${result.failures.length} row(s) failed and can be retried safely:`);
    for (const failure of result.failures) console.error(`  ${failure.slug}: ${failure.error}`);
    process.exitCode = 1;
  }
  if (impacted.length) {
    console.log('\nFollow-up required: review/backfill products attached to upgraded leaf schemas before approving their compliance readiness.');
  }
  console.log('Media fields were left null on new rows and preserved unchanged on existing rows.');
}

main()
  .catch((error) => {
    console.error(`\n✗ Catalog taxonomy seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await disconnectDb();
  });
