import DiscountPolicy from '../models/discountPolicy.model.js';
import TenantRefundPolicy from '../models/tenantRefundPolicy.model.js';
import TaxPolicy from '../models/taxPolicy.model.js';
import DeliveryFeePolicy from '../models/deliveryFeePolicy.model.js';
import { badRequest, notFound } from '../utils/ApiError.js';

/**
 * PolicyAdminService — ops CRUD for the pricing/refund policies.
 * Everything is tenant-scoped; effective-from/to + at-most-one-active keeps
 * policy history intact (a tenant's old policy rows remain for audit).
 */
class PolicyAdminService {
  // ---------------- delivery fee policies ----------------

  async listDeliveryFeePolicies({ tenantId }) {
    return DeliveryFeePolicy.find({ tenantId }).sort({ createdAt: -1 }).lean();
  }

  async createDeliveryFeePolicy({ tenantId, payload, actorId = null }) {
    const { baseFee, freeDeliveryThreshold, expressSurgeMultiplier, distanceFeePerKm, effectiveFrom, effectiveTo, name } = payload;
    if (baseFee == null) throw badRequest('baseFee is required', 'BASE_FEE_REQUIRED');

    // deactivate any currently-active row (at-most-one-active invariant)
    await DeliveryFeePolicy.updateMany(
      { tenantId, isActive: true },
      { $set: { isActive: false } }
    );

    return DeliveryFeePolicy.create({
      tenantId,
      name: name || 'default',
      baseFee,
      freeDeliveryThreshold: freeDeliveryThreshold ?? null,
      expressSurgeMultiplier: expressSurgeMultiplier ?? 1,
      distanceFeePerKm: distanceFeePerKm ?? 0,
      effectiveFrom: effectiveFrom || null,
      effectiveTo: effectiveTo || null,
      isActive: true,
      version: 1,
    });
  }

  async updateDeliveryFeePolicy({ tenantId, policyId, payload }) {
    const policy = await DeliveryFeePolicy.findOne({ _id: policyId, tenantId });
    if (!policy) throw notFound('Delivery fee policy not found', 'FEE_POLICY_NOT_FOUND');
    const { baseFee, freeDeliveryThreshold, expressSurgeMultiplier, distanceFeePerKm, isActive } = payload;
    if (baseFee != null) policy.baseFee = baseFee;
    if (freeDeliveryThreshold !== undefined) policy.freeDeliveryThreshold = freeDeliveryThreshold;
    if (expressSurgeMultiplier != null) policy.expressSurgeMultiplier = expressSurgeMultiplier;
    if (distanceFeePerKm !== undefined) policy.distanceFeePerKm = distanceFeePerKm;
    if (isActive !== undefined) {
      if (isActive) {
        await DeliveryFeePolicy.updateMany({ tenantId, isActive: true, _id: { $ne: policy._id } }, { $set: { isActive: false } });
      }
      policy.isActive = isActive;
    }
    policy.version += 1;
    await policy.save();
    return policy;
  }

  // ---------------- tax policies ----------------

  async upsertTaxPolicy({ categoryId, payload, actorId = null }) {
    const { gstSlabPct, hsnCode, effectiveFrom, effectiveTo } = payload;
    if (gstSlabPct == null) throw badRequest('gstSlabPct is required', 'GST_REQUIRED');

    await TaxPolicy.updateMany({ categoryId, isActive: true }, { $set: { isActive: false } });
    return TaxPolicy.create({
      categoryId,
      gstSlabPct,
      hsnCode: hsnCode || null,
      effectiveFrom: effectiveFrom || null,
      effectiveTo: effectiveTo || null,
      isActive: true,
    });
  }

  async listTaxPolicies({ categoryId = null }) {
    const q = categoryId ? { categoryId } : {};
    return TaxPolicy.find(q).sort({ createdAt: -1 }).lean();
  }

  // ---------------- discount policies (coupons) ----------------

  async createDiscountPolicy({ tenantId, payload, actorId = null }) {
    const { code, discountType, value, minCartValue, maxDiscountCap, usageLimitPerCustomer, validFrom, validTo, isPlatformWide } = payload;
    if (!code || !discountType || value == null) throw badRequest('code, discountType, value required', 'COUPON_FIELDS_REQUIRED');
    return DiscountPolicy.create({
      tenantId: isPlatformWide ? null : tenantId,
      code: code.toUpperCase(),
      discountType,
      value,
      minCartValue: minCartValue ?? 0,
      maxDiscountCap: maxDiscountCap ?? null,
      usageLimitPerCustomer: usageLimitPerCustomer ?? null,
      validFrom: validFrom || null,
      validTo: validTo || null,
      isActive: true,
      status: 'active',
    });
  }

  async listDiscountPolicies({ tenantId }) {
    return DiscountPolicy.find({ $or: [{ tenantId }, { tenantId: null }] }).sort({ createdAt: -1 }).lean();
  }

  // ---------------- tenant refund policy ----------------

  async getTenantRefundPolicy({ tenantId }) {
    let policy = await TenantRefundPolicy.findOne({ tenantId });
    if (!policy) {
      policy = await TenantRefundPolicy.create({
        tenantId,
        refundDeliveryFeeWhen: 'full_order_return_only',
        refundFeePct: 100,
      });
    }
    return policy;
  }

  async updateTenantRefundPolicy({ tenantId, payload, actorId = null }) {
    const policy = await this.getTenantRefundPolicy({ tenantId });
    const { refundDeliveryFeeWhen, refundFeePct } = payload;
    if (refundDeliveryFeeWhen) policy.refundDeliveryFeeWhen = refundDeliveryFeeWhen;
    if (refundFeePct !== undefined) policy.refundFeePct = refundFeePct;
    policy.updatedBy = actorId || null;
    await policy.save();
    return policy;
  }
}

export default new PolicyAdminService();
