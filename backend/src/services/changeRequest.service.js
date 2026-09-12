import ProductChangeRequest from '../models/productChangeRequest.model.js';
import ProductMaster from '../models/productMaster.model.js';
import ProductVariant from '../models/productVariant.model.js';
import ProductImage from '../models/productImage.model.js';
import ProductAttributeValue from '../models/productAttributeValue.model.js';
import productMasterService from './productMaster.service.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { CHANGE_REQUEST_STATUS, CHANGE_REQUEST_TYPE, PRODUCT_MASTER_STATUS } from '../constants/enums.js';
import {
  assertChangeRequestPlan,
  assertReviewable,
  assertCancellable,
  assertRevisable,
  assertMasterListable,
} from '../utils/catalogGuards.js';

/**
 * ChangeRequestService — the field-ownership approval workflow.
 *
 * Flow: tenant submits request (PENDING) -> admin approves (applies diff) /
 * rejects (reason) / needs_changes (tenant revises & resubmits).
 * Tenants may CANCELL their own pending requests.
 */
class ChangeRequestService {
  /**
   * Submit a change request on behalf of a tenant.
   *
   * Paid plans only (Pro/Business → 402 otherwise): free tenants manage
   * listings, catalog citizenship — proposing SKUs, spending review-queue
   * time — is a paid feature. Unknown plan codes fail safe to free, i.e.
   * gated (fail CLOSED for a paid feature). Non-create types also fail fast
   * on a dead target instead of queueing a request that can never apply.
   */
  async submit({ type, tenantId, actorId, productMasterId = null, payload = null, diff = null, note = null, req = null }) {
    if (!Object.values(CHANGE_REQUEST_TYPE).includes(type)) {
      throw badRequest('Invalid change request type', 'INVALID_REQUEST_TYPE');
    }
    const { default: entitlementService } = await import('./entitlement.service.js');
    const { code: planCode } = await entitlementService.planForTenant(tenantId);
    assertChangeRequestPlan({ planCode });

    if (type === CHANGE_REQUEST_TYPE.CREATE_MASTER) {
      if (!payload?.title) throw badRequest('payload.title is required for create_master', 'PAYLOAD_INVALID');
    } else {
      if (!productMasterId) throw badRequest('productMasterId is required', 'PRODUCT_MASTER_REQUIRED');
      const master = await ProductMaster.findById(productMasterId).select('status').lean();
      if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
      if (type === CHANGE_REQUEST_TYPE.DEACTIVATE_MASTER) {
        if (master.status !== PRODUCT_MASTER_STATUS.ACTIVE) {
          throw badRequest('Only an active master can be deactivated', 'MASTER_NOT_ACTIVE');
        }
      } else {
        assertMasterListable(master);
      }
    }

    const cr = await ProductChangeRequest.create({
      type,
      tenantId,
      productMasterId: productMasterId || null,
      requestedBy: actorId,
      payload,
      diff,
      note,
      status: CHANGE_REQUEST_STATUS.PENDING,
    });

    await auditService.record({
      action: 'create', entityType: 'product_change_request', entityId: cr.id,
      tenantId, actorId, actorType: 'tenant',
      after: { type: cr.type, status: cr.status }, req,
    });
    return cr;
  }

  /**
   * Admin review decision. On APPROVE, applies the request to the master.
   *
   * Race-proof in both directions:
   * - CLAIM: PENDING → <decision> is ONE guarded update. Two admins acting
   *   together cannot both win — the loser re-reads a non-pending row and
   *   gets 409 REQUEST_ALREADY_REVIEWED instead of double-applying (which
   *   would duplicate variants/images on the master).
   * - REVERT: if the apply throws (target deleted or moved mid-flight), the
   *   claim rolls back to PENDING with the failure recorded — retryable and
   *   honest, instead of stranded as approved-but-unapplied (a lie the queue
   *   cannot see, since nothing ever re-runs applies).
   */
  async review({ requestId, decision, actorId = null, note = null, req = null }) {
    if (!['approve', 'reject', 'needs_changes'].includes(decision)) {
      throw badRequest('Invalid decision', 'INVALID_DECISION');
    }
    const toStatus = {
      approve: CHANGE_REQUEST_STATUS.APPROVED,
      reject: CHANGE_REQUEST_STATUS.REJECTED,
      needs_changes: CHANGE_REQUEST_STATUS.NEEDS_CHANGES,
    }[decision];

    const cr = await ProductChangeRequest.findOneAndUpdate(
      { _id: requestId, status: CHANGE_REQUEST_STATUS.PENDING },
      { $set: { status: toStatus, review: { reviewedBy: actorId, reviewedAt: new Date(), note: note || null } } },
      { new: true }
    );
    if (!cr) {
      const current = await ProductChangeRequest.findById(requestId).select('status').lean();
      assertReviewable(current); // throws NOT_FOUND or ALREADY_REVIEWED with the exact status
    }

    await auditService.record({
      action: decision === 'approve' ? 'approve' : 'reject', entityType: 'product_change_request', entityId: cr.id,
      tenantId: cr.tenantId, actorId, actorType: 'admin',
      before: { status: 'pending' }, after: { status: cr.status }, meta: { note, type: cr.type }, req,
    });

    if (decision === 'approve') {
      try {
        await this.applyRequest(cr, { actorId, req });
      } catch (err) {
        await ProductChangeRequest.updateOne(
          { _id: cr._id, status: CHANGE_REQUEST_STATUS.APPROVED },
          {
            $set: { status: CHANGE_REQUEST_STATUS.PENDING, lastApplyError: { message: err?.message || String(err), at: new Date() } },
            $inc: { applyAttempts: 1 },
          }
        );
        await auditService.record({
          action: 'change_request_apply_failed', entityType: 'product_change_request', entityId: cr.id,
          tenantId: cr.tenantId, actorId, actorType: 'admin',
          before: { status: 'approved' }, after: { status: 'pending' },
          meta: { error: err?.message || String(err), code: err?.code || null }, req,
        });
        throw err;
      }
    }

    await catalogEventService.publish({
      eventType: 'change_request_reviewed', entityType: 'product_change_request', entityId: cr.id,
      tenantId: cr.tenantId, payload: { id: cr.id, decision, status: cr.status, type: cr.type },
    });
    return cr;
  }

  /**
   * Tenant cancels their own pending request. Guarded claim: a cancel racing
   * an admin review cannot silently win — the loser re-derives the exact
   * cause (already reviewed) instead of resurrecting or duplicating work.
   */
  async cancel({ requestId, tenantId, actorId = null, req = null }) {
    const current = await ProductChangeRequest.findById(requestId).select('status tenantId').lean();
    assertCancellable({ cr: current, tenantId });
    const cr = await ProductChangeRequest.findOneAndUpdate(
      { _id: requestId, tenantId, status: CHANGE_REQUEST_STATUS.PENDING },
      { $set: { status: CHANGE_REQUEST_STATUS.CANCELLED } },
      { new: true }
    );
    if (!cr) {
      const reread = await ProductChangeRequest.findById(requestId).select('status tenantId').lean();
      assertCancellable({ cr: reread, tenantId });
    }
    await auditService.record({
      action: 'update', entityType: 'product_change_request', entityId: cr.id,
      tenantId, actorId, actorType: 'tenant',
      before: { status: 'pending' }, after: { status: cr.status }, req,
    });
    return cr;
  }

  /**
   * Tenant revises a NEEDS_CHANGES request (updates payload/diff, back to
   * PENDING). Same guarded-claim discipline as cancel; grandfathered for any
   * plan — lifecycle on an already-filed request is never paywalled.
   */
  async revise({ requestId, tenantId, actorId = null, payload = null, diff = null, note = null, req = null }) {
    const current = await ProductChangeRequest.findById(requestId).select('status tenantId').lean();
    assertRevisable({ cr: current, tenantId });
    const $set = { status: CHANGE_REQUEST_STATUS.PENDING, review: {} };
    if (payload) $set.payload = payload;
    if (diff) $set.diff = diff;
    if (note) $set.note = note;
    const cr = await ProductChangeRequest.findOneAndUpdate(
      { _id: requestId, tenantId, status: CHANGE_REQUEST_STATUS.NEEDS_CHANGES },
      { $set },
      { new: true }
    );
    if (!cr) {
      const reread = await ProductChangeRequest.findById(requestId).select('status tenantId').lean();
      assertRevisable({ cr: reread, tenantId });
    }
    await auditService.record({
      action: 'update', entityType: 'product_change_request', entityId: cr.id,
      tenantId, actorId, actorType: 'tenant',
      before: { status: 'needs_changes' }, after: { status: cr.status }, req,
    });
    return cr;
  }

  async list({ tenantId = null, query = {}, isAdmin = false } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (!isAdmin) q.tenantId = tenantId;
    if (query.status) q.status = query.status;
    if (query.type) q.type = query.type;
    if (isAdmin && query.tenantId) q.tenantId = query.tenantId;
    const [docs, total] = await Promise.all([
      ProductChangeRequest.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ProductChangeRequest.countDocuments(q),
    ]);
    return { items: docs, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  // ---------------- apply approved requests ----------------

  async applyRequest(cr, { actorId = null, req = null } = {}) {
    // Re-verify the target at apply time: the master may have been deprecated
    // or deleted while the request sat in the queue. A throw here drives the
    // review() revert (back to PENDING, attempt recorded) instead of patching
    // a dead master or stranding an approved-but-unapplied request.
    if (cr.type !== CHANGE_REQUEST_TYPE.CREATE_MASTER) {
      const master = await ProductMaster.findById(cr.productMasterId).select('status').lean();
      assertMasterListable(master);
    }
    switch (cr.type) {
      case CHANGE_REQUEST_TYPE.CREATE_MASTER: {
        await productMasterService.reviewCreateMaster({
          masterId: cr.productMasterId, decision: 'approve', actorId, note: cr.review?.note, req,
        });
        break;
      }
      case CHANGE_REQUEST_TYPE.UPDATE_GLOBAL_FIELDS: {
        const master = await ProductMaster.findById(cr.productMasterId);
        if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
        await productMasterService.applyGlobalPatch(master, cr.diff?.after || {}, { actorId, note: cr.review?.note, req });
        break;
      }
      case CHANGE_REQUEST_TYPE.UPDATE_ATTRIBUTES: {
        await productMasterService.setAttributes({
          id: cr.productMasterId, attributes: cr.payload?.attributes || [], viaRequest: true, actorId, req,
        });
        break;
      }
      case CHANGE_REQUEST_TYPE.UPDATE_IMAGES: {
        for (const img of cr.payload?.images || []) {
          await productMasterService.addImage({
            id: cr.productMasterId, payload: img, viaRequest: true, actorId, req,
          });
        }
        break;
      }
      case CHANGE_REQUEST_TYPE.ADD_VARIANT: {
        await productMasterService.addVariant({
          id: cr.productMasterId, payload: cr.payload?.variant || {}, viaRequest: true, actorId, req,
        });
        break;
      }
      case CHANGE_REQUEST_TYPE.DEACTIVATE_MASTER: {
        await productMasterService.deprecate({ id: cr.productMasterId, actorId, note: cr.review?.note, req });
        break;
      }
      default:
        throw badRequest(`Unhandled request type: ${cr.type}`, 'UNHANDLED_REQUEST_TYPE');
    }
  }
}

export default new ChangeRequestService();
