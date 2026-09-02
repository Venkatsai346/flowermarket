import Brand from '../models/brand.model.js';
import { notFound } from '../utils/ApiError.js';
import { uniqueSlug, assertSlugFree } from '../utils/slugify.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { BRAND_VERIFICATION_STATUS, ENTITY_STATUS } from '../constants/enums.js';

/**
 * BrandService — global brand registry (admin-owned).
 */
class BrandService {
  async create({ payload, actorId = null, req = null }) {
    const slug = payload.slug
      ? (await assertSlugFree(Brand, payload.slug)) && payload.slug
      : await uniqueSlug(Brand, payload.name);
    const brand = await Brand.create({ ...payload, slug });
    await auditService.record({
      action: 'create', entityType: 'brand', entityId: brand.id,
      actorId, actorType: 'admin', after: { name: brand.name, slug: brand.slug }, req,
    });
    await catalogEventService.publish({
      eventType: 'brand_updated', entityType: 'brand', entityId: brand.id,
      payload: { id: brand.id, name: brand.name, status: brand.status },
    });
    return brand;
  }

  async update({ id, patch, actorId = null, req = null }) {
    const brand = await Brand.findById(id);
    if (!brand) throw notFound('Brand not found', 'BRAND_NOT_FOUND');
    const before = { name: brand.name, status: brand.status };
    if (patch.slug) await assertSlugFree(Brand, patch.slug, {}, id);
    Object.assign(brand, patch);
    await brand.save();
    await auditService.record({
      action: 'update', entityType: 'brand', entityId: brand.id,
      actorId, actorType: 'admin', before, after: { name: brand.name, status: brand.status }, req,
    });
    await catalogEventService.publish({
      eventType: 'brand_updated', entityType: 'brand', entityId: brand.id,
      payload: { id: brand.id, name: brand.name, status: brand.status },
    });
    return brand;
  }

  /** Admin verify/unverify a brand (verified brands skip some approval steps). */
  async verify({ id, verified, note = null, actorId = null, req = null }) {
    const brand = await Brand.findById(id);
    if (!brand) throw notFound('Brand not found', 'BRAND_NOT_FOUND');
    const before = { verified: brand.verification.isVerified };
    brand.verification = {
      status: verified ? BRAND_VERIFICATION_STATUS.VERIFIED : BRAND_VERIFICATION_STATUS.REJECTED,
      isVerified: verified,
      verifiedAt: verified ? new Date() : brand.verification?.verifiedAt || null,
    };
    await brand.save();
    await auditService.record({
      action: 'verify', entityType: 'brand', entityId: brand.id,
      actorId, actorType: 'admin', before, after: { verified }, meta: { note }, req,
    });
    return brand;
  }

  async list({ status = null, verified = null, page = 1, limit = 50 } = {}) {
    const q = {};
    if (status) q.status = status;
    if (verified === true) q['verification.isVerified'] = true;
    if (verified === false) q['verification.isVerified'] = false;
    const docs = await Brand.find(q).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean();
    const total = await Brand.countDocuments(q);
    return { items: docs, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async getById(id) {
    const brand = await Brand.findById(id);
    if (!brand) throw notFound('Brand not found', 'BRAND_NOT_FOUND');
    return brand;
  }

  async remove({ id, actorId = null, req = null }) {
    const brand = await this.getById(id);
    brand.status = ENTITY_STATUS.INACTIVE;
    await brand.save();
    await auditService.record({
      action: 'delete', entityType: 'brand', entityId: brand.id,
      actorId, actorType: 'admin', before: { name: brand.name }, req,
    });
    return { deleted: true };
  }
}

export default new BrandService();
