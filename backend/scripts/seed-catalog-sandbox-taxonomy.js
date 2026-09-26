#!/usr/bin/env node
/**
 * Create a PARALLEL, namespaced copy of the governed catalog taxonomy for
 * non-compliance testing. This never reads, updates or deletes canonical
 * taxonomy identities: every slug begins with `sandbox-`.
 *
 * Leaf categories retain every mandatory master/variant attribute definition
 * and deliberately contain zero compliance requirements. Media starts empty
 * and is never overwritten on repair.
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import Category from '../src/models/category.model.js';
import ProductMaster from '../src/models/productMaster.model.js';
import User from '../src/models/user.model.js';
import categoryService from '../src/services/category.service.js';
import { categoryCreateSchema } from '../src/utils/validators/catalog.validators.js';
import { CATEGORY_PLAYBOOKS } from '../src/data/catalogCategoryPlaybooks.js';
import {
  buildSandboxTaxonomyBlueprints,
  CATALOG_SANDBOX_COUNTS,
  SANDBOX_PREFIX,
} from '../src/data/catalogSandboxBlueprints.js';

const DEFAULT_ACTOR_ID = '6a97b0e9a61173c01d040435';
const argv = process.argv.slice(2);
const args = new Set(argv);
const valueArg = (name) => argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const options = {
  apply: args.has('--apply'),
  validateOnly: args.has('--validate-only'),
  continueOnError: args.has('--continue-on-error'),
  acceptProductImpact: args.has('--accept-product-impact'),
  acknowledged: args.has('--acknowledge-noncompliant-sandbox'),
  actorId: valueArg('--actor') || DEFAULT_ACTOR_ID,
};

const fail = (message) => { throw new Error(message); };
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const cleanField = (field) => Object.fromEntries(Object.entries(field).filter(([, value]) => value !== null));
const comparableField = (field) => ({
  key: field.key, label: field.label || null, type: field.type || 'string', required: Boolean(field.required),
  appliesTo: field.appliesTo || 'master', options: [...(field.options || [])], unit: field.unit || null,
  min: field.min ?? null, max: field.max ?? null, regex: field.regex || null,
  multiple: Boolean(field.multiple), filterable: Boolean(field.filterable), facetable: Boolean(field.facetable),
  searchable: Boolean(field.searchable), group: field.group || null, sortOrder: field.sortOrder ?? 0,
});

function validateBlueprint(rows) {
  const errors = [];
  const slugs = new Set();
  const playbookById = new Map(CATEGORY_PLAYBOOKS.map((playbook) => [playbook.id, playbook]));
  for (const row of rows) {
    if (!row.slug.startsWith(`${SANDBOX_PREFIX}-`)) errors.push(`${row.slug}: sandbox namespace is missing`);
    if (slugs.has(row.slug)) errors.push(`${row.slug}: duplicate slug`);
    slugs.add(row.slug);
    if (row.parentSlug && !rows.some((candidate) => candidate.slug === row.parentSlug)) errors.push(`${row.slug}: parent ${row.parentSlug} is missing`);
    if (row.complianceRequirements.length) errors.push(`${row.slug}: compliance requirements must be empty`);
    if (row.kind === 'leaf') {
      const playbook = playbookById.get(row.canonicalSlug);
      const required = (playbook?.attributes || []).filter((field) => field.required);
      const expectedKeys = new Set(required.map((field) => field.key));
      const actualKeys = new Set(row.attributeSchema.map((field) => field.key));
      if (required.length !== row.attributeSchema.length) errors.push(`${row.slug}: expected ${required.length} mandatory fields, generated ${row.attributeSchema.length}`);
      for (const key of expectedKeys) if (!actualKeys.has(key)) errors.push(`${row.slug}: mandatory field ${key} is missing`);
      for (const field of row.attributeSchema) if (!field.required) errors.push(`${row.slug}.${field.key}: sandbox schema fields must be mandatory`);
    } else if (row.attributeSchema.length) errors.push(`${row.slug}: non-leaf schemas must be empty`);
    const contract = categoryCreateSchema.validate({
      name: row.name, slug: row.slug, description: row.description,
      attributeSchema: row.attributeSchema.map(cleanField), complianceRequirements: [],
      sortOrder: row.sortOrder, isFeatured: false, status: 'active',
    }, { abortEarly: false });
    if (contract.error) errors.push(`${row.slug}: ${contract.error.details.map((detail) => detail.message).join('; ')}`);
  }
  if (rows.length !== CATALOG_SANDBOX_COUNTS.categories) errors.push(`Expected ${CATALOG_SANDBOX_COUNTS.categories} categories, generated ${rows.length}`);
  if (errors.length) fail(`Sandbox taxonomy validation failed:\n- ${errors.join('\n- ')}`);
  return rows;
}

function printCoverage() {
  console.log('\nNon-compliance sandbox taxonomy');
  console.log(`  ${CATALOG_SANDBOX_COUNTS.roots} roots · ${CATALOG_SANDBOX_COUNTS.sections} sections · ${CATALOG_SANDBOX_COUNTS.leaves} leaves`);
  console.log(`  ${CATALOG_SANDBOX_COUNTS.requiredAttributeFields} mandatory attribute definitions · 0 compliance requirements`);
  console.log('  namespace sandbox-* · media empty');
}

async function verifyActor() {
  if (!mongoose.isValidObjectId(options.actorId)) fail(`Invalid --actor ObjectId: ${options.actorId}`);
  const actor = await User.findById(options.actorId).select('role status');
  if (!actor) fail(`Super-admin actor ${options.actorId} does not exist`);
  if (actor.role !== 'super_admin' || actor.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin`);
}

async function buildPlan(rows) {
  const existing = await Category.find({ slug: { $in: rows.map((row) => row.slug) } }).select('+updatedBy');
  const bySlug = new Map(existing.map((category) => [category.slug, category]));
  const referenced = existing.length ? await ProductMaster.aggregate([
    { $match: { categoryId: { $in: existing.map((category) => category._id) }, isDeleted: { $ne: true } } },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]) : [];
  const referencesById = new Map(referenced.map((entry) => [String(entry._id), entry.count]));
  const virtualIds = new Map(rows.map((row) => [row.slug, bySlug.get(row.slug)?._id || new mongoose.Types.ObjectId()]));
  return rows.map((row) => {
    const current = bySlug.get(row.slug);
    const parentId = row.parentSlug ? virtualIds.get(row.parentSlug) : null;
    const desired = {
      name: row.name, slug: row.slug, parentId: parentId ? String(parentId) : null,
      description: row.description, attributeSchema: row.attributeSchema.map(comparableField),
      complianceRequirements: [], sortOrder: row.sortOrder,
      isFeatured: current ? Boolean(current.isFeatured) : false,
      status: current?.status || 'active',
    };
    if (!current) return { action: 'create', row, desired, parentId, products: 0 };
    const actual = {
      name: current.name, slug: current.slug, parentId: current.parentId ? String(current.parentId) : null,
      description: current.description || null,
      attributeSchema: (current.attributeSchema || []).map(comparableField),
      complianceRequirements: current.complianceRequirements || [], sortOrder: Number(current.sortOrder || 0),
      isFeatured: Boolean(current.isFeatured), status: current.status || 'active',
    };
    const changed = !same(actual, desired);
    return {
      action: changed ? 'repair' : 'unchanged', row, desired, parentId, current,
      products: changed ? referencesById.get(String(current._id)) || 0 : 0,
    };
  });
}

function printPlan(plan) {
  const count = (action) => plan.filter((item) => item.action === action).length;
  console.log('\nDatabase plan');
  console.log(`  create ${count('create')} · repair ${count('repair')} · unchanged ${count('unchanged')}`);
  const impacted = plan.reduce((sum, item) => sum + item.products, 0);
  if (impacted) console.log(`  ${impacted} existing sandbox product master reference(s) affected by schema repairs`);
}

async function applyPlan(plan) {
  const ids = new Map();
  const result = { created: 0, repaired: 0, unchanged: 0, failures: [] };
  for (const item of plan) {
    try {
      const parentId = item.row.parentSlug ? ids.get(item.row.parentSlug) : null;
      if (item.row.parentSlug && !parentId) fail(`${item.row.slug}: parent was not resolved`);
      if (item.action === 'unchanged') {
        ids.set(item.row.slug, item.current._id);
        result.unchanged += 1;
        continue;
      }
      const payload = {
        name: item.row.name, slug: item.row.slug, parentId: parentId || null,
        description: item.row.description, attributeSchema: item.row.attributeSchema,
        complianceRequirements: [], sortOrder: item.row.sortOrder,
        isFeatured: item.desired.isFeatured, status: item.desired.status,
      };
      let category;
      if (item.action === 'create') {
        // Parent IDs, audit records and outbox events make taxonomy writes sequential.
        // eslint-disable-next-line no-await-in-loop
        category = await categoryService.create({
          payload: { ...payload, imageUrl: null, iconUrl: null, bannerUrl: null },
          actorId: options.actorId,
        });
        result.created += 1;
      } else {
        // Parent-dependent repairs must remain sequential while preserving media and operator curation.
        // eslint-disable-next-line no-await-in-loop
        category = await categoryService.update({ id: item.current._id, patch: payload, actorId: options.actorId });
        result.repaired += 1;
      }
      ids.set(item.row.slug, category._id);
    } catch (error) {
      result.failures.push({ slug: item.row.slug, error: error.message });
      if (!options.continueOnError) throw error;
    }
  }
  return result;
}

async function main() {
  const rows = validateBlueprint(buildSandboxTaxonomyBlueprints());
  printCoverage();
  if (options.validateOnly) {
    console.log('\n✓ Sandbox taxonomy is internally valid and matches the category mutation contract.');
    return;
  }
  await connectDb();
  if (!mongoose.connection.name) fail('MongoDB connected without a resolved database name');
  console.log(`\nDatabase target: ${mongoose.connection.name}`);
  await verifyActor();
  const plan = await buildPlan(rows);
  printPlan(plan);
  if (!options.apply) {
    console.log('\nDRY RUN — no documents were changed.');
    console.log('Apply requires --apply --acknowledge-noncompliant-sandbox.');
    return;
  }
  if (!options.acknowledged) fail('Refusing apply: pass --acknowledge-noncompliant-sandbox to confirm these categories intentionally omit compliance gates');
  const impacted = plan.reduce((sum, item) => sum + item.products, 0);
  if (impacted && !options.acceptProductImpact) fail(`Refusing to repair schemas referenced by ${impacted} products without --accept-product-impact`);
  const result = await applyPlan(plan);
  console.log(`\n✓ Sandbox taxonomy applied: ${result.created} created · ${result.repaired} repaired · ${result.unchanged} unchanged.`);
  if (result.failures.length) {
    for (const failure of result.failures) console.error(`  ${failure.slug}: ${failure.error}`);
    process.exitCode = 1;
    return;
  }
  const verification = await buildPlan(rows);
  const unsettled = verification.filter((item) => item.action !== 'unchanged');
  if (unsettled.length) fail(`Post-apply verification found ${unsettled.length} unsettled sandbox categories`);
  console.log(`✓ Database verification passed: all ${rows.length} sandbox categories are settled with zero compliance requirements.`);
}

main()
  .catch((error) => {
    console.error(`\n✗ Sandbox taxonomy seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await disconnectDb();
  });
