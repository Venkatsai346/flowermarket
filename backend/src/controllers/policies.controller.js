import policyAdminService from '../services/policyAdmin.service.js';
import pricingPolicyService from '../services/pricingPolicy.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';

/**
 * PoliciesController — admin CRUD for the Phase 3.5 pricing/refund policies:
 *  - DeliveryFeePolicy (per tenant; at-most-one active)
 *  - TaxPolicy (per category — GST is a legal classification)
 *  - DiscountPolicy (coupons; tenant or platform-wide)
 *  - TenantRefundPolicy (fee-refund rules)
 */
class PoliciesController {
  // ---- delivery fee ----
  listFeePolicies = asyncHandler(async (req, res) => {
    const items = await policyAdminService.listDeliveryFeePolicies({ tenantId: req.tenantId });
    res.status(200).json(success(items, { message: 'Delivery fee policies' }));
  });

  createFeePolicy = asyncHandler(async (req, res) => {
    const policy = await policyAdminService.createDeliveryFeePolicy({
      tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId,
    });
    res.status(201).json(created(policy, { message: 'Delivery fee policy created (now active)' }));
  });

  updateFeePolicy = asyncHandler(async (req, res) => {
    const policy = await policyAdminService.updateDeliveryFeePolicy({
      tenantId: req.tenantId, policyId: req.params.id, payload: req.body,
    });
    res.status(200).json(success(policy, { message: 'Delivery fee policy updated' }));
  });

  // ---- tax ----
  upsertTaxPolicy = asyncHandler(async (req, res) => {
    const policy = await policyAdminService.upsertTaxPolicy({
      categoryId: req.body.categoryId, payload: req.body,
    });
    res.status(201).json(created(policy, { message: 'Tax policy upserted (active)' }));
  });

  listTaxPolicies = asyncHandler(async (req, res) => {
    const items = await policyAdminService.listTaxPolicies({ categoryId: req.query.categoryId || null });
    res.status(200).json(success(items, { message: 'Tax policies' }));
  });

  // ---- coupons ----
  createCoupon = asyncHandler(async (req, res) => {
    const coupon = await policyAdminService.createDiscountPolicy({
      tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId,
    });
    res.status(201).json(created(coupon, { message: 'Coupon created' }));
  });

  listCoupons = asyncHandler(async (req, res) => {
    const items = await policyAdminService.listDiscountPolicies({ tenantId: req.tenantId });
    res.status(200).json(success(items, { message: 'Coupons' }));
  });

  // ---- tenant refund policy ----
  getRefundPolicy = asyncHandler(async (req, res) => {
    const policy = await policyAdminService.getTenantRefundPolicy({ tenantId: req.tenantId });
    res.status(200).json(success(policy, { message: 'Tenant refund policy' }));
  });

  updateRefundPolicy = asyncHandler(async (req, res) => {
    const policy = await policyAdminService.updateTenantRefundPolicy({
      tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId,
    });
    res.status(200).json(success(policy, { message: 'Tenant refund policy updated' }));
  });

  // ---- coupon preview (customer-facing, also used by cart) ----
  previewCoupon = asyncHandler(async (req, res) => {
    const result = await pricingPolicyService.previewCoupon({
      tenantId: req.tenantId,
      code: req.query.code || req.body.code,
      userId: req.auth.userId,
      cartSubtotal: Number(req.query.cartSubtotal) || 0,
    });
    res.status(200).json(success(result, { message: 'Coupon preview' }));
  });
}

export default new PoliciesController();
