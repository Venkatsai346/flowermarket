import { Router } from 'express';
import PayoutController from '../controllers/payout.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';
import {
  payoutListQuerySchema, payoutIdParamSchema, computeCycleSchema, approveSchema,
  reasonSchema, holdSchema, releaseSchema, adjustmentSchema, payoutAccountSchema,
  kycSchema, kycReviewSchema, payoutPolicySchema,
} from '../utils/validators/payout.validators.js';

const router = Router();

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
router.get('/admin/policy', platformAdmin, PayoutController.getPolicy);
router.put('/admin/policy', platformAdmin, validate(payoutPolicySchema), PayoutController.upsertPolicy);
router.post('/admin/eligibility/sweep', platformAdmin, PayoutController.markEligible);
router.post('/admin/cycle/compute', platformAdmin, validate(computeCycleSchema), PayoutController.computeCycle);
router.post('/admin/lines/hold', platformAdmin, validate(holdSchema), PayoutController.hold);
router.post('/admin/lines/release', platformAdmin, validate(releaseSchema), PayoutController.release);
router.post('/admin/adjustments', platformAdmin, validate(adjustmentSchema), PayoutController.addAdjustment);
router.post('/admin/kyc/:id/review', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(kycReviewSchema), PayoutController.reviewKyc);
router.get('/admin/:id', platformAdmin, validate(payoutIdParamSchema, 'params'), PayoutController.getPayout);
router.post('/admin/:id/submit', platformAdmin, validate(payoutIdParamSchema, 'params'), PayoutController.submitForApproval);
router.post('/admin/:id/approve', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(approveSchema), PayoutController.approve);
router.post('/admin/:id/reject', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(reasonSchema), PayoutController.reject);
router.post('/admin/:id/cancel', platformAdmin, validate(payoutIdParamSchema, 'params'), validate(reasonSchema), PayoutController.cancel);

export default router;
