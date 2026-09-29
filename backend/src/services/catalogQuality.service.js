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
import CatalogQualityAssessment from '../models/catalogQualityAssessment.model.js';
import { literalRegex } from '../utils/regex.js';
import { badRequest, notFound } from '../utils/ApiError.js';

const DIMENSIONS = Object.freeze({
  identity: ['Identity', 15], taxonomy: ['Taxonomy & specifications', 20], variants: ['Variants', 15],
  media: ['Media', 20], content: ['Content & SEO', 10], commerce: ['Commerce readiness', 15], search: ['Search freshness', 5],
});
const ASSESSMENT_REFRESH_MS = 24 * 60 * 60 * 1000;
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
  evaluateOne({ tenantId, master, category, brand, listings, variants, images, attributes, variantAttributes, searchDocs, now }) {
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
    if (storefrontListings.some((row) => Number(row.stockQty) > 0 || row.sellingPolicy?.allowBackorder)) commerce += 3; else add('INVENTORY_UNAVAILABLE', 'warning', 'inventory', 'No allocatable stock', 'All storefront offers are out of stock and backorder is disabled.', 'Receive inventory or configure an intentional backorder policy.');
    if (listings.every((row) => Number(row.priceBasis?.quantity) > 0 && truthyText(row.priceBasis?.unitCode))) commerce += 2; else add('LISTING_PRICE_BASIS_INVALID', 'blocker', 'listing', 'Quantity identity incomplete', 'A listing is missing its price-basis quantity or unit.', 'Repair listing quantity identity.', 'priceBasis');
    if (master.status !== 'active') add('MASTER_NOT_ACTIVE', 'blocker', 'master', 'Master is not active', `Master status is ${master.status || 'unknown'}.`, 'Complete review and activate the global master.', 'status');
    if (master.complianceStatus === 'pending') add('COMPLIANCE_PENDING', 'blocker', 'master', 'Compliance pending', 'Required compliance evidence has not been approved.', 'Complete compliance verification.', 'complianceStatus');
    scores.commerce = commerce;

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

    const dimensions = Object.entries(DIMENSIONS).map(([code, [label, maxScore]]) => ({
      code, label, score: Math.min(maxScore, scores[code] || 0), maxScore,
      percent: Math.round((Math.min(maxScore, scores[code] || 0) / maxScore) * 100),
    }));
    const score = Math.max(0, Math.min(100, dimensions.reduce((sum, row) => sum + row.score, 0)));
    const blockerCount = issues.filter((row) => row.severity === 'blocker').length;
    const warningCount = issues.filter((row) => row.severity === 'warning').length;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
      master: [String(master._id), master.version, master.updatedAt],
      listings: listings.map((row) => [String(row._id), row.version, row.updatedAt]),
      variants: variants.map((row) => [String(row._id), row.updatedAt, row.status]),
      images: images.map((row) => [String(row._id), row.updatedAt, row.status]),
      attributes: [...attributes, ...variantAttributes].map((row) => [String(row._id), row.updatedAt]),
    })).digest('hex');

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
      dimensions, issues: issues.slice(0, 100), blockerCount, warningCount,
      sourceFingerprint: fingerprint, evaluatedAt: now,
    };
  }

  async evaluateTenant({ tenantId }) {
    const listings = await TenantProduct.find({ tenantId, isDeleted: { $ne: true } }).lean();
    if (listings.length > 50_000) throw badRequest('Tenant catalog exceeds synchronous quality sweep limit', 'QUALITY_SWEEP_TOO_LARGE');
    const masterIds = [...new Set(listings.map((row) => String(row.productMasterId)))];
    if (!masterIds.length) {
      await CatalogQualityAssessment.deleteMany({ tenantId });
      return { evaluated: 0, ready: 0, blocked: 0, averageScore: 0 };
    }
    const [masters, variants, images, attributes, variantAttributes, categories, brands, searchDocs] = await Promise.all([
      ProductMaster.find({ _id: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductVariant.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductImage.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductAttributeValue.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      ProductVariantAttributeValue.find({ productMasterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
      Category.find({ _id: { $in: masterIds.length ? await ProductMaster.distinct('categoryId', { _id: { $in: masterIds } }) : [] } }).lean(),
      Brand.find({ _id: { $in: masterIds.length ? await ProductMaster.distinct('brandId', { _id: { $in: masterIds } }) : [] } }).lean(),
      SearchDocument.find({ tenantId, masterId: { $in: masterIds }, isDeleted: { $ne: true } }).lean(),
    ]);
    const byMaster = (rows, field = 'productMasterId') => {
      const map = new Map();
      for (const row of rows) mapPush(map, row[field], row);
      return map;
    };
    const listingMap = byMaster(listings);
    const variantMap = byMaster(variants);
    const imageMap = byMaster(images);
    const attributeMap = byMaster(attributes);
    const variantAttributeMap = byMaster(variantAttributes);
    const searchMap = byMaster(searchDocs, 'masterId');
    const categoryMap = new Map(categories.map((row) => [String(row._id), row]));
    const brandMap = new Map(brands.map((row) => [String(row._id), row]));
    const now = new Date();
    const assessments = masters.map((master) => this.evaluateOne({
      tenantId, master,
      category: categoryMap.get(String(master.categoryId)) || null,
      brand: brandMap.get(String(master.brandId)) || null,
      listings: listingMap.get(String(master._id)) || [], variants: variantMap.get(String(master._id)) || [],
      images: imageMap.get(String(master._id)) || [], attributes: attributeMap.get(String(master._id)) || [],
      variantAttributes: variantAttributeMap.get(String(master._id)) || [], searchDocs: searchMap.get(String(master._id)) || [], now,
    }));
    if (assessments.length) {
      await CatalogQualityAssessment.bulkWrite(assessments.map((assessment) => ({
        updateOne: {
          filter: { tenantId, productMasterId: assessment.productMasterId },
          update: { $set: assessment }, upsert: true,
        },
      })), { ordered: false });
    }
    await CatalogQualityAssessment.deleteMany({ tenantId, productMasterId: { $nin: masters.map((row) => row._id) } });
    const ready = assessments.filter((row) => row.launchReady).length;
    const averageScore = assessments.length ? Math.round(assessments.reduce((sum, row) => sum + row.score, 0) / assessments.length) : 0;
    return { evaluated: assessments.length, ready, blocked: assessments.filter((row) => !row.publishable).length, averageScore };
  }

  async summary({ tenantId }) {
    const [summary] = await CatalogQualityAssessment.aggregate([
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
    ]);
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
