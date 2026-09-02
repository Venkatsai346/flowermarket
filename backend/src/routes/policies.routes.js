import { Router } from 'express';
import PoliciesController from '../controllers/policies.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  feePolicySchema,
  taxPolicySchema,
  couponSchema,
  refundPolicySchema,
  couponPreviewSchema,
} from '../utils/validators/order.validators.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();

/**
 * /policies — Phase 3.5 pricing/refund policy management (ADMIN).
 * Preview endpoint is customer-facing too (coupon validation on the cart).
 */
const ADMIN = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

// ---- delivery fee policies ----
router.get('/delivery-fee', authenticate, authorize(...ADMIN), PoliciesController.listFeePolicies);
router.post('/delivery-fee', authenticate, authorize(...ADMIN), validate(feePolicySchema), PoliciesController.createFeePolicy);
router.patch('/delivery-fee/:id', authenticate, authorize(...ADMIN), validate(feePolicySchema, 'body'), PoliciesController.updateFeePolicy);

// ---- tax policies (category-level; GST is not a tenant choice) ----
router.get('/tax', authenticate, authorize(...ADMIN), PoliciesController.listTaxPolicies);
router.post('/tax', authenticate, authorize(...ADMIN), validate(taxPolicySchema), PoliciesController.upsertTaxPolicy);

// ---- coupons ----
router.get('/coupons', authenticate, authorize(...ADMIN), PoliciesController.listCoupons);
router.post('/coupons', authenticate, authorize(...ADMIN), validate(couponSchema), PoliciesController.createCoupon);

// ---- tenant refund policy ----
router.get('/refund', authenticate, authorize(...ADMIN), PoliciesController.getRefundPolicy);
router.patch('/refund', authenticate, authorize(...ADMIN), validate(refundPolicySchema), PoliciesController.updateRefundPolicy);

// ---- coupon preview (customer cart applies coupon via this) ----
router.get('/coupons/preview', authenticate, validate(couponPreviewSchema, 'query'), PoliciesController.previewCoupon);

export default router;
