import ProductChangeRequest from '../models/productChangeRequest.model.js';
import ProductMaster from '../models/productMaster.model.js';
import productMasterService from './productMaster.service.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { badRequest, notFound, conflict, forbidden } from '../utils/ApiError.js';
import {
  CHANGE_REQUEST_STATUS,
  CHANGE_REQUEST_TYPE,
  VARIANT_TYPE,
} from '../constants/enums.js';

/**
 * ChangeRequestService — the field-ownership approval workflow.
 *
 * Flow: tenant submits request (PENDING) -> admin approves (applies diff) /
 * rejects (reason) / needs_changes (tenant revises & resubmit).
 * Tenants may CANCEL their own pending requests.
 *
 * REVIEW SAFETY (the two failure modes this workflow must never have):
 *   1. DOUBLE APPLY — two admins click Approve concurrently (or a webhook
 *      retries). The decision is claimed with an ATOMIC
 *      findOneAndUpdate({ _id, status: PENDING }); exactly one caller can
 *      claim, the loser gets REQUEST_ALREADY_REVIEWED. (The catalog outbox
 *      in the same codebase uses the same leased-claim pattern.)
 *   2. APPROVED-BUT-NOT-APPLIED — the apply step throws after the decision
 *      is stored. We therefore claim FIRST, apply SECOND, and on apply
 *      failure COMPENSATE: the request returns to PENDING with
 *      lastApplyError set, so the admin sees why and can re-decide. A
 *      successful apply stamps `appliedAt`, and a re-approval of an
 *      already-applied request SKIPS the apply (idempotent — an image set
 *      is never added twice).
 *
 * PAYLOAD TRUST: tenants submit `payload`/`diff` as free-form JSON (it is
 * their proposal). Every apply branch therefore re-validates the exact
 * shape it consumes BEFORE touching the master; the master itself only ever
 * receives whitelisted global fields (see applyGlobalPatch).
 */

/** Shape guards for tenant-submitted apply payloads (fail fast, 400-able). */
const ATTR_KEY_RX = /^[a-z0-9_]+$/;

function assertAttributesShape(attrs) {
  if (!Array.isArray(attrs)) throw badRequest('payload.attributes must be an array', 'PAYLOAD_INVALID');
  if (attrs.length > 40) throw badRequest('At most 40 attributes per master', 'PAYLOAD_INVALID');
  for (const a of attrs) {
    if (!a || typeof a !== 'object' || typeof a.key !== 'string' || !ATTR_KEY_RX.test(a.key)
      || typeof a.value !== 'string' || !a.value.length || a.value.length > 200) {
      throw badRequest('Each attribute needs { key: a-z0-9_ , value: non-empty string ≤200 }', 'PAYLOAD_INVALID');
    }
    if (a.unit !== undefined && a.unit !== null && typeof a.unit !== 'string') {
      throw badRequest('attribute.unit must be a string', 'PAYLOAD_INVALID');
    }
  }
}

function assertVariantShape(variant) {
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
    throw badRequest('payload.variant must be an object', 'PAYLOAD_INVALID');
  }
  if (variant.variantType !== undefined
    && (typeof variant.variantType !== 'string' || !Object.values(VARIANT_TYPE).includes(variant.variantType))) {
    throw badRequest('payload.variant.variantType is invalid', 'PAYLOAD_INVALID');
  }
  const hasLegacyValue = typeof variant.value === 'string' && variant.value.trim() && variant.value.length <= 100;
  const hasOptions = Array.isArray(variant.optionValues) && variant.optionValues.length > 0 && variant.optionValues.length <= 6;
  if (!hasLegacyValue && !hasOptions) {
    throw badRequest('payload.variant needs value or 1–6 optionValues', 'PAYLOAD_INVALID');
  }
  if (variant.images !== undefined && !Array.isArray(variant.images)) {
    throw badRequest('payload.variant.images must be an array', 'PAYLOAD_INVALID');
  }
  for (const img of variant.images || []) {
    assertImageShape(img);
  }
}

function assertImageShape(img) {
  if (!img || typeof img !== 'object' || Array.isArray(img)) {
    throw badRequest('Each image must be an object', 'PAYLOAD_INVALID');
  }
  if (typeof img.url !== 'string' || !img.url.trim()) {
    throw badRequest('Each image needs a non-empty url', 'PAYLOAD_INVALID');
  }
  if (img.altText !== undefined && img.altText !== null && (typeof img.altText !== 'string' || img.altText.length > 200)) {
    throw badRequest('image.altText must be a string ≤200', 'PAYLOAD_INVALID');
  }
}

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
   * Atomic claim + compensating rollback — see the class doc.
   */
  async review({ requestId, decision, actorId = null, note = null, req = null }) {
    if (!['approve', 'reject', 'needs_changes'].includes(decision)) {
      throw badRequest('Invalid decision', 'INVALID_DECISION');
    }
    const decided = {
      approve: CHANGE_REQUEST_STATUS.APPROVED,
      reject: CHANGE_REQUEST_STATUS.REJECTED,
      needs_changes: CHANGE_REQUEST_STATUS.NEEDS_CHANGES,
    }[decision];

    // ---- ATOMIC CLAIM: exactly one concurrent reviewer can win ----
    const claimed = await ProductChangeRequest.findOneAndUpdate(
      { _id: requestId, status: CHANGE_REQUEST_STATUS.PENDING },
      { $set: { status: decided, review: { reviewedBy: actorId, reviewedAt: new Date(), note } } },
      { new: true }
    );
    if (!claimed) {
      const existing = await ProductChangeRequest.findById(requestId);
      if (!existing) throw notFound('Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
      throw conflict(`Request is already ${existing.status}`, 'REQUEST_ALREADY_REVIEWED');
    }

    if (decision === 'reject' && claimed.type === CHANGE_REQUEST_TYPE.CREATE_MASTER && claimed.productMasterId) {
      // Mirror the rejection onto the proposed master — otherwise a rejected
      // proposal would linger PENDING_REVIEW forever (its listings staged by
      // the tenant could even be activated). Tolerate the master having
      // already left PENDING_REVIEW (e.g. admin reviewed it directly first).
      try {
        await productMasterService.reviewCreateMaster({
          masterId: claimed.productMasterId, decision: 'reject', actorId, note: claimed.review?.note, req,
        });
      } catch (err) {
        if (err?.code !== 'NOT_PENDING_REVIEW') throw err;
      }
    }

    if (decision === 'approve') {
      try {
        await this.applyRequest(claimed, { actorId, req });
        // Idempotency stamp: a later re-approval must never apply twice.
        await ProductChangeRequest.updateOne(
          { _id: claimed.id, status: CHANGE_REQUEST_STATUS.APPROVED },
          { $set: { appliedAt: new Date(), lastApplyError: null } }
        );
      } catch (err) {
        // COMPENSATE: the master was (partially) not updated; give the
        // decision back to the queue with the reason so it is retryable
        // instead of stuck in APPROVED-never-applied.
        await ProductChangeRequest.updateOne(
          { _id: claimed.id, status: CHANGE_REQUEST_STATUS.APPROVED },
          {
            $set: {
              status: CHANGE_REQUEST_STATUS.PENDING,
              lastApplyError: String(err?.code || err?.message || err).slice(0, 500),
              review: { reviewedBy: null, reviewedAt: null, note: null },
            },
          }
        ).catch(() => {});
        throw err;
      }
    }

    await auditService.record({
      action: decision === 'approve' ? 'approve' : 'reject', entityType: 'product_change_request', entityId: claimed.id,
      tenantId: claimed.tenantId, actorId, actorType: 'admin',
      before: { status: 'pending' }, after: { status: claimed.status }, meta: { note, type: claimed.type }, req,
    });

    await catalogEventService.publish({
      eventType: 'change_request_reviewed', entityType: 'product_change_request', entityId: claimed.id,
      tenantId: claimed.tenantId, payload: { id: claimed.id, decision, status: claimed.status, type: claimed.type },
    });
    return claimed;
  }

  /**
   * Tenant cancels their own pending request. Guarded claim: a cancel racing
   * an admin review cannot silently win — the loser re-derives the exact
   * cause (already reviewed) instead of resurrecting or duplicating work.
   */
  async cancel({ requestId, tenantId, actorId = null, req = null }) {
    const cr = await ProductChangeRequest.findById(requestId);
    if (!cr) throw notFound('Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
    if (String(cr.tenantId) !== String(tenantId)) {
      throw forbidden('Not your change request', 'FORBIDDEN');
    }
    // Same atomic-claim discipline as review: only one actor can flip it.
    const claimed = await ProductChangeRequest.findOneAndUpdate(
      { _id: requestId, status: CHANGE_REQUEST_STATUS.PENDING },
      { $set: { status: CHANGE_REQUEST_STATUS.CANCELLED } },
      { new: true }
    );
    if (!claimed) throw conflict('Only pending requests can be cancelled', 'REQUEST_NOT_PENDING');
    await auditService.record({
      action: 'update', entityType: 'product_change_request', entityId: cr.id,
      tenantId, actorId, actorType: 'tenant',
      before: { status: 'pending' }, after: { status: claimed.status }, req,
    });
    return claimed;
  }

  /** Tenant revises a NEEDS_CHANGES request (updates payload/diff, back to PENDING). */
  async revise({ requestId, tenantId, actorId: _actorId = null, payload = null, diff = null, note = null, req: _req = null }) {
    const cr = await ProductChangeRequest.findById(requestId);
    if (!cr) throw notFound('Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
    if (String(cr.tenantId) !== String(tenantId)) throw forbidden('Not your change request', 'FORBIDDEN');
    const claimed = await ProductChangeRequest.findOneAndUpdate(
      { _id: requestId, status: CHANGE_REQUEST_STATUS.NEEDS_CHANGES },
      {
        $set: {
          ...(payload ? { payload } : {}),
          ...(diff ? { diff } : {}),
          ...(note ? { note } : {}),
          status: CHANGE_REQUEST_STATUS.PENDING,
          review: {},
        },
      },
      { new: true }
    );
    if (!claimed) throw conflict('Only needs_changes requests can be revised', 'REQUEST_NOT_REVISABLE');
    return claimed;
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

  /**
   * Apply the request to the master. Idempotent across re-approval: if
   * `appliedAt` is already set, the apply step is a no-op.
   * Every branch validates the tenant-supplied payload shape first.
   */
  async applyRequest(cr, { actorId = null, req = null } = {}) {
    if (cr.appliedAt) return; // already applied (re-approval after rollback)

    switch (cr.type) {
      case CHANGE_REQUEST_TYPE.CREATE_MASTER: {
        await productMasterService.reviewCreateMaster({
          masterId: cr.productMasterId, decision: 'approve', actorId, note: cr.review?.note, req,
        });
        break;
      }
      case CHANGE_REQUEST_TYPE.UPDATE_GLOBAL_FIELDS: {
        if (!cr.diff?.after || typeof cr.diff.after !== 'object') {
          throw badRequest('update_global_fields requires diff.after', 'PAYLOAD_INVALID');
        }
        const master = await ProductMaster.findById(cr.productMasterId);
        if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
        await productMasterService.applyGlobalPatch(master, cr.diff.after, { actorId, note: cr.review?.note, req });
        break;
      }
      case CHANGE_REQUEST_TYPE.UPDATE_ATTRIBUTES: {
        assertAttributesShape(cr.payload?.attributes);
        await productMasterService.setAttributes({
          id: cr.productMasterId, attributes: cr.payload.attributes, viaRequest: true, actorId, req,
        });
        break;
      }
      case CHANGE_REQUEST_TYPE.UPDATE_IMAGES: {
        if (!Array.isArray(cr.payload?.images)) throw badRequest('payload.images must be an array', 'PAYLOAD_INVALID');
        for (const img of cr.payload.images) assertImageShape(img);
        for (const img of cr.payload.images) {
          // eslint-disable-next-line no-await-in-loop
          await productMasterService.addImage({
            id: cr.productMasterId, payload: img, viaRequest: true, actorId, req,
          });
        }
        break;
      }
      case CHANGE_REQUEST_TYPE.ADD_VARIANT: {
        assertVariantShape(cr.payload?.variant);
        await productMasterService.addVariant({
          id: cr.productMasterId, payload: cr.payload.variant, viaRequest: true, actorId, req,
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
