import ProductChangeRequest from '../models/productChangeRequest.model.js';
import ProductMaster from '../models/productMaster.model.js';
import ProductVariant from '../models/productVariant.model.js';
import ProductImage from '../models/productImage.model.js';
import ProductAttributeValue from '../models/productAttributeValue.model.js';
import productMasterService from './productMaster.service.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { badRequest, notFound, conflict, forbidden } from '../utils/ApiError.js';
import { CHANGE_REQUEST_STATUS, CHANGE_REQUEST_TYPE } from '../constants/enums.js';

/**
 * ChangeRequestService — the field-ownership approval workflow.
 *
 * Flow: tenant submits request (PENDING) -> admin approves (applies diff) /
 * rejects (reason) / needs_changes (tenant revises & resubmits).
 * Tenants may CANCELL their own pending requests.
 */
class ChangeRequestService {
  /** Submit a change request on behalf of a tenant. */
  async submit({ type, tenantId, actorId, productMasterId = null, payload = null, diff = null, note = null, req = null }) {
    if (!Object.values(CHANGE_REQUEST_TYPE).includes(type)) {
      throw badRequest('Invalid change request type', 'INVALID_REQUEST_TYPE');
    }
    if (type === CHANGE_REQUEST_TYPE.CREATE_MASTER) {
      if (!payload?.title) throw badRequest('payload.title is required for create_master', 'PAYLOAD_INVALID');
    } else if (!productMasterId) {
      throw badRequest('productMasterId is required', 'PRODUCT_MASTER_REQUIRED');
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
   */
  async review({ requestId, decision, actorId = null, note = null, req = null }) {
    const cr = await ProductChangeRequest.findById(requestId);
    if (!cr) throw notFound('Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
    if (cr.status !== CHANGE_REQUEST_STATUS.PENDING) {
      throw conflict(`Request is already ${cr.status}`, 'REQUEST_ALREADY_REVIEWED');
    }
    if (!['approve', 'reject', 'needs_changes'].includes(decision)) {
      throw badRequest('Invalid decision', 'INVALID_DECISION');
    }

    cr.status = {
      approve: CHANGE_REQUEST_STATUS.APPROVED,
      reject: CHANGE_REQUEST_STATUS.REJECTED,
      needs_changes: CHANGE_REQUEST_STATUS.NEEDS_CHANGES,
    }[decision];
    cr.review = { reviewedBy: actorId, reviewedAt: new Date(), note };
    await cr.save();

    await auditService.record({
      action: decision === 'approve' ? 'approve' : 'reject', entityType: 'product_change_request', entityId: cr.id,
      tenantId: cr.tenantId, actorId, actorType: 'admin',
      before: { status: 'pending' }, after: { status: cr.status }, meta: { note, type: cr.type }, req,
    });

    if (decision === 'approve') {
      await this.applyRequest(cr, { actorId, req });
    }

    await catalogEventService.publish({
      eventType: 'change_request_reviewed', entityType: 'product_change_request', entityId: cr.id,
      tenantId: cr.tenantId, payload: { id: cr.id, decision, status: cr.status, type: cr.type },
    });
    return cr;
  }

  /** Tenant cancels their own pending request. */
  async cancel({ requestId, tenantId, actorId = null, req = null }) {
    const cr = await ProductChangeRequest.findById(requestId);
    if (!cr) throw notFound('Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
    if (String(cr.tenantId) !== String(tenantId)) {
      throw forbidden('Not your change request', 'FORBIDDEN');
    }
    if (cr.status !== CHANGE_REQUEST_STATUS.PENDING) {
      throw conflict('Only pending requests can be cancelled', 'REQUEST_NOT_PENDING');
    }
    cr.status = CHANGE_REQUEST_STATUS.CANCELLED;
    await cr.save();
    await auditService.record({
      action: 'update', entityType: 'product_change_request', entityId: cr.id,
      tenantId, actorId, actorType: 'tenant',
      before: { status: 'pending' }, after: { status: cr.status }, req,
    });
    return cr;
  }

  /** Tenant revises a NEEDS_CHANGES request (updates payload/diff, back to PENDING). */
  async revise({ requestId, tenantId, actorId = null, payload = null, diff = null, note = null, req = null }) {
    const cr = await ProductChangeRequest.findById(requestId);
    if (!cr) throw notFound('Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
    if (String(cr.tenantId) !== String(tenantId)) throw forbidden('Not your change request', 'FORBIDDEN');
    if (cr.status !== CHANGE_REQUEST_STATUS.NEEDS_CHANGES) {
      throw conflict('Only needs_changes requests can be revised', 'REQUEST_NOT_REVISABLE');
    }
    if (payload) cr.payload = payload;
    if (diff) cr.diff = diff;
    if (note) cr.note = note;
    cr.status = CHANGE_REQUEST_STATUS.PENDING;
    cr.review = {};
    await cr.save();
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
