import crypto from 'node:crypto';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import ProductVariant from '../models/productVariant.model.js';
import ProductImage from '../models/productImage.model.js';
import ProductAttributeValue from '../models/productAttributeValue.model.js';
import ProductVariantAttributeValue from '../models/productVariantAttributeValue.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import SearchDocument from '../models/searchDocument.model.js';
import ProductCompliance from '../models/productCompliance.model.js';
import Inventory from '../models/inventory.model.js';
import CatalogQualityAssessment from '../models/catalogQualityAssessment.model.js';
import CatalogQualityRun from '../models/catalogQualityRun.model.js';
import { literalRegex } from '../utils/regex.js';
import { conflict, notFound } from '../utils/ApiError.js';

const DIMENSIONS = Object.freeze({
  identity: ['Canonical identity', 13, 15], taxonomy: ['Taxonomy & specifications', 17, 20], variants: ['Variant integrity', 13, 15],
  media: ['Media quality', 17, 20], content: ['Content & SEO', 10, 10], commerce: ['Commerce readiness', 12, 12],
  inventory: ['Inventory integrity', 7, 7], compliance: ['Compliance evidence', 6, 6], search: ['Search freshness', 5, 5],
});
const ASSESSMENT_REFRESH_MS = 24 * 60 * 60 * 1000;
const EVALUATOR_VERSION = 'catalog-quality-v2';
const RUN_BATCH_SIZE = 100;
const RUN_SCAN_SIZE = 1000;
const RUN_LEASE_MS = 60_000;
const RUN_MAX_ATTEMPTS = 5;
const RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const gradeFor = (score) => (score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F');
const truthyText = (value, min = 1) => typeof value === 'string' && value.trim().length >= min;
const mapPush = (map, key, value) => {
  const id = String(key);
  if (!map.has(id)) map.set(id, []);
  map.get(id).push(value);
};

function issue(code, severity, owner, label, message, action, field = null) {
  return { code, severity, owner, label, message, action, field };
}

class CatalogQualityService {
  evaluateOne({ tenantId, master, category, brand, listings, variants, images, attributes, variantAttributes, searchDocs, compliances = [], inventories = [], previousAssessment, qualityRunId, now }) {
    const issues = [];
    const scores = {};
    const add = (...args) => issues.push(issue(...args));

    // Identity — canonical identity should be useful outside this one store.
    let identity = 0;
    if (truthyText(master.title, 8)) identity += 3; else add('IDENTITY_TITLE_WEAK', 'warning', 'master', 'Improve product title', 'Use a specific, customer-readable title of at least 8 characters.', 'Edit Product Master → Identity.', 'title');
    if (category) identity += 3; else add('IDENTITY_CATEGORY_MISSING', 'blocker', 'taxonomy', 'Category missing', 'The product is not connected to a governed category.', 'Assign an active leaf category.', 'categoryId');
    if (brand) identity += 2; else add('IDENTITY_BRAND_MISSING', 'warning', 'master', 'Brand missing', 'Brand attribution improves trust, filtering and search.', 'Assign the verified manufacturer brand.', 'brandId');
    if (truthyText(master.type)) identity += 2;
    if (truthyText(master.manufacturer)) identity += 2; else add('IDENTITY_MANUFACTURER_MISSING', 'warning', 'master', 'Manufacturer missing', 'Manufacturer identity is absent.', 'Add the factual manufacturer.', 'manufacturer');
    if (truthyText(master.modelNumber) || truthyText(master.identifiers?.gtin) || truthyText(master.barcode)) identity += 3;
    else add('IDENTITY_IDENTIFIER_MISSING', 'warning', 'master', 'Model or identifier missing', 'No model number, GTIN or barcode is present.', 'Add a factual model number or global identifier.', 'identifiers');
    scores.identity = identity;

    // Taxonomy and typed required attributes.
    const requiredMaster = (category?.attributeSchema || []).filter((field) => field.required && ['master', 'both'].includes(field.appliesTo || 'master'));
    const masterAttrKeys = new Set(attributes.map((row) => row.attributeKey));
    const missingMaster = requiredMaster.filter((field) => !masterAttrKeys.has(field.key));
    const requiredVariant = (category?.attributeSchema || []).filter((field) => field.required && ['variant', 'both'].includes(field.appliesTo));
    const activeVariants = variants.filter((row) => row.status === 'active' && row.isDeleted !== true);
    const variantAttrByVariant = new Map();
    for (const row of variantAttributes) mapPush(variantAttrByVariant, row.productVariantId, row);
    const missingVariantPairs = [];
    for (const variant of activeVariants) {
      const keys = new Set((variantAttrByVariant.get(String(variant._id)) || []).map((row) => row.attributeKey));
      for (const field of requiredVariant) if (!keys.has(field.key)) missingVariantPairs.push(`${variant.displayLabel || variant.value || variant.sku}: ${field.label || field.key}`);
    }
    const requiredTotal = requiredMaster.length + (requiredVariant.length * Math.max(activeVariants.length, 1));
    const requiredMissing = missingMaster.length + missingVariantPairs.length;
    let taxonomy = category ? 5 : 0;
    taxonomy += requiredTotal ? Math.round(10 * Math.max(0, (requiredTotal - requiredMissing) / requiredTotal)) : 10;
    if (master.unitPolicy?.baseUnit && master.unitPolicy?.units?.length) taxonomy += 5;
    else add('TAXONOMY_UNIT_POLICY_MISSING', 'warning', 'master', 'Unit policy incomplete', 'The universal selling-unit and conversion policy is not defined.', 'Configure Product Master → Units.', 'unitPolicy');
    if (missingMaster.length) add('TAXONOMY_REQUIRED_ATTRIBUTES_MISSING', 'blocker', 'taxonomy', 'Required specifications missing', `${missingMaster.map((field) => field.label || field.key).join(', ')} must be completed.`, 'Complete the required category specifications.', 'attributes');
    if (missingVariantPairs.length) add('VARIANT_REQUIRED_ATTRIBUTES_MISSING', 'blocker', 'variant', 'Variant specifications missing', `${missingVariantPairs.slice(0, 8).join(', ')}${missingVariantPairs.length > 8 ? ` and ${missingVariantPairs.length - 8} more` : ''}.`, 'Complete required attributes on every active variant.', 'variantAttributes');
    scores.taxonomy = Math.min(20, taxonomy);

    // Variant family integrity.
    let variantScore = 0;
    if (activeVariants.length) variantScore += 5; else add('VARIANT_NONE_ACTIVE', 'blocker', 'variant', 'No active variants', 'Every product master must expose at least one active sellable variant.', 'Create or activate a product variant.');
    const defaults = activeVariants.filter((row) => row.isDefault);
    if (defaults.length === 1) variantScore += 4; else add('VARIANT_DEFAULT_INVALID', 'blocker', 'variant', 'Default variant invalid', `Expected exactly one default active variant; found ${defaults.length}.`, 'Select exactly one default variant.', 'isDefault');
    const combinationKeys = activeVariants.map((row) => row.combinationKey || row.value || row.sku).filter(Boolean);
    if (new Set(combinationKeys).size === combinationKeys.length) variantScore += 3; else add('VARIANT_COMBINATION_DUPLICATE', 'blocker', 'variant', 'Duplicate variant combinations', 'Two or more active variants resolve to the same option combination.', 'Repair option values and combination keys.', 'combinationKey');
    const listedVariantIds = new Set(listings.filter((row) => row.variantId).map((row) => String(row.variantId)));
    const listedActive = activeVariants.filter((row) => listedVariantIds.has(String(row._id))).length;
    if (activeVariants.length && listedActive === activeVariants.length) variantScore += 3;
    else add('VARIANT_LISTING_COVERAGE', 'warning', 'listing', 'Some variants are not listed', `${listedActive} of ${activeVariants.length} active variants have tenant listings.`, 'List intended variants or archive variants that should not be sold.');
    scores.variants = variantScore;

    // Media quality and variant visual coverage.
    const activeImages = images.filter((row) => row.status === 'active' && row.isDeleted !== true && row.mediaType === 'image');
    let media = 0;
    if (activeImages.length) media += 5; else add('MEDIA_IMAGE_MISSING', 'blocker', 'media', 'Product image missing', 'Customers cannot verify a product without real media.', 'Add a factual primary product image.');
    if (activeImages.some((row) => row.isPrimary)) media += 4; else add('MEDIA_PRIMARY_MISSING', 'blocker', 'media', 'Primary image missing', 'No active image is designated as primary.', 'Choose the storefront primary image.', 'isPrimary');
    const withAlt = activeImages.filter((row) => truthyText(row.altText, 5)).length;
    if (activeImages.length && withAlt === activeImages.length) media += 3; else if (activeImages.length) add('MEDIA_ALT_TEXT_MISSING', 'warning', 'media', 'Alternative text incomplete', `${activeImages.length - withAlt} images have no useful alternative text.`, 'Describe the visible product for accessibility.', 'altText');
    const measured = activeImages.filter((row) => row.width && row.height);
    const highResolution = measured.filter((row) => row.width >= 800 && row.height >= 800).length;
    if (activeImages.length && measured.length === activeImages.length && highResolution === activeImages.length) media += 4;
    else if (activeImages.length) add('MEDIA_DIMENSIONS_WEAK', 'warning', 'media', 'Image resolution unverified or low', 'Every product image should record dimensions and be at least 800 × 800.', 'Replace or reprocess low-resolution media.', 'dimensions');
    const variantsWithMedia = new Set(activeImages.filter((row) => row.variantId).map((row) => String(row.variantId)));
    if (!activeVariants.length || activeVariants.every((row) => variantsWithMedia.has(String(row._id))) || activeImages.some((row) => !row.variantId)) media += 4;
    else add('MEDIA_VARIANT_COVERAGE', 'warning', 'media', 'Variant imagery incomplete', 'Some variants have neither their own media nor a master-level fallback.', 'Add accurate images for each visually distinct variant.');
    scores.media = media;

    // Content and SEO.
    let content = 0;
    if (truthyText(master.shortDescription, 40)) content += 2; else add('CONTENT_SHORT_DESCRIPTION_WEAK', 'warning', 'master', 'Short description is weak', 'Add a concise factual customer summary of at least 40 characters.', 'Edit Product Master → Description.', 'shortDescription');
    if (truthyText(master.description, 120)) content += 3; else add('CONTENT_DESCRIPTION_WEAK', 'warning', 'master', 'Detailed description is weak', 'The detailed description should explain materials, use, contents and care.', 'Add at least 120 characters of factual detail.', 'description');
    if (truthyText(master.seo?.title, 20) && truthyText(master.seo?.description, 60)) content += 3; else add('SEO_METADATA_INCOMPLETE', 'warning', 'master', 'SEO metadata incomplete', 'Search title or description is missing or too short.', 'Complete Product Master → SEO.', 'seo');
    if ((master.tags || []).length >= 3) content += 2; else add('CONTENT_TAGS_WEAK', 'info', 'master', 'Search tags are sparse', 'Use at least three factual search terms.', 'Add category-relevant tags.', 'tags');
    scores.content = content;

    // Tenant commerce readiness.
    const validPrice = (row) => Number.isFinite(Number(row.price?.sellingPrice)) && Number(row.price?.sellingPrice) > 0 && (row.price?.mrp == null || Number(row.price.mrp) >= Number(row.price.sellingPrice));
    const activeListings = listings.filter((row) => row.status === 'active' && row.isDeleted !== true);
    const storefrontListings = activeListings.filter((row) => row.channels?.storefront !== false);
    let commerce = 0;
    if (activeListings.length) commerce += 4; else add('LISTING_NONE_ACTIVE', 'blocker', 'listing', 'No active listing', 'The store has no active offer for this product family.', 'Activate at least one valid variant listing.');
    if (listings.length && listings.every(validPrice)) commerce += 4; else add('LISTING_PRICE_INVALID', 'blocker', 'listing', 'Listing price invalid', 'Every listing requires a positive selling price and MRP not below selling price.', 'Repair tenant listing prices.', 'price');
    if (storefrontListings.length) commerce += 2; else add('LISTING_STOREFRONT_DISABLED', 'blocker', 'listing', 'Storefront channel disabled', 'No active offer is enabled for storefront discovery.', 'Enable the storefront channel.', 'channels.storefront');
    if (listings.every((row) => Number(row.priceBasis?.quantity) > 0 && truthyText(row.priceBasis?.unitCode))) commerce += 2; else add('LISTING_PRICE_BASIS_INVALID', 'blocker', 'listing', 'Quantity identity incomplete', 'A listing is missing its price-basis quantity or unit.', 'Repair listing quantity identity.', 'priceBasis');
    if (master.status !== 'active') add('MASTER_NOT_ACTIVE', 'blocker', 'master', 'Master is not active', `Master status is ${master.status || 'unknown'}.`, 'Complete review and activate the global master.', 'status');
    scores.commerce = commerce;

    // Inventory truth, allocatability and denormalized storefront consistency.
    const inventoryByListing = new Map();
    for (const row of inventories) mapPush(inventoryByListing, row.tenantProductId, row);
    let inventory = 0;
    if (activeListings.length) {
      const allocatable = storefrontListings.some((listing) => {
        const records = inventoryByListing.get(String(listing._id)) || [];
        const available = records.reduce((sum, row) => sum + Math.max(0, Number(row.qtyOnHand || 0) - Number(row.qtyReserved || 0)), 0);
        return available > 0 || listing.sellingPolicy?.allowBackorder;
      });
      if (allocatable) inventory += 4; else add('INVENTORY_UNAVAILABLE', 'warning', 'inventory', 'No allocatable stock', 'All storefront offers are out of stock and backorder is disabled.', 'Receive inventory or configure an intentional backorder policy.');
      const missingInventory = activeListings.filter((row) => !(inventoryByListing.get(String(row._id)) || []).length);
      if (!missingInventory.length) inventory += 2;
      else add('INVENTORY_RECORD_MISSING', 'warning', 'inventory', 'Inventory truth is incomplete', `${missingInventory.length} active listings do not have an inventory record.`, 'Create or reconcile inventory records for every active listing.');
      const drifted = activeListings.filter((listing) => {
        const records = inventoryByListing.get(String(listing._id)) || [];
        return records.length && records.reduce((sum, row) => sum + Number(row.qtyOnHand || 0), 0) !== Number(listing.stockQty || 0);
      });
      if (!drifted.length) inventory += 1;
      else add('INVENTORY_SNAPSHOT_DRIFT', 'warning', 'inventory', 'Storefront stock snapshot drift', `${drifted.length} listing stock snapshots differ from inventory truth.`, 'Reconcile inventory and refresh denormalized listing stock.', 'stockQty');
    }
    scores.inventory = inventory;

    // Category-driven compliance evidence is evaluated independently from commerce.
    const requirements = (category?.complianceRequirements || []).filter((row) => row.required !== false);
    const verifiedByCode = new Map(compliances.filter((row) => row.status === 'verified' && (!row.validUntil || new Date(row.validUntil) > now)).map((row) => [row.code, row]));
    const missingCompliance = requirements.filter((row) => !verifiedByCode.has(row.code));
    let compliance = requirements.length ? Math.round(6 * (requirements.length - missingCompliance.length) / requirements.length) : 6;
    if (missingCompliance.length) add('COMPLIANCE_EVIDENCE_MISSING', 'blocker', 'master', 'Required compliance evidence missing', `${missingCompliance.map((row) => row.label || row.code).slice(0, 6).join(', ')}${missingCompliance.length > 6 ? ` and ${missingCompliance.length - 6} more` : ''}.`, 'Upload and verify current evidence for every required category obligation.', 'compliance');
    const expired = compliances.filter((row) => row.status === 'expired' || (row.validUntil && new Date(row.validUntil) <= now));
    if (expired.length) {
      compliance = Math.max(0, compliance - 1);
      add('COMPLIANCE_EVIDENCE_EXPIRED', 'blocker', 'master', 'Compliance evidence expired', `${expired.length} compliance records are expired.`, 'Renew and verify the affected compliance evidence.', 'compliance');
    }
    if (master.complianceStatus === 'pending') add('COMPLIANCE_PENDING', 'blocker', 'master', 'Compliance pending', 'Required compliance evidence has not been approved.', 'Complete compliance verification.', 'complianceStatus');
    scores.compliance = compliance;

    // Search projection freshness.
    const activeDocCount = searchDocs.filter((row) => row.status === 'active').length;
    const expectedDocs = storefrontListings.length;
    let search = 0;
    if (activeDocCount === expectedDocs) search += 3; else add('SEARCH_DOCUMENT_DRIFT', 'warning', 'search', 'Search projection drift', `Expected ${expectedDocs} active search documents; found ${activeDocCount}.`, 'Reindex this product family and inspect outbox failures.');
    const newestSource = Math.max(new Date(master.updatedAt || master.createdAt || 0).getTime(), ...listings.map((row) => new Date(row.updatedAt || row.createdAt || 0).getTime()));
    const oldestIndex = searchDocs.length ? Math.min(...searchDocs.map((row) => new Date(row.indexedAt || 0).getTime())) : 0;
    if (expectedDocs === 0 || (oldestIndex >= newestSource && now.getTime() - oldestIndex < 7 * 24 * 60 * 60 * 1000)) search += 2;
    else add('SEARCH_DOCUMENT_STALE', 'warning', 'search', 'Search projection stale', 'Indexed catalog data is older than its source product or listing.', 'Drain the catalog outbox or run a targeted reindex.');
    scores.search = search;

    const dimensions = Object.entries(DIMENSIONS).map(([code, [label, maxScore, rawMax]]) => {
      const rawScore = Math.min(rawMax, scores[code] || 0);
      return {
        code, label, score: Math.round((rawScore / rawMax) * maxScore), maxScore,
        percent: Math.round((rawScore / rawMax) * 100),
      };
    });
    const score = Math.max(0, Math.min(100, dimensions.reduce((sum, row) => sum + row.score, 0)));
    const blockerCount = issues.filter((row) => row.severity === 'blocker').length;
    const warningCount = issues.filter((row) => row.severity === 'warning').length;
    const stableRows = (rows, projection) => rows.map(projection).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
      evaluatorVersion: EVALUATOR_VERSION,
      master: [String(master._id), master.version, master.updatedAt],
      category: category ? [String(category._id), category.version, category.updatedAt] : null,
      brand: brand ? [String(brand._id), brand.version, brand.updatedAt] : null,
      listings: stableRows(listings, (row) => [String(row._id), row.version, row.updatedAt]),
      variants: stableRows(variants, (row) => [String(row._id), row.updatedAt, row.status]),
      images: stableRows(images, (row) => [String(row._id), row.updatedAt, row.status]),
      attributes: stableRows([...attributes, ...variantAttributes], (row) => [String(row._id), row.updatedAt]),
      searchDocs: stableRows(searchDocs, (row) => [String(row._id), row.indexedAt, row.status]),
      compliances: stableRows(compliances, (row) => [String(row._id), row.updatedAt, row.status, row.validUntil]),
      inventories: stableRows(inventories, (row) => [String(row._id), row.updatedAt, row.qtyOnHand, row.qtyReserved]),
    })).digest('hex');
    const previousIssues = new Map((previousAssessment?.issues || []).map((row) => [row.fingerprint, row]));
    const durableIssues = issues.slice(0, 100).map((row) => {
      const issueFingerprint = crypto.createHash('sha256').update(JSON.stringify({
        evaluatorVersion: EVALUATOR_VERSION, productMasterId: String(master._id),
        code: row.code, owner: row.owner, field: row.field || null,
      })).digest('hex');
      return {
        ...row, fingerprint: issueFingerprint,
        firstDetectedAt: previousIssues.get(issueFingerprint)?.firstDetectedAt || now,
        lastDetectedAt: now,
      };
    });

    return {
      tenantId, productMasterId: master._id,
      snapshot: {
        title: master.title, slug: master.slug, skuGlobal: master.skuGlobal,
        categoryId: master.categoryId || null, categoryName: category?.name || null,
        brandId: master.brandId || null, status: master.status,
        listingCount: listings.length, activeListingCount: activeListings.length,
        variantCount: activeVariants.length, imageCount: activeImages.length,
      },
      score, grade: gradeFor(score), publishable: blockerCount === 0,
      launchReady: blockerCount === 0 && score >= 85,
      dimensions, issues: durableIssues, blockerCount, warningCount,
      sourceFingerprint: fingerprint, evaluatorVersion: EVALUATOR_VERSION,
      qualityRunId: qualityRunId || null, evaluatedAt: now,
    };
  }

  async createRun({ tenantId, actorId }) {
    const existing = await CatalogQualityRun.findOne({ tenantId, active: true }).lean();
    if (existing) return this.publicRun(existing);
    try {
      const run = await CatalogQualityRun.create({ tenantId, requestedBy: actorId, sourceCutoff: new Date() });
      return this.publicRun(run);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const concurrent = await CatalogQualityRun.findOne({ tenantId, active: true }).lean();
      if (!concurrent) throw error;
      return this.publicRun(concurrent);
    }
  }

  publicRun(run) {
    if (!run) return null;
    const value = typeof run.toJSON === 'function' ? run.toJSON() : { ...run };
    return {
      ...value, id: String(value.id || value._id), _id: undefined,
      errors: value.errorSummary || [], errorSummary: undefined,
      claimedBy: undefined, leaseExpiresAt: undefined,
    };
  }

  async getRun(runId, { tenantId } = {}) {
    const run = await CatalogQualityRun.findOne({ _id: runId, ...(tenantId ? { tenantId } : {}) }).lean();
    if (!run) throw notFound('Quality evaluation run not found', 'QUALITY_RUN_NOT_FOUND');
    return this.publicRun(run);
  }

  async listRuns({ tenantId, page = 1, limit = 10 }) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
    const [items, total] = await Promise.all([
      CatalogQualityRun.find({ tenantId }).sort({ createdAt: -1, _id: -1 })
        .skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      CatalogQualityRun.countDocuments({ tenantId }),
    ]);
    return {
      items: items.map((row) => this.publicRun(row)),
      meta: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit), hasMore: safePage * safeLimit < total },
    };
  }

  async cancelRun({ runId, tenantId }) {
    const now = new Date();
    let run = await CatalogQualityRun.findOneAndUpdate(
      { _id: runId, tenantId, status: 'queued', active: true },
      { $set: { status: 'cancelled', active: false, finishedAt: now, expiresAt: new Date(now.getTime() + RUN_RETENTION_MS) } },
      { new: true },
    );
    if (run) return this.publicRun(run);
    run = await CatalogQualityRun.findOneAndUpdate(
      { _id: runId, tenantId, status: 'running', active: true },
      { $set: { status: 'cancel_requested' } }, { new: true },
    );
    if (run) return this.publicRun(run);
    const existing = await CatalogQualityRun.findOne({ _id: runId, tenantId });
    if (!existing) throw notFound('Quality evaluation run not found', 'QUALITY_RUN_NOT_FOUND');
    throw conflict(`Cannot cancel a ${existing.status} quality run`, 'QUALITY_RUN_NOT_CANCELLABLE');
  }

  async retryRun({ runId, tenantId }) {
    const run = await CatalogQualityRun.findOne({ _id: runId, tenantId, status: 'failed', active: false });
    if (!run) throw conflict('Only a failed quality run can be retried', 'QUALITY_RUN_NOT_RETRYABLE');
    const active = await CatalogQualityRun.findOne({ tenantId, active: true }).lean();
    if (active) throw conflict('Another quality evaluation is already active', 'QUALITY_RUN_ACTIVE');
    run.status = 'queued'; run.active = true; run.attempts = 0; run.claimedBy = null;
    run.leaseExpiresAt = null; run.finishedAt = null; run.expiresAt = null;
    await run.save();
    return this.publicRun(run);
  }

  async claimNextRun(workerId) {
    const now = new Date();
    await CatalogQualityRun.updateMany(
      { active: true, status: 'cancel_requested', leaseExpiresAt: { $lte: now } },
      { $set: { status: 'cancelled', active: false, finishedAt: now, expiresAt: new Date(now.getTime() + RUN_RETENTION_MS), claimedBy: null, leaseExpiresAt: null } },
    );
    const exhausted = await CatalogQualityRun.find({
      active: true, status: 'running', attempts: { $gte: RUN_MAX_ATTEMPTS }, leaseExpiresAt: { $lte: now },
    }).select('_id');
    if (exhausted.length) {
      await CatalogQualityRun.updateMany(
        { _id: { $in: exhausted.map((row) => row._id) } },
        { $set: { status: 'failed', active: false, finishedAt: now, expiresAt: new Date(now.getTime() + RUN_RETENTION_MS), claimedBy: null, leaseExpiresAt: null },
          $push: { errorSummary: { $each: [{ code: 'QUALITY_RUN_ATTEMPTS_EXHAUSTED', message: 'Worker lease expired too many times', at: now }], $slice: -25 } } },
      );
    }
    const run = await CatalogQualityRun.findOneAndUpdate(
      { active: true, attempts: { $lt: RUN_MAX_ATTEMPTS }, $or: [{ status: 'queued' }, { status: 'running', leaseExpiresAt: { $lte: now } }] },
      { $set: { status: 'running', claimedBy: workerId, leaseExpiresAt: new Date(now.getTime() + RUN_LEASE_MS), lastHeartbeatAt: now }, $inc: { attempts: 1 } },
      { sort: { lastHeartbeatAt: 1, createdAt: 1 }, new: true },
    );
    if (run && !run.startedAt) await CatalogQualityRun.updateOne({ _id: run._id, startedAt: null }, { $set: { startedAt: now } });
    return run;
  }

  async processAvailableRuns({ workerId, maxRuns = 1 } = {}) {
    const owner = workerId || `quality-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    const results = [];
    for (let index = 0; index < maxRuns; index += 1) {
      // Claims are intentionally serial so maxRuns is an exact upper bound.
      // eslint-disable-next-line no-await-in-loop
      const run = await this.claimNextRun(owner);
      if (!run) break;
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.advanceRun(run, owner));
    }
    return results;
  }

  async nextMasterIds(run) {
    const filter = {
      tenantId: run.tenantId, isDeleted: { $ne: true }, createdAt: { $lte: run.sourceCutoff },
      ...(run.lastMasterId ? { productMasterId: { $gt: run.lastMasterId } } : {}),
    };
    const rows = await TenantProduct.find(filter).select('productMasterId').sort({ productMasterId: 1, _id: 1 }).limit(RUN_SCAN_SIZE).lean();
    const unique = new Map();
    for (const row of rows) {
      unique.set(String(row.productMasterId), row.productMasterId);
      if (unique.size >= RUN_BATCH_SIZE) break;
    }
    return [...unique.values()];
  }

  async advanceRun(run, workerId) {
    const current = await CatalogQualityRun.findById(run._id).select('status active');
    if (!current?.active) return this.publicRun(current);
    if (current.status === 'cancel_requested') return this.finishRun(run, 'cancelled');
    const masterIds = await this.nextMasterIds(run);
    if (!masterIds.length) return this.finishRun(run, 'completed');
    await this.evaluateBatch({ tenantId: run.tenantId, masterIds, qualityRunId: run._id });
    const lastMasterId = masterIds.at(-1);
    const updated = await CatalogQualityRun.findOneAndUpdate(
      { _id: run._id, active: true, status: 'running', claimedBy: workerId },
      { $set: { status: 'queued', lastMasterId, claimedBy: null, leaseExpiresAt: null, lastHeartbeatAt: new Date(), attempts: 0 }, $inc: { evaluated: masterIds.length, batches: 1 } },
      { new: true },
    );
    return this.publicRun(updated);
  }

  async finishRun(run, status) {
    const now = new Date();
    if (status === 'completed') {
      await CatalogQualityAssessment.deleteMany({ tenantId: run.tenantId, qualityRunId: { $ne: run._id } });
    }
    const updated = await CatalogQualityRun.findOneAndUpdate(
      { _id: run._id, active: true },
      { $set: { status, active: false, finishedAt: now, expiresAt: new Date(now.getTime() + RUN_RETENTION_MS), claimedBy: null, leaseExpiresAt: null } },
      { new: true },
    );
    return this.publicRun(updated);
  }

  async evaluateBatch({ tenantId, masterIds, qualityRunId }) {
    const [masters, listings, variants, images, attributes, variantAttributes, searchDocs, compliances, previous] = await Promise.all([
      ProductMaster.find({ _id: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      TenantProduct.find({ tenantId, productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductVariant.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductImage.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductAttributeValue.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductVariantAttributeValue.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      SearchDocument.find({ tenantId, masterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductCompliance.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      CatalogQualityAssessment.find({ tenantId, productMasterId: { $in: masterIds } }).lean(),
    ]);
    const categoryIds = [...new Set(masters.map((row) => row.categoryId).filter(Boolean).map(String))];
    const brandIds = [...new Set(masters.map((row) => row.brandId).filter(Boolean).map(String))];
    const [categories, brands, inventories] = await Promise.all([
      Category.find({ _id: { $in: categoryIds }, isDeleted: { $ne: true } }).lean(),
      Brand.find({ _id: { $in: brandIds }, isDeleted: { $ne: true } }).lean(),
      Inventory.find({ tenantId, tenantProductId: { $in: listings.map((row) => row._id) }, isDeleted: { $ne: true } }).lean(),
    ]);
    const byMaster = (rows, field = 'productMasterId') => {
      const map = new Map();
      for (const row of rows) mapPush(map, row[field], row);
      return map;
    };
    const maps = {
      listings: byMaster(listings), variants: byMaster(variants), images: byMaster(images),
      attributes: byMaster(attributes), variantAttributes: byMaster(variantAttributes), searchDocs: byMaster(searchDocs, 'masterId'),
      compliances: byMaster(compliances), inventories: byMaster(inventories, 'tenantProductId'),
    };
    const categoryMap = new Map(categories.map((row) => [String(row._id), row]));
    const brandMap = new Map(brands.map((row) => [String(row._id), row]));
    const previousMap = new Map(previous.map((row) => [String(row.productMasterId), row]));
    const now = new Date();
    const assessments = masters.map((master) => this.evaluateOne({
      tenantId, master, category: categoryMap.get(String(master.categoryId)) || null,
      brand: brandMap.get(String(master.brandId)) || null,
      listings: maps.listings.get(String(master._id)) || [], variants: maps.variants.get(String(master._id)) || [],
      images: maps.images.get(String(master._id)) || [], attributes: maps.attributes.get(String(master._id)) || [],
      variantAttributes: maps.variantAttributes.get(String(master._id)) || [], searchDocs: maps.searchDocs.get(String(master._id)) || [],
      compliances: maps.compliances.get(String(master._id)) || [],
      inventories: (maps.listings.get(String(master._id)) || []).flatMap((listing) => maps.inventories.get(String(listing._id)) || []),
      previousAssessment: previousMap.get(String(master._id)) || null, qualityRunId, now,
    }));
    if (assessments.length) {
      await CatalogQualityAssessment.bulkWrite(assessments.map((assessment) => ({
        updateOne: { filter: { tenantId, productMasterId: assessment.productMasterId }, update: { $set: assessment }, upsert: true },
      })), { ordered: false });
    }
    return assessments.length;
  }

  async summary({ tenantId }) {
    const [summaryRows, latestRun] = await Promise.all([
      CatalogQualityAssessment.aggregate([
        { $match: { tenantId } },
        { $unwind: { path: '$issues', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: null,
            products: { $addToSet: '$productMasterId' },
            scores: { $addToSet: { id: '$productMasterId', score: '$score', grade: '$grade', publishable: '$publishable', launchReady: '$launchReady', evaluatedAt: '$evaluatedAt' } },
            issueRows: { $push: '$issues' },
          },
        },
      ]),
      CatalogQualityRun.findOne({ tenantId }).sort({ createdAt: -1 }).lean(),
    ]);
    const summary = summaryRows[0];
    const scores = summary?.scores || [];
    const issueCounts = new Map();
    for (const row of summary?.issueRows || []) {
      if (!row?.code) continue;
      const current = issueCounts.get(row.code) || { code: row.code, label: row.label, severity: row.severity, owner: row.owner, count: 0 };
      current.count += 1; issueCounts.set(row.code, current);
    }
    const gradeCounts = Object.fromEntries(['A', 'B', 'C', 'D', 'F'].map((grade) => [grade, scores.filter((row) => row.grade === grade).length]));
    return {
      total: scores.length,
      averageScore: scores.length ? Math.round(scores.reduce((sum, row) => sum + row.score, 0) / scores.length) : 0,
      publishable: scores.filter((row) => row.publishable).length,
      launchReady: scores.filter((row) => row.launchReady).length,
      blocked: scores.filter((row) => !row.publishable).length,
      stale: scores.filter((row) => Date.now() - new Date(row.evaluatedAt).getTime() > ASSESSMENT_REFRESH_MS).length,
      grades: gradeCounts,
      topIssues: [...issueCounts.values()].sort((a, b) => b.count - a.count).slice(0, 12),
      lastEvaluatedAt: scores.length ? new Date(Math.max(...scores.map((row) => new Date(row.evaluatedAt).getTime()))) : null,
      latestRun: this.publicRun(latestRun),
    };
  }

  async list({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const filter = { tenantId };
    if (query.grade) filter.grade = query.grade;
    if (query.readiness === 'ready') filter.launchReady = true;
    if (query.readiness === 'blocked') filter.publishable = false;
    if (query.issueCode) filter['issues.code'] = query.issueCode;
    if (query.search) filter.$or = [
      { 'snapshot.title': literalRegex(query.search) }, { 'snapshot.skuGlobal': literalRegex(query.search) },
    ];
    const [items, total] = await Promise.all([
      CatalogQualityAssessment.find(filter).sort({ blockerCount: -1, score: 1, productMasterId: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      CatalogQualityAssessment.countDocuments(filter),
    ]);
    const now = Date.now();
    const withFreshness = items.map((row) => ({
      ...row,
      isStale: now - new Date(row.evaluatedAt).getTime() > ASSESSMENT_REFRESH_MS,
    }));
    return { items: withFreshness, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total } };
  }

  async detail({ tenantId, masterId }) {
    const row = await CatalogQualityAssessment.findOne({ tenantId, productMasterId: masterId }).lean();
    if (!row) throw notFound('Quality assessment not found; run an evaluation first', 'QUALITY_ASSESSMENT_NOT_FOUND');
    return {
      ...row,
      isStale: Date.now() - new Date(row.evaluatedAt).getTime() > ASSESSMENT_REFRESH_MS,
    };
  }
}

export default new CatalogQualityService();
