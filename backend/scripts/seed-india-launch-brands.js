#!/usr/bin/env node
/** Separate, idempotent India-launch brand seed. Run taxonomy first. */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import User from '../src/models/user.model.js';
import Category from '../src/models/category.model.js';
import Brand from '../src/models/brand.model.js';
import brandService from '../src/services/brand.service.js';
import { brandCreateSchema } from '../src/utils/validators/catalog.validators.js';
import { INDIA_LAUNCH_BRANDS, INDIA_LAUNCH_CATEGORIES } from '../src/data/indiaLaunchCatalogBlueprints.js';

const argv = process.argv.slice(2); const args = new Set(argv); const valueArg = (name) => argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
const options = { apply: args.has('--apply'), validateOnly: args.has('--validate-only'), continueOnError: args.has('--continue-on-error'), actorId: valueArg('--actor') || '6a97b0e9a61173c01d040435' };
const fail = (message) => { throw new Error(message); }; const normalized = (value) => String(value).normalize('NFKC').trim().toLocaleLowerCase('en');
const payloadFor = (row, index) => ({ name: row.name, slug: row.slug, logoUrl: row.logoUrl, bannerUrl: row.bannerUrl, tagline: null, description: row.description, story: null, countryOfOrigin: row.countryOfOrigin, website: row.website, foundedYear: null, headquarters: null, socialLinks: {}, isFeatured: false, sortOrder: index * 10, status: 'active', verification: { status: 'pending', isVerified: false, verifiedAt: null } });
const patchFor = (doc, payload) => {
  const patch = {}; for (const key of ['name', 'slug']) if (doc[key] !== payload[key]) patch[key] = payload[key];
  // Existing governance, copy, curation and real media always win. Seed only gaps.
  for (const key of ['logoUrl', 'bannerUrl', 'description', 'countryOfOrigin', 'website']) if (!doc[key] && payload[key]) patch[key] = payload[key];
  return patch;
};
function validate() {
  const errors = []; const slugs = new Set(); const names = new Set(); const verticals = new Set(INDIA_LAUNCH_CATEGORIES.map((row) => row.vertical));
  for (const [index, brand] of INDIA_LAUNCH_BRANDS.entries()) { const name = normalized(brand.name); if (slugs.has(brand.slug)) errors.push(`duplicate slug ${brand.slug}`); if (names.has(name)) errors.push(`duplicate name ${brand.name}`); slugs.add(brand.slug); names.add(name); if (!brand.verticals.every((v) => verticals.has(v))) errors.push(`${brand.name}: unknown vertical`); for (const key of ['logoUrl','bannerUrl']) if (!/^https:\/\//.test(brand[key])) errors.push(`${brand.name}: invalid ${key}`); if (brand.website && !/^https:\/\//.test(brand.website)) errors.push(`${brand.name}: invalid website`); const { verification: ignored, ...contractPayload } = payloadFor(brand, index); const contract = brandCreateSchema.validate(contractPayload, { abortEarly: false }); if (contract.error) errors.push(`${brand.name}: mutation contract: ${contract.error.message}`); }
  for (const owned of ['VS DAIRIES','Sattva Fresh','Veda Blooms']) if (!names.has(normalized(owned))) errors.push(`missing owned brand ${owned}`);
  if (INDIA_LAUNCH_BRANDS.length < 250 || INDIA_LAUNCH_BRANDS.length > 400) errors.push(`expected 250–400 brands, found ${INDIA_LAUNCH_BRANDS.length}`);
  if (errors.length) fail(`Blueprint invalid:\n- ${errors.join('\n- ')}`); console.log(`India launch brands: ${INDIA_LAUNCH_BRANDS.length} unique brands with remote logo/banner media`);
}
async function actor() { const user = mongoose.isValidObjectId(options.actorId) && await User.findById(options.actorId).select('role status').lean(); if (!user || user.role !== 'super_admin' || user.status !== 'active') fail(`Actor ${options.actorId} must be an active super_admin`); }
async function main() {
  validate(); if (options.validateOnly) return console.log('✓ Brand blueprint valid (database not opened).'); await connectDb(); await actor();
  const leaves = INDIA_LAUNCH_CATEGORIES.filter((row) => row.level === 'leaf').map((row) => row.slug); const categoryCount = await Category.countDocuments({ slug: { $in: leaves }, isDeleted: false }); if (categoryCount !== leaves.length) fail(`Taxonomy dependency missing: found ${categoryCount}/${leaves.length} launch leaves. Run seed:india:taxonomy -- --apply first.`);
  const docs = await Brand.find({ $or: [{ slug: { $in: INDIA_LAUNCH_BRANDS.map((row) => row.slug) } }, { name: { $in: INDIA_LAUNCH_BRANDS.map((row) => row.name) } }] }); const bySlug = new Map(docs.map((doc) => [doc.slug, doc])); const byName = new Map(docs.map((doc) => [normalized(doc.name), doc])); const summary = { create: 0, update: 0, unchanged: 0, failures: [] };
  for (let index = 0; index < INDIA_LAUNCH_BRANDS.length; index += 1) { const row = INDIA_LAUNCH_BRANDS[index]; const slugDoc = bySlug.get(row.slug); const nameDoc = byName.get(normalized(row.name)); if (slugDoc && nameDoc && String(slugDoc._id) !== String(nameDoc._id)) fail(`${row.name}: name/slug collision requires manual merge`); const current = slugDoc || nameDoc; const payload = payloadFor(row, index); const patch = current ? patchFor(current, payload) : null; const action = !current ? 'create' : Object.keys(patch).length ? 'update' : 'unchanged'; summary[action] += 1; if (!options.apply || action === 'unchanged') continue;
    try {
      // Ordered service writes preserve deterministic audit and outbox order.
      // eslint-disable-next-line no-await-in-loop
      await (action === 'create' ? brandService.create({ payload, actorId: options.actorId }) : brandService.update({ id: current._id, patch, actorId: options.actorId }));
    } catch (error) { summary.failures.push({ name: row.name, error: error.message }); if (!options.continueOnError) throw error; }
  }
  console.log(`${options.apply ? 'Applied' : 'DRY RUN'}: ${summary.create} create · ${summary.update} update · ${summary.unchanged} unchanged`); if (!options.apply) console.log('No documents changed. Add --apply to execute.'); if (summary.failures.length) { console.error(summary.failures); process.exitCode = 1; }
}
main().catch((error) => { console.error(`✗ India brand seed failed: ${error.message}`); process.exitCode = 1; }).finally(async () => { if (mongoose.connection.readyState) await disconnectDb(); });
