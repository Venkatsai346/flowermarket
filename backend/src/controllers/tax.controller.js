import taxService from '../services/tax.service.js';
import taxDocumentService from '../services/taxDocument.service.js';
import Order from '../models/order.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { notFound } from '../utils/ApiError.js';
import { TAX_OWNER_TYPE, TAX_DOC_TYPE } from '../constants/enums.js';

/**
 * TaxController — GST registrations, rate policies and tax documents.
 *
 * Scoping rule: a store admin only ever sees its own tenant's documents
 * (`req.tenantId` is passed down), while rate policies and statutory rates are
 * platform-level because GST classification is a legal fact, not a per-tenant
 * business choice.
 */
class TaxController {
  // ---------------- registration (own GSTIN) ----------------
  getMyRegistration = asyncHandler(async (req, res) => {
    const reg = await taxService.getRegistration({
      ownerType: TAX_OWNER_TYPE.TENANT, ownerId: req.tenantId,
    });
    res.status(200).json(success(reg, { message: reg ? 'Registration fetched' : 'No registration yet' }));
  });

  upsertMyRegistration = asyncHandler(async (req, res) => {
    const reg = await taxService.upsertRegistration({
      ownerType: TAX_OWNER_TYPE.TENANT,
      ownerId: req.tenantId,
      payload: req.body,
      actorId: req.auth.userId,
      req,
    });
    res.status(200).json(success(reg, { message: 'Registration saved' }));
  });

  // ---------------- documents ----------------
  listDocuments = asyncHandler(async (req, res) => {
    const result = await taxDocumentService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { meta: result.meta, message: 'Documents fetched' }));
  });

  getDocument = asyncHandler(async (req, res) => {
    const doc = await taxDocumentService.detail({ documentId: req.params.id, tenantId: req.tenantId });
    res.status(200).json(success(doc, { message: 'Document fetched' }));
  });

  issueInvoice = asyncHandler(async (req, res) => {
    const result = await taxDocumentService.issueForOrder({
      orderId: req.body.orderId,
      force: req.body.force,
      actorId: req.auth.userId,
      req,
    });
    res.status(result.created ? 201 : 200).json(
      success(result.documents, { message: result.created ? 'Invoice(s) issued' : 'Invoice(s) already issued' })
    );
  });

  cancelDocument = asyncHandler(async (req, res) => {
    const doc = await taxDocumentService.cancel({
      documentId: req.params.id,
      reason: req.body.reason,
      tenantId: req.tenantId,
      actorId: req.auth.userId,
      req,
    });
    res.status(200).json(success(doc, { message: 'Document cancelled' }));
  });

  issueCreditNote = asyncHandler(async (req, res) => {
    const result = req.body.refundTransactionId
      ? await taxDocumentService.issueCreditNoteForRefund({
        refundTransactionId: req.body.refundTransactionId,
        reason: req.body.reason,
        actorId: req.auth.userId,
        req,
      })
      : await (async () => {
        const invoice = await taxDocumentService.detail({ documentId: req.body.invoiceId, tenantId: req.tenantId });
        const doc = await taxDocumentService.issueCreditNoteAgainst({
          invoice,
          amountPaise: Math.round(Number(req.body.amount) * 100),
          reason: req.body.reason,
          actorId: req.auth.userId,
          req,
        });
        return { documents: [doc], created: true };
      })();
    res.status(201).json(created(result.documents ?? result.document, { message: 'Credit note issued' }));
  });

  retryEinvoice = asyncHandler(async (req, res) => {
    const doc = await taxDocumentService.requestIrn(req.params.id);
    res.status(200).json(success(doc, { message: 'e-invoice registration attempted' }));
  });

  auditSeries = asyncHandler(async (req, res) => {
    const result = await taxDocumentService.auditSeries({
      ownerType: req.query.ownerType,
      ownerId: req.query.ownerId || req.tenantId,
      docType: req.query.docType,
      fyLabel: req.query.fyLabel,
    });
    res.status(200).json(success(result, { message: 'Series audited' }));
  });

  // ---------------- customer-facing ----------------
  myOrderInvoice = asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenantId, userId: req.auth.userId }).lean();
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');
    const result = await taxDocumentService.list({
      tenantId: req.tenantId,
      query: { orderId: String(order._id), docType: TAX_DOC_TYPE.INVOICE },
    });
    res.status(200).json(success(result.items, { message: 'Invoice(s) fetched' }));
  });

  // ---------------- platform: rate policies ----------------
  listPolicies = asyncHandler(async (req, res) => {
    const result = await taxService.listPolicies({ query: req.query });
    res.status(200).json(success(result.items, { message: 'Tax policies fetched' }));
  });

  upsertPolicy = asyncHandler(async (req, res) => {
    const policy = await taxService.upsertPolicy({ payload: req.body, actorId: req.auth.userId, req });
    res.status(201).json(created(policy, { message: 'Tax policy version created' }));
  });

  listStatutoryRates = asyncHandler(async (req, res) => {
    const result = await taxService.listStatutoryRates({ kind: req.query.kind || null });
    res.status(200).json(success(result.items, { message: 'Statutory rates fetched' }));
  });

  createStatutoryRate = asyncHandler(async (req, res) => {
    const rate = await taxService.createStatutoryRate({ payload: req.body, actorId: req.auth.userId, req });
    res.status(201).json(created(rate, { message: 'Statutory rate version created' }));
  });
}

export default new TaxController();
