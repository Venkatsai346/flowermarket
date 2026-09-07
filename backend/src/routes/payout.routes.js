import { Router } from 'express';
import Joi from 'joi';
import PayoutController from '../controllers/payout.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';
import {
  payoutListQuerySchema, payoutIdParamSchema, computeCycleSchema, approveSchema,
  reasonSchema, holdSchema, releaseSchema, adjustmentSchema, payoutAccountSchema,
  kycSchema, kycReviewSchema, kycListQuerySchema, payoutPolicySchema, settlementIngestSchema,
  statutoryDepositSchema, statutoryRevertSchema, bankStatementIngestSchema,
} from '../utils/validators/payout.validators.js';

const router = Router();

// Phase 17 — optional vendor scoping for the reconcile endpoints
const vendorReconcileQuery = Joi.object({ id: Joi.string().hex().length(24).optional() });
const vendorReconcileBody = Joi.object({ id: Joi.string().hex().length(24).optional() });

/**
 * /payouts — vendor disbursement (Phase 6.3).
 *
 * Two audiences, hard-separated:
 *   /me/*     a vendor sees ONLY its own money and manages its own bank details
 *   /admin/*  super_admin only — this is the one surface in the platform that
 *             moves money OUT, so it is the most tightly gated. Approval is a
 *             separate call from computation on purpose: a human decides.
 */
router.use(authenticate);

const vendorOnly = authorize(USER_ROLES.VENDOR);
const platformAdmin = authorize(USER_ROLES.SUPER_ADMIN);

// ---- vendor: my money ----
router.get('/me', vendorOnly, validate(payoutListQuerySchema, 'query'), PayoutController.myPayouts);
router.get('/me/upcoming', vendorOnly, PayoutController.myUpcoming);
router.get('/me/:id/statement', vendorOnly, validate(payoutIdParamSchema, 'params'), PayoutController.myPayoutStatement);

// ---- vendor: destination & KYC ----
router.get('/me/account', vendorOnly, PayoutController.getMyAccount);
router.put('/me/account', vendorOnly, validate(payoutAccountSchema), PayoutController.upsertMyAccount);
router.post('/me/account/verify', vendorOnly, PayoutController.verifyMyAccount);
router.post('/me/kyc', vendorOnly, validate(kycSchema), PayoutController.submitKyc);

// ---- platform: the money-moving surface ----
router.get('/admin', platformAdmin, validate(payoutListQuerySchema, 'query'), PayoutController.listPayouts);
router.get('/admin/kyc', platformAdmin, validate(kycListQuerySchema, 'query'), PayoutController.listKyc);
router.get('/admin/policy', platformAdmin, PayoutController.getPolicy);
router.put('/admin/policy', platformAdmin, validate(payoutPolicySchema), PayoutController.upsertPolicy);
router.post('/admin/eligibility/sweep', platformAdmin, PayoutController.markEligible);
router.post('/admin/cycle/compute', platformAdmin, validate(computeCycleSchema), PayoutController.computeCycle);
router.post('/admin/lines/hold', platformAdmin, validate(holdSchema), PayoutController.hold);
router.post('/admin/lines/release', platformAdmin, validate(releaseSchema), PayoutController.release);
router.post('/admin/adjustments', platformAdmin, validate(adjustmentSchema), PayoutController.addAdjustment);
router.post('/admin/kyc/:id/review', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(kycReviewSchema), PayoutController.reviewKyc);
router.get('/admin/settlements', platformAdmin, PayoutController.settlementSummary);
// Phase 13 — statutory deposits (TCS/TDS to the government)
router.get('/admin/statutory', platformAdmin, PayoutController.statutorySummary);
router.post('/admin/statutory/deposit', platformAdmin, validate(statutoryDepositSchema), PayoutController.statutoryDeposit);
router.post('/admin/statutory/:id/revert', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(statutoryRevertSchema), PayoutController.statutoryRevert);
// Phase 14 — bank statement reconciliation (the egress truth)
router.get('/admin/statement', platformAdmin, PayoutController.statementSummary);
router.post('/admin/statement/ingest', platformAdmin, validate(bankStatementIngestSchema), PayoutController.statementIngest);
router.delete('/admin/statement/lines/:ref/:lineNo', platformAdmin, validate(Joi.object({ ref: Joi.string().min(3).max(64), lineNo: Joi.number().integer().min(1) }), 'params'), PayoutController.statementLineDelete);
// Phase 17 — vendor payable integrity (the payout lines ARE the ledger)
router.get('/admin/vendor-reconcile', platformAdmin, validate(vendorReconcileQuery, 'query'), PayoutController.vendorReconcile);
router.post('/admin/vendor-reconcile/repair', platformAdmin, validate(vendorReconcileBody, 'body'), PayoutController.vendorReconcileRepair);
// Phase 18 — statutory payable integrity (TCS/TDS are real accounts)
router.get('/admin/statutory-reconcile', platformAdmin, validate(Joi.object({ statute: Joi.string().valid('tcs', 'tds').optional() }), 'query'), PayoutController.statutoryReconcile);
router.post('/admin/statutory-reconcile/repair', platformAdmin, validate(Joi.object({ statute: Joi.string().valid('tcs', 'tds') }), 'body'), PayoutController.statutoryReconcileRepair);
// Phase 19 — GST output payable integrity (the seller's GST is a ledger)
router.get('/admin/gst-reconcile', platformAdmin, validate(Joi.object({ vendor: Joi.string().hex().length(24).optional() }), 'query'), PayoutController.gstReconcile);
router.post('/admin/gst-reconcile/repair', platformAdmin, validate(Joi.object({ owner: Joi.alternatives().try(Joi.string().hex().length(24), Joi.string().valid('platform')).optional() }), 'body'), PayoutController.gstReconcileRepair);
// Phase 20 — bank cash position integrity (bank books = cash facts)
router.get('/admin/bank-reconcile', platformAdmin, PayoutController.bankReconcile);
router.post('/admin/bank-reconcile/repair', platformAdmin, validate(Joi.object({ note: Joi.string().max(300).optional() }), 'body'), PayoutController.bankReconcileRepair);
router.get('/admin/:id', platformAdmin, validate(payoutIdParamSchema, 'params'), PayoutController.getPayout);
router.post('/admin/:id/submit', platformAdmin, validate(payoutIdParamSchema, 'params'), PayoutController.submitForApproval);
router.post('/admin/:id/approve', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(approveSchema), PayoutController.approve);
router.post('/admin/:id/reject', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(reasonSchema), PayoutController.reject);
router.post('/admin/:id/submit-to-provider', platformAdmin, validate(payoutIdParamSchema, 'params'), PayoutController.submit);
router.post('/admin/reconcile', platformAdmin, PayoutController.reconcile);
router.post('/admin/settlements/ingest', platformAdmin, validate(settlementIngestSchema), PayoutController.ingestSettlements);
router.post('/admin/:id/cancel', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(reasonSchema), PayoutController.cancel);

export default router;
