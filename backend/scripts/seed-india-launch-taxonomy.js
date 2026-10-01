#!/usr/bin/env node
/** Separate, idempotent India-launch taxonomy seed. Dry-run unless --apply. */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import User from '../src/models/user.model.js';
import Category from '../src/models/category.model.js';
import categoryService from '../src/services/category.service.js';
import { categoryCreateSchema } from '../src/utils/validators/catalog.validators.js';
import { INDIA_LAUNCH_CATEGORIES } from '../src/data/indiaLaunchCatalogBlueprints.js';

const argv = process.argv.slice(2); const args = new Set(argv);
const valueArg = (name) => argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
const options = { apply: args.has('--apply'), validateOnly: args.has('--validate-only'), continueOnError: args.has('--continue-on-error'), actorId: valueArg('--actor') || '6a97b0e9a61173c01d040435' };
const fail = (message) => { throw new Error(message); };
const levels = { root: 0, section: 1, leaf: 2 };
const comparable = (row, parentId) => ({ name: row.name, slug: row.slug, parentId: parentId ? String(parentId) : null, level: levels[row.level], description: row.description, imageUrl: row.imageUrl, iconUrl: row.iconUrl, bannerUrl: row.bannerUrl, attributeSchema: row.attributeSchema, complianceRequirements: [], sortOrder: row.sortOrder, isFeatured: row.level === 'root', status: 'active' });
const stable = (value) => JSON.stringify(value, (key, item) => key === '_id' ? undefined : item);

function validate() {
  const errors = []; const slugs = new Set(); const all = new Set(INDIA_LAUNCH_CATEGORIES.map((row) => row.slug));
  for (const row of INDIA_LAUNCH_CATEGORIES) {
    if (slugs.has(row.slug)) errors.push(`duplicate slug ${row.slug}`); slugs.add(row.slug);
    if (row.parentSlug && !all.has(row.parentSlug)) errors.push(`${row.slug}: missing parent ${row.parentSlug}`);
    if (row.complianceRequirements.length) errors.push(`${row.slug}: launch compliance must be empty`);
    if (![row.imageUrl, row.iconUrl, row.bannerUrl].every((url) => /^https:\/\//.test(url))) errors.push(`${row.slug}: missing HTTPS media`);
    if (row.level === 'leaf' && (!row.attributeSchema.length || row.attributeSchema.some((field) => !field.required))) errors.push(`${row.slug}: incomplete required schema`);
    const { level: ignored, ...contractPayload } = comparable(row, row.parentSlug ? '000000000000000000000001' : null); const contract = categoryCreateSchema.validate(contractPayload, { abortEarly: false }); if (contract.error) errors.push(`${row.slug}: mutation contract: ${contract.error.message}`);
  }
  if (errors.length) fail(`Blueprint invalid:\n- ${errors.join('\n- ')}`);
  console.log(`India launch taxonomy: ${INDIA_LAUNCH_CATEGORIES.length} categories · ${INDIA_LAUNCH_CATEGORIES.filter((row) => row.level === 'leaf').length} governed leaves · 0 compliance requirements`);
}
async function actor() { if (!mongoose.isValidObjectId(options.actorId)) fail('Invalid actor ObjectId'); const user = await User.findById(options.actorId).select('role status').lean(); if (!user || user.role !== 'super_admin' || user.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin`); }

async function main() {
  validate(); if (options.validateOnly) return console.log('✓ Taxonomy blueprint valid (database not opened).');
  await connectDb(); await actor();
  const existing = await Category.find({ slug: { $in: INDIA_LAUNCH_CATEGORIES.map((row) => row.slug) } }); const bySlug = new Map(existing.map((doc) => [doc.slug, doc])); const ids = new Map();
  const summary = { create: 0, update: 0, unchanged: 0, failures: [] };
  for (const row of INDIA_LAUNCH_CATEGORIES) {
    const current = bySlug.get(row.slug); const parentId = row.parentSlug ? ids.get(row.parentSlug) || bySlug.get(row.parentSlug)?._id : null; if (row.parentSlug && !parentId) fail(`${row.slug}: parent was not resolved`);
    const payload = comparable(row, parentId); const desiredValue = comparable({ ...new Category(payload).toObject(), level: row.level }, parentId); const currentValue = current && comparable({ ...current.toObject(), level: row.level }, current.parentId);
    const action = !current ? 'create' : stable(desiredValue) === stable(currentValue) ? 'unchanged' : 'update'; summary[action] += 1;
    if (!options.apply || action === 'unchanged') { if (current) ids.set(row.slug, current._id); else ids.set(row.slug, new mongoose.Types.ObjectId()); continue; }
    try {
      // Ordered writes guarantee parent IDs and deterministic audit/outbox order.
      // eslint-disable-next-line no-await-in-loop
      const doc = action === 'create' ? await categoryService.create({ payload, actorId: options.actorId }) : await categoryService.update({ id: current._id, patch: payload, actorId: options.actorId });
      ids.set(row.slug, doc._id);
    } catch (error) { summary.failures.push({ slug: row.slug, error: error.message }); if (!options.continueOnError) throw error; }
  }
  console.log(`${options.apply ? 'Applied' : 'DRY RUN'}: ${summary.create} create · ${summary.update} update · ${summary.unchanged} unchanged`); if (!options.apply) console.log('No documents changed. Add --apply to execute.');
  if (summary.failures.length) { console.error(summary.failures); process.exitCode = 1; }
}
main().catch((error) => { console.error(`✗ India taxonomy seed failed: ${error.message}`); process.exitCode = 1; }).finally(async () => { if (mongoose.connection.readyState) await disconnectDb(); });
