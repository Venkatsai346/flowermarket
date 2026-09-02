import ProductMaster from '../models/productMaster.model.js';
import ProductVariant from '../models/productVariant.model.js';
import ProductImage from '../models/productImage.model.js';
import ProductAttributeValue from '../models/productAttributeValue.model.js';
import ProductChangeRequest from '../models/productChangeRequest.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import categoryService from './category.service.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { uniqueSlug, assertSlugFree } from '../utils/slugify.js';
import { updateWithVersion } from '../utils/catalog/optimisticLock.js';
import { pick } from '../utils/catalog/diff.js';
import { titleSimilarity, DUPLICATE_TITLE_THRESHOLD } from '../utils/catalog/similarity.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { AppError } from '../utils/ApiError.js';
import {
  PRODUCT_MASTER_STATUS,
  TENANT_LISTING_STATUS,
  ENTITY_STATUS,
} from '../constants/enums.js';

const GLOBAL_FIELDS = [
  'skuGlobal', 'type', 'title', 'slug', 'shortDescription', 'description',
  'categoryId', 'brandId', 'barcode', 'tags', 'isPerishable', 'requiresColdChain',
  'defaultSellingUnit', 'minOrderQty', 'maxOrderQty', 'complianceStatus',
];

/**
 * ProductMasterService — global product identity (owned by central catalog ops).
 *
 * KEY RULES (from the architecture doc):
 *  - Admin creates masters directly (ACTIVE). Tenants can only PROPOSE new
 *    masters; those start PENDING_REVIEW and need admin approval.
 *  - Duplicate detection: exact barcode/SKU -> hard 409; fuzzy title -> 409
 *    POSSIBLE_DUPLICATE with the existing master id.
 *  - Global-field updates are admin-only; tenant changes go through
 *    ProductChangeRequest (handled by changeRequest.service).
 *  - `version` optimistic locking on every mutation.
 */
class ProductMasterService {
  /** Precompute the search blob (title + desc + tags + category path + brand + attrs). */
  async buildSearchText(master) {
    const [category, brand, attrs] = await Promise.all([
      master.categoryId ? Category.findById(master.categoryId).lean() : null,
      master.brandId ? Brand.findById(master.brandId).lean() : null,
      ProductAttributeValue.find({ productMasterId: master._id }).lean(),
    ]);
    let categoryPath = category?.name || '';
    if (category?.parentId) {
      const parent = await Category.findById(category.parentId).lean();
      if (parent) categoryPath = `${parent.name} ${categoryPath}`;
    }
    const parts = [
      master.title,
      master.shortDescription,
      (master.tags || []).join(' '),
      categoryPath,
      brand?.name,
      attrs.map((a) => `${a.attributeKey} ${a.value} ${a.unit || ''}`).join(' '),
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  /** Throws on exact duplicates; returns a fuzzy-similar master if one exists. */
  async assertNoDuplicate({ skuGlobal, title, barcode, excludeId = null }) {
    const ex = excludeId ? { _id: { $ne: excludeId } } : {};
    if (barcode) {
      const byBarcode = await ProductMaster.findOne({ barcode, ...ex });
      if (byBarcode) {
        throw new AppError(`Barcode ${barcode} already exists on "${byBarcode.title}"`, {
          status: 409, code: 'DUPLICATE_BARCODE', details: { existingId: byBarcode.id, existingTitle: byBarcode.title },
        });
      }
    }
    const bySku = await ProductMaster.findOne({ skuGlobal, ...ex });
    if (bySku) {
      throw new AppError(`SKU ${skuGlobal} already exists`, {
        status: 409, code: 'DUPLICATE_SKU', details: { existingId: bySku.id },
      });
    }
    const rx = new RegExp(title.split(/\s+/).slice(0, 3).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
    const candidates = await ProductMaster.find({
      status: { $in: [PRODUCT_MASTER_STATUS.ACTIVE, PRODUCT_MASTER_STATUS.PENDING_REVIEW] },
      title: { $regex: rx },
      ...ex,
    }).limit(10).lean();
    for (const c of candidates) {
      if (titleSimilarity(c.title, title) >= DUPLICATE_TITLE_THRESHOLD) return c;
    }
    return null;
  }

  /** Create a master (admin: ACTIVE; tenant proposal: PENDING_REVIEW). */
  async createMaster({ payload, actorId = null, status = PRODUCT_MASTER_STATUS.ACTIVE, req = null }) {
    await categoryService.getById(payload.categoryId);
    const { ok, errors } = await categoryService.validateAttributes(payload.categoryId, payload.attributes || []);
    if (!ok) throw badRequest('Category attribute validation failed', 'CATEGORY_ATTRIBUTE_ERROR', errors);

    const similar = await this.assertNoDuplicate({
      skuGlobal: payload.skuGlobal, title: payload.title, barcode: payload.barcode,
    });
    if (similar) {
      throw new AppError(`Possible duplicate of "${similar.title}"`, {
        status: 409, code: 'POSSIBLE_DUPLICATE', details: { existingId: similar.id, existingTitle: similar.title },
      });
    }

    const slug = payload.slug || (await uniqueSlug(ProductMaster, payload.title));
    if (payload.slug) await assertSlugFree(ProductMaster, payload.slug);

    const master = await ProductMaster.create({
      ...pick(payload, GLOBAL_FIELDS),
      slug,
      status,
      review: { submittedAt: new Date() },
      createdBy: actorId,
    });

    await this.syncMasterExtras(master, payload);
    master.searchText = await this.buildSearchText(master);
    await master.save();

    await auditService.record({
      action: 'create', entityType: 'product_master', entityId: master.id,
      actorId, actorType: actorId ? 'admin' : 'system',
      after: { sku: master.skuGlobal, title: master.title, status: master.status }, req,
    });
    if (master.status === PRODUCT_MASTER_STATUS.ACTIVE) {
      await catalogEventService.publish({
        eventType: 'product_created', entityType: 'product_master', entityId: master.id,
        payload: { id: master.id, sku: master.skuGlobal, title: master.title },
      });
    }
    return master;
  }

  /** Tenant proposes a brand-new global SKU -> master PENDING_REVIEW + change request. */
  async proposeMaster({ payload, tenantId, actorId = null, req = null }) {
    const master = await this.createMaster({
      payload, actorId, status: PRODUCT_MASTER_STATUS.PENDING_REVIEW, req,
    });
    const changeRequest = await ProductChangeRequest.create({
      type: 'create_master',
      tenantId,
      productMasterId: master.id,
      requestedBy: actorId,
      payload: pick(payload, GLOBAL_FIELDS),
      note: payload.note || null,
      status: 'pending',
    });
    await auditService.record({
      action: 'create', entityType: 'product_change_request', entityId: changeRequest.id,
      tenantId, actorId, actorType: 'tenant',
      after: { type: changeRequest.type, masterId: master.id, status: changeRequest.status }, req,
    });
    return { master, changeRequest };
  }

  /** Admin decision on a proposed (PENDING_REVIEW) master. */
  async reviewCreateMaster({ masterId, decision, actorId = null, note = null, req = null }) {
    const master = await ProductMaster.findById(masterId);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    if (master.status !== PRODUCT_MASTER_STATUS.PENDING_REVIEW) {
      throw conflict('Master is not pending review', 'NOT_PENDING_REVIEW');
    }
    if (decision === 'approve') {
      master.status = PRODUCT_MASTER_STATUS.ACTIVE;
      master.review = { ...master.review, reviewedBy: actorId, reviewedAt: new Date(), note };
      master.version += 1; // any mutation bumps version (stale clients fail fast)
      await master.save();
      await auditService.record({
        action: 'approve', entityType: 'product_master', entityId: master.id,
        actorId, actorType: 'admin', after: { status: master.status }, meta: { note }, req,
      });
      await catalogEventService.publish({
        eventType: 'product_created', entityType: 'product_master', entityId: master.id,
        payload: { id: master.id, sku: master.skuGlobal, title: master.title },
      });
      return master;
    }
    master.status = PRODUCT_MASTER_STATUS.REJECTED;
    master.review = { ...master.review, reviewedBy: actorId, reviewedAt: new Date(), note };
    await master.save();
    await auditService.record({
      action: 'reject', entityType: 'product_master', entityId: master.id,
      actorId, actorType: 'admin', after: { status: master.status }, meta: { note }, req,
    });
    return master;
  }

  /** Admin direct update of global fields (optimistic-locked). */
  async updateGlobalFields({ id, patch, expectedVersion, actorId = null, req = null }) {
    const master = await ProductMaster.findById(id);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');

    if (patch.categoryId && String(patch.categoryId) !== String(master.categoryId || '')) {
      const currentAttrs = await ProductAttributeValue.find({ productMasterId: master.id }).lean();
      const { ok, errors } = await categoryService.validateAttributes(
        patch.categoryId,
        currentAttrs.map((a) => ({ key: a.attributeKey, value: a.value }))
      );
      if (!ok) throw badRequest('Category attribute validation failed', 'CATEGORY_ATTRIBUTE_ERROR', errors);
    }

    const similar = await this.assertNoDuplicate({
      skuGlobal: master.skuGlobal,
      title: patch.title ?? master.title,
      barcode: patch.barcode ?? master.barcode,
      excludeId: master.id,
    });
    if (similar) {
      throw new AppError(`Possible duplicate of "${similar.title}"`, {
        status: 409, code: 'POSSIBLE_DUPLICATE', details: { existingId: similar.id, existingTitle: similar.title },
      });
    }

    const before = pick(master.toObject(), Object.keys(patch));
    await updateWithVersion(master, expectedVersion, patch);
    master.searchText = await this.buildSearchText(master);
    await master.save();

    await auditService.record({
      action: 'update', entityType: 'product_master', entityId: master.id,
      actorId, actorType: 'admin', before, after: pick(master.toObject(), Object.keys(patch)), req,
    });
    await catalogEventService.publish({
      eventType: 'product_master_updated', entityType: 'product_master', entityId: master.id,
      payload: { id: master.id, title: master.title, version: master.version },
    });
    return this.getMaster(master.id);
  }

  /** Apply an approved change-request diff (bypasses optimistic check by design). */
  async applyGlobalPatch(master, patch, { actorId = null, note = null, req = null } = {}) {
    master.set(patch);
    master.version = (master.version || 1) + 1;
    master.searchText = await this.buildSearchText(master);
    await master.save();
    await auditService.record({
      action: 'update', entityType: 'product_master', entityId: master.id,
      actorId, actorType: 'admin', before: pick(master.toObject({ depopulate: true }), Object.keys(patch)),
      after: patch, meta: { note, via: 'change_request' }, req,
    });
    await catalogEventService.publish({
      eventType: 'product_master_updated', entityType: 'product_master', entityId: master.id,
      payload: { id: master.id, title: master.title, version: master.version },
    });
  }

  /** Create variants/images/attributes for a new master from the create payload. */
  async syncMasterExtras(master, payload) {
    if (payload.variants?.length) {
      const docs = payload.variants.map((v, i) => ({
        productMasterId: master.id,
        variantType: v.variantType,
        value: v.value,
        displayLabel: v.displayLabel || null,
        sku: v.sku || null,
        sortOrder: v.sortOrder ?? i,
        isDefault: v.isDefault || false,
        status: ENTITY_STATUS.ACTIVE,
      }));
      await ProductVariant.insertMany(docs);
      const defaultIdx = payload.variants.findIndex((v) => v.isDefault);
      if (defaultIdx >= 0) {
        const def = await ProductVariant.findOne({ productMasterId: master.id, value: payload.variants[defaultIdx].value });
        if (def) {
          await ProductVariant.updateMany(
            { productMasterId: master.id, _id: { $ne: def.id } },
            { $set: { isDefault: false } }
          );
        }
      }
    }
    if (payload.images?.length) {
      await ProductImage.insertMany(
        payload.images.map((img, i) => ({
          productMasterId: master.id,
          url: img.url,
          altText: img.altText || null,
          isPrimary: img.isPrimary || false,
          sortOrder: img.sortOrder ?? i,
          uploadedBy: master.createdBy,
          status: ENTITY_STATUS.ACTIVE,
        }))
      );
      const primaryIdx = payload.images.findIndex((img) => img.isPrimary);
      if (primaryIdx >= 0) {
        await ProductImage.updateMany(
          { productMasterId: master.id, isPrimary: true },
          { $set: { isPrimary: false } }
        );
        const primary = await ProductImage.findOne({ productMasterId: master.id, url: payload.images[primaryIdx].url });
        if (primary) {
          primary.isPrimary = true;
          await primary.save();
        }
      }
    }
    if (payload.attributes?.length) {
      await ProductAttributeValue.insertMany(
        payload.attributes.map((a, i) => ({
          productMasterId: master.id,
          attributeKey: a.key,
          value: a.value,
          unit: a.unit || null,
          sortOrder: i,
        }))
      );
    }
  }

  /** Admin deprecates a master globally; cascades tenant listings to INACTIVE. */
  async deprecate({ id, actorId = null, note = null, req = null }) {
    const master = await ProductMaster.findById(id);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    if (master.status === PRODUCT_MASTER_STATUS.DEPRECATED) {
      throw conflict('Master is already deprecated', 'ALREADY_DEPRECATED');
    }
    master.status = PRODUCT_MASTER_STATUS.DEPRECATED;
    master.review = { ...master.review, reviewedBy: actorId, reviewedAt: new Date(), note };
    master.version += 1;
    await master.save();

    await TenantProduct.updateMany(
      { productMasterId: master.id, status: { $ne: TENANT_LISTING_STATUS.INACTIVE } },
      { $set: { status: TENANT_LISTING_STATUS.INACTIVE, lastStatusChangedAt: new Date() } }
    );

    await auditService.record({
      action: 'deprecate', entityType: 'product_master', entityId: master.id,
      actorId, actorType: 'admin', after: { status: master.status }, meta: { note, cascadedListings: true }, req,
    });
    await catalogEventService.publish({
      eventType: 'product_deactivated', entityType: 'product_master', entityId: master.id,
      payload: { id: master.id, status: master.status },
    });
    return master;
  }

  // ---------------- sub-resources (variants / images / attributes) ----------------

  async addVariant({ id, payload, expectedVersion, actorId = null, viaRequest = false, req = null }) {
    const master = await ProductMaster.findById(id);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    if (!viaRequest) await updateWithVersion(master, expectedVersion, {});
    const variant = await ProductVariant.create({
      productMasterId: master.id, ...payload, status: ENTITY_STATUS.ACTIVE,
    });
    if (payload.isDefault) {
      await ProductVariant.updateMany(
        { productMasterId: master.id, _id: { $ne: variant.id } },
        { $set: { isDefault: false } }
      );
    }
    await auditService.record({
      action: 'create', entityType: 'product_variant', entityId: variant.id,
      actorId, actorType: viaRequest ? 'admin' : 'admin',
      after: { masterId: master.id, value: variant.value }, meta: { via: viaRequest ? 'change_request' : 'direct' }, req,
    });
    return variant;
  }

  async removeVariant({ masterId, variantId, expectedVersion, actorId = null, req = null }) {
    const master = await ProductMaster.findById(masterId);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    await updateWithVersion(master, expectedVersion, {});
    const variant = await ProductVariant.findById(variantId);
    if (!variant) throw notFound('Variant not found', 'VARIANT_NOT_FOUND');
    await variant.softDelete();
    await auditService.record({
      action: 'delete', entityType: 'product_variant', entityId: variant.id,
      actorId, actorType: 'admin', before: { value: variant.value }, req,
    });
    return { deleted: true };
  }

  async addImage({ id, payload, expectedVersion, actorId = null, viaRequest = false, req = null }) {
    const master = await ProductMaster.findById(id);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    if (!viaRequest) await updateWithVersion(master, expectedVersion, {});
    const image = await ProductImage.create({
      productMasterId: master.id, ...payload, status: ENTITY_STATUS.ACTIVE, uploadedBy: actorId,
    });
    if (payload.isPrimary) {
      await ProductImage.updateMany(
        { productMasterId: master.id, _id: { $ne: image.id } },
        { $set: { isPrimary: false } }
      );
    }
    await auditService.record({
      action: 'create', entityType: 'product_image', entityId: image.id,
      actorId, actorType: 'admin', after: { masterId: master.id, url: image.url }, req,
    });
    return image;
  }

  async setImagePrimary({ masterId, imageId, expectedVersion, actorId = null, req = null }) {
    const master = await ProductMaster.findById(masterId);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    await updateWithVersion(master, expectedVersion, {});
    const image = await ProductImage.findById(imageId);
    if (!image) throw notFound('Image not found', 'IMAGE_NOT_FOUND');
    await ProductImage.updateMany({ productMasterId: masterId }, { $set: { isPrimary: false } });
    image.isPrimary = true;
    await image.save();
    return image;
  }

  async removeImage({ masterId, imageId, expectedVersion, actorId = null, req = null }) {
    const master = await ProductMaster.findById(masterId);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    await updateWithVersion(master, expectedVersion, {});
    const image = await ProductImage.findById(imageId);
    if (!image) throw notFound('Image not found', 'IMAGE_NOT_FOUND');
    await image.softDelete();
    return { deleted: true };
  }

  /** Replace the EAV attribute set (validated against category schema). */
  async setAttributes({ id, attributes, expectedVersion, actorId = null, viaRequest = false, req = null }) {
    const master = await ProductMaster.findById(id);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    const { ok, errors } = await categoryService.validateAttributes(master.categoryId, attributes || []);
    if (!ok) throw badRequest('Category attribute validation failed', 'CATEGORY_ATTRIBUTE_ERROR', errors);
    if (!viaRequest) await updateWithVersion(master, expectedVersion, {});

    await ProductAttributeValue.deleteMany({ productMasterId: master.id });
    if (attributes?.length) {
      await ProductAttributeValue.insertMany(
        attributes.map((a, i) => ({
          productMasterId: master.id, attributeKey: a.key, value: a.value, unit: a.unit || null, sortOrder: i,
        }))
      );
    }
    master.searchText = await this.buildSearchText(master);
    await master.save();

    await auditService.record({
      action: 'update', entityType: 'product_attribute', entityId: master.id,
      actorId, actorType: 'admin', after: { attributes }, req,
    });
    await catalogEventService.publish({
      eventType: 'product_master_updated', entityType: 'product_master', entityId: master.id,
      payload: { id: master.id, version: master.version },
    });
    return this.getMaster(master.id);
  }

  // ---------------- reads ----------------

  async getMaster(id) {
    const master = await ProductMaster.findById(id);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    const [variants, images, attributes, category, brand] = await Promise.all([
      ProductVariant.find({ productMasterId: id, status: ENTITY_STATUS.ACTIVE }).sort({ sortOrder: 1 }).lean(),
      ProductImage.find({ productMasterId: id, status: ENTITY_STATUS.ACTIVE }).sort({ isPrimary: -1, sortOrder: 1 }).lean(),
      ProductAttributeValue.find({ productMasterId: id }).sort({ sortOrder: 1 }).lean(),
      master.categoryId ? Category.findById(master.categoryId).lean() : null,
      master.brandId ? Brand.findById(master.brandId).lean() : null,
    ]);
    const doc = master.toObject();
    doc.variants = variants;
    doc.images = images;
    doc.attributes = attributes.map((a) => ({ key: a.attributeKey, value: a.value, unit: a.unit }));
    doc.category = category ? { id: category._id, name: category.name, slug: category.slug } : null;
    doc.brand = brand ? { id: brand._id, name: brand.name, slug: brand.slug } : null;
    return doc;
  }

  async listMasters({ query = {} } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (query.status) q.status = query.status;
    if (query.categoryId) q.categoryId = query.categoryId;
    if (query.brandId) q.brandId = query.brandId;
    if (query.type) q.type = query.type;
    if (query.search) {
      q.$or = [
        { title: new RegExp(query.search, 'i') },
        { skuGlobal: new RegExp(query.search, 'i') },
        { searchText: new RegExp(query.search, 'i') },
      ];
    }
    const sort = { [query.sortBy === 'createdAt' ? 'createdAt' : 'createdAt']: query.sortOrder === 'asc' ? 1 : -1 };
    const [docs, total] = await Promise.all([
      ProductMaster.find(q).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      ProductMaster.countDocuments(q),
    ]);
    return { items: docs, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }
}

export default new ProductMasterService();
