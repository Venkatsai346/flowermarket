#!/usr/bin/env node
/**
 * Seed a category-complete, globally deduplicated brand registry.
 *
 * Safe defaults:
 *   - no --apply => database-backed dry run
 *   - new media fields are null; existing media is never touched
 *   - seeded brands remain unverified pending governance review
 *   - unknown/custom brands are never deleted
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import Brand from '../src/models/brand.model.js';
import Category from '../src/models/category.model.js';
import User from '../src/models/user.model.js';
import brandService from '../src/services/brand.service.js';
import { brandCreateSchema } from '../src/utils/validators/catalog.validators.js';
import { CATEGORY_PLAYBOOKS } from '../src/data/catalogCategoryPlaybooks.js';
import { CATEGORY_BRAND_ASSIGNMENTS } from '../src/data/catalogBrandBlueprints.js';

const DEFAULT_ACTOR_ID = '6a97b0e9a61173c01d040435';
const argv = process.argv.slice(2);
const args = new Set(argv);
const valueArg = (prefix) => argv.find((arg) => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
const options = {
  apply: args.has('--apply'),
  validateOnly: args.has('--validate-only'),
  continueOnError: args.has('--continue-on-error'),
  newStatus: args.has('--inactive') ? 'inactive' : 'active',
  actorId: valueArg('--actor') || DEFAULT_ACTOR_ID,
};

const fail = (message) => { throw new Error(message); };
const normalizeName = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const brandSlug = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ')
  .replace(/['’]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 140);

function buildBlueprint() {
  const supportedCategories = new Set(CATEGORY_PLAYBOOKS.map((playbook) => playbook.id));
  const assignmentCategories = Object.keys(CATEGORY_BRAND_ASSIGNMENTS);
  const errors = [];
  for (const category of assignmentCategories) {
    if (!supportedCategories.has(category)) errors.push(`Brand assignment references unknown category: ${category}`);
  }
  for (const category of supportedCategories) {
    if (!CATEGORY_BRAND_ASSIGNMENTS[category]?.length) errors.push(`Guidance category has no brand coverage: ${category}`);
  }

  const byName = new Map();
  for (const [categorySlug, names] of Object.entries(CATEGORY_BRAND_ASSIGNMENTS)) {
    const seenInCategory = new Set();
    for (const rawName of names) {
      const name = String(rawName).normalize('NFKC').trim().replace(/\s+/g, ' ');
      const key = normalizeName(name);
      if (!name) { errors.push(`${categorySlug}: blank brand name`); continue; }
      if (seenInCategory.has(key)) { errors.push(`${categorySlug}: duplicate brand ${name}`); continue; }
      seenInCategory.add(key);
      if (!byName.has(key)) byName.set(key, { name, slug: brandSlug(name), categorySlugs: [] });
      byName.get(key).categorySlugs.push(categorySlug);
    }
  }

  const rows = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const bySlug = new Map();
  for (const row of rows) {
    if (!row.slug) errors.push(`${row.name}: generated an empty slug`);
    const collision = bySlug.get(row.slug);
    if (collision && normalizeName(collision.name) !== normalizeName(row.name)) errors.push(`Slug collision: ${collision.name} and ${row.name} => ${row.slug}`);
    bySlug.set(row.slug, row);
    const result = brandCreateSchema.validate({
      name: row.name, slug: row.slug, logoUrl: null, bannerUrl: null,
      isFeatured: false, sortOrder: 0, status: options.newStatus,
    }, { abortEarly: false });
    if (result.error) errors.push(`${row.name}: ${result.error.details.map((detail) => detail.message).join('; ')}`);
  }
  if (errors.length) fail(`Brand blueprint validation failed:\n- ${errors.join('\n- ')}`);
  return rows.map((row, index) => ({ ...row, sortOrder: index * 10 }));
}

function printCoverage(rows) {
  const categoryCount = Object.keys(CATEGORY_BRAND_ASSIGNMENTS).length;
  const links = rows.reduce((sum, row) => sum + row.categorySlugs.length, 0);
  const multiCategory = rows.filter((row) => row.categorySlugs.length > 1).length;
  console.log('\nCatalog brand blueprint');
  console.log(`  ${rows.length} unique brands · ${categoryCount} governed leaf categories · ${links} category/brand relationships`);
  console.log(`  ${multiCategory} brands are reused across multiple categories instead of duplicated`);
}

async function assertActorAndCategories(rows) {
  if (!mongoose.isValidObjectId(options.actorId)) fail(`Invalid --actor ObjectId: ${options.actorId}`);
  const [actor, categories] = await Promise.all([
    User.findById(options.actorId).select('role status'),
    Category.find({ slug: { $in: Object.keys(CATEGORY_BRAND_ASSIGNMENTS) } }).select('slug status').lean(),
  ]);
  if (!actor) fail(`Super-admin actor ${options.actorId} does not exist`);
  if (actor.role !== 'super_admin' || actor.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin (found ${actor.role}/${actor.status})`);
  const found = new Set(categories.map((category) => category.slug));
  const missing = Object.keys(CATEGORY_BRAND_ASSIGNMENTS).filter((slug) => !found.has(slug));
  if (missing.length) fail(`Missing ${missing.length} required leaf categories: ${missing.join(', ')}. Run the catalog taxonomy seed first.`);
  const inactive = categories.filter((category) => category.status !== 'active').map((category) => category.slug);
  if (inactive.length) console.log(`  Note: ${inactive.length} covered categories are not active: ${inactive.join(', ')}`);
  return rows;
}

async function loadExisting(rows) {
  const slugs = rows.map((row) => row.slug);
  const names = rows.map((row) => row.name);
  const docs = await Brand.find({ $or: [{ slug: { $in: slugs } }, { name: { $in: names } }] }).select('+updatedBy');
  const bySlug = new Map();
  const byName = new Map();
  for (const doc of docs) {
    bySlug.set(doc.slug, doc);
    byName.set(normalizeName(doc.name), doc);
  }
  return { bySlug, byName };
}

function makePlan(rows, existing) {
  return rows.map((row) => {
    const slugMatch = existing.bySlug.get(row.slug);
    const nameMatch = existing.byName.get(normalizeName(row.name));
    if (slugMatch && nameMatch && String(slugMatch._id) !== String(nameMatch._id)) {
      fail(`Brand collision for ${row.name}: slug belongs to ${slugMatch.name}, while the name belongs to ${nameMatch.slug}. Merge manually.`);
    }
    const doc = slugMatch || nameMatch || null;
    if (!doc) return { action: 'create', row };
    const changed = doc.name !== row.name || doc.slug !== row.slug;
    return { action: changed ? 'update' : 'unchanged', row, existing: doc };
  });
}

function printPlan(actions) {
  const count = (action) => actions.filter((item) => item.action === action).length;
  console.log('\nDatabase plan');
  console.log(`  create ${count('create')} · update ${count('update')} · unchanged ${count('unchanged')}`);
  for (const item of actions.filter((entry) => entry.action !== 'unchanged')) {
    console.log(`  ${item.action.toUpperCase().padEnd(6)} ${item.row.name} (${item.row.slug}) · ${item.row.categorySlugs.join(', ')}`);
  }
}

async function applyPlan(actions) {
  const result = { created: 0, updated: 0, unchanged: 0, failures: [] };
  for (const item of actions) {
    try {
      if (item.action === 'unchanged') {
        result.unchanged += 1;
        continue;
      }
      let brand;
      if (item.action === 'create') {
        const payload = {
          name: item.row.name,
          slug: item.row.slug,
          logoUrl: null,
          bannerUrl: null,
          tagline: null,
          description: null,
          story: null,
          countryOfOrigin: null,
          website: null,
          foundedYear: null,
          headquarters: null,
          socialLinks: {},
          isFeatured: false,
          sortOrder: item.row.sortOrder,
          status: options.newStatus,
          verification: { status: 'pending', isVerified: false, verifiedAt: null },
          updatedBy: options.actorId,
        };
        // Ordered audit/outbox publication makes these writes intentionally sequential.
        // eslint-disable-next-line no-await-in-loop
        brand = await brandService.create({ payload, actorId: options.actorId });
        result.created += 1;
      } else {
        // Identity canonicalization preserves media, copy, curation and verification.
        const patch = { name: item.row.name, slug: item.row.slug, updatedBy: options.actorId, updatedAt: new Date() };
        // Ordered audit/outbox publication makes these writes intentionally sequential.
        // eslint-disable-next-line no-await-in-loop
        brand = await brandService.update({ id: item.existing._id, patch, actorId: options.actorId });
        result.updated += 1;
      }
      if (!brand?._id) fail(`${item.row.name}: service returned no brand document`);
    } catch (error) {
      result.failures.push({ name: item.row.name, error: error.message });
      if (!options.continueOnError) throw error;
    }
  }
  return result;
}

async function main() {
  const rows = buildBlueprint();
  printCoverage(rows);
  if (options.validateOnly) {
    console.log('\n✓ Brand blueprint is internally valid and matches the brand mutation contract.');
    return;
  }

  await connectDb();
  await assertActorAndCategories(rows);
  const existing = await loadExisting(rows);
  const actions = makePlan(rows, existing);
  printPlan(actions);

  if (!options.apply) {
    console.log('\nDRY RUN — no brand documents were changed. Add --apply to execute.');
    return;
  }

  const result = await applyPlan(actions);
  console.log(`\n✓ Brand registry applied: ${result.created} created · ${result.updated} updated · ${result.unchanged} unchanged.`);
  console.log('New media fields are null. Existing media, editorial copy, status, featured curation and verification were preserved.');
  console.log('New brands remain unverified until platform governance verifies identity and evidence.');
  if (result.failures.length) {
    console.error(`\n${result.failures.length} brand(s) failed and can be retried safely:`);
    for (const failure of result.failures) console.error(`  ${failure.name}: ${failure.error}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`\n✗ Catalog brand seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await disconnectDb();
  });
