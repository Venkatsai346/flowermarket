import DeliveryFeePolicy from '../models/deliveryFeePolicy.model.js';
import TaxPolicy from '../models/taxPolicy.model.js';
import DiscountPolicy from '../models/discountPolicy.model.js';
import CouponUsage from '../models/couponUsage.model.js';
import OrderChargeBreakdown from '../models/orderChargeBreakdown.model.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { roundMoney, moneySum, toPaise, fromPaise } from '../utils/money.js';
import { computeLineTax } from '../utils/gst.js';
import config from '../config/index.js';

/** HSN default when a category has no TaxPolicy row (legal fallback). */
const DEFAULT_GST_SLAB_PCT = 0;

/**
 * PricingPolicyService — the per-tenant delivery-fee / tax / discount engine
 * (blueprint §2). Replaces the hardcoded `deliveryFee = 49`.
 *
 * computeOrderCharges() returns a full breakdown:
 *   { itemSubtotal, deliveryFee, taxTotal, discountTotal, grandTotal, lineItems[] }
 * where each lineItem carries { taxAmount, discountAllocated, taxPolicyId, hsnCode }.
 * The line-level numbers are what get persisted on OrderItem (never recomputed)
 * and are the basis for correct per-item refunds (§5).
 *
 * The whole breakdown is persisted as an immutable OrderChargeBreakdown row —
 * historical orders must keep showing what the customer was ACTUALLY charged,
 * even if the tenant's policy changes tomorrow.
 */
class PricingPolicyService {
  /**
   * @param {object} p
   * @param {string} p.tenantId
   * @param {number} p.cartSubtotal       Σ lineTotal (snapshot) — pre-discount, pre-tax
   * @param {Array}  p.items              cart items with { tenantProductId, productMasterId, qty, lineTotal, priceSnapshot }
   * @param {string} [p.slotType]         DeliverySlot.windowType (normal|express|...)
   * @param {number} [p.zoneDistanceKm]   hub→address distance (for zone pricing)
   * @param {string} [p.couponCode]       applied coupon (null = none)
   * @param {string} [p.userId]           for per-customer usage caps
   * @returns {Promise<{ itemSubtotal, deliveryFee, taxTotal, discountTotal, grandTotal, lineItems, deliveryFeePolicyId, discountPolicyId }>}
   */
  async computeOrderCharges({ tenantId, cartSubtotal, items = [], slotType = 'normal', zoneDistanceKm = null, couponCode = null, userId = null }) {
    const itemSubtotal = roundMoney(cartSubtotal || 0);

    // ---- 1. delivery fee from the ACTIVE tenant policy ----
    const feePolicy = await DeliveryFeePolicy.findOne({ tenantId, isActive: true }).lean();
    const deliveryFee = this.computeDeliveryFee({
      policy: feePolicy,
      cartSubtotal: itemSubtotal,
      slotType,
      zoneDistanceKm,
    });

    // ---- 2. lines + category tax policies (batched) ----
    const pricesInclusive = config.tax.pricesInclusive !== false;
    const uniqueCats = [...new Set(items.map((i) => i.categoryId).filter(Boolean))];
    const policies = uniqueCats.length
      ? await TaxPolicy.find({ categoryId: { $in: uniqueCats }, isActive: true }).lean()
      : [];
    const policyByCat = new Map(policies.map((p) => [String(p.categoryId), p]));

    const lineItems = items.map((item) => {
      const price = item.priceSnapshot?.sellingPrice ?? 0;
      const lineTotal = roundMoney(price * item.qty);
      const taxPolicy = item.categoryId ? policyByCat.get(String(item.categoryId)) : null;
      return {
        tenantProductId: item.tenantProductId,
        productMasterId: item.productMasterId,
        qty: item.qty,
        lineTotal,
        taxAmount: 0,
        discountAllocated: 0,
        taxPolicyId: taxPolicy?._id || null,
        hsnCode: taxPolicy?.hsnCode || null,
        gstSlabPct: taxPolicy?.gstSlabPct ?? DEFAULT_GST_SLAB_PCT,
      };
    });

    // ---- 3. discount from the applied coupon (validated again here; the
    //      cart validated it at apply-time, this is the money moment) ----
    let discountTotal = 0;
    let discountPolicyId = null;
    if (couponCode) {
      const applied = await this.applyCoupon({ tenantId, code: couponCode, userId, cartSubtotal: itemSubtotal });
      discountTotal = applied.discountAmount;
      discountPolicyId = applied.coupon._id;
    }

    // allocate discount proportionally across lines by price weight
    this.allocateDiscount(lineItems, discountTotal);

    // ---- 4. GST per line via the integer-paise engine ----
    // Inclusive (India MRP, default): tax is EXTRACTED from the shelf price
    // after discount. Exclusive (flag off): tax is added on top of the pre-
    // discount line, which is the legacy Phase 3.5 behaviour.
    const state = config.tax.defaultStateCode;
    for (const line of lineItems) {
      const rateBps = Math.round((line.gstSlabPct || 0) * 100);
      if (pricesInclusive) {
        const computed = computeLineTax({
          grossPaise: toPaise(line.lineTotal),
          discountPaise: toPaise(line.discountAllocated || 0),
          rateBps,
          natureOfSupply: rateBps > 0 ? 'taxable' : 'nil_rated',
          supplierStateCode: state,
          placeOfSupplyStateCode: state,
          pricesInclusive: true,
        });
        line.taxAmount = fromPaise(computed.totalTaxPaise);
      } else {
        line.taxAmount = roundMoney(line.lineTotal * ((line.gstSlabPct || 0) / 100));
      }
      delete line.gstSlabPct;
    }

    const taxTotal = roundMoney(moneySum(...lineItems.map((l) => l.taxAmount)));
    const grandTotal = pricesInclusive
      ? roundMoney(itemSubtotal - discountTotal + deliveryFee)
      : roundMoney(itemSubtotal + taxTotal - discountTotal + deliveryFee);

    return {
      itemSubtotal,
      deliveryFee,
      taxTotal,
      discountTotal,
      grandTotal,
      pricesInclusive,
      lineItems,
      deliveryFeePolicyId: feePolicy?._id || null,
      discountPolicyId,
    };
  }

  /** Delivery fee formula (blueprint §2 flowchart). */
  computeDeliveryFee({ policy, cartSubtotal, slotType, zoneDistanceKm }) {
    if (!policy) return 49; // legacy fallback (no tenant policy configured)
    if (policy.freeDeliveryThreshold != null && cartSubtotal >= policy.freeDeliveryThreshold) {
      return 0;
    }
    let fee = policy.baseFee ?? 0;
    if (slotType === 'express') fee *= policy.expressSurgeMultiplier ?? 1;
    if ((policy.distanceFeePerKm ?? 0) > 0 && zoneDistanceKm != null) {
      fee += (policy.distanceFeePerKm * zoneDistanceKm);
    }
    return roundMoney(fee);
  }

  /** Proportionally split discountTotal across lines by pre-discount price weight. */
  allocateDiscount(lineItems, discountTotal) {
    if (discountTotal <= 0) return;
    const subtotal = moneySum(...lineItems.map((l) => l.lineTotal));
    if (subtotal <= 0) return;
    let allocated = 0;
    lineItems.forEach((line, idx) => {
      const share = (idx === lineItems.length - 1)
        ? discountTotal - allocated // last line absorbs rounding
        : roundMoney(discountTotal * (line.lineTotal / subtotal));
      line.discountAllocated = share;
      allocated += share;
    });
  }

  /** Validate + apply a coupon; enforces min-cart-value, cap, dates, per-user limit. */
  async applyCoupon({ tenantId, code, userId, cartSubtotal }) {
    if (!code) throw badRequest('Coupon code required', 'COUPON_REQUIRED');
    const coupon = await DiscountPolicy.findOne({
      $or: [{ tenantId, code: code.toUpperCase() }, { tenantId: null, code: code.toUpperCase() }],
      isActive: true,
    });
    if (!coupon) throw badRequest('Invalid coupon code', 'COUPON_INVALID');

    const now = new Date();
    if (coupon.validFrom && now < coupon.validFrom) throw badRequest('Coupon not yet valid', 'COUPON_NOT_VALID_YET');
    if (coupon.validTo && now > coupon.validTo) throw badRequest('Coupon expired', 'COUPON_EXPIRED');
    if (coupon.status !== 'active') throw badRequest('Coupon is inactive', 'COUPON_INACTIVE');
    if (cartSubtotal < (coupon.minCartValue || 0)) {
      throw badRequest(`Minimum cart value ₹${coupon.minCartValue} required`, 'COUPON_MIN_CART_NOT_MET');
    }

    if (coupon.usageLimitPerCustomer && userId) {
      const used = await CouponUsage.countDocuments({ couponId: coupon._id, userId });
      if (used >= coupon.usageLimitPerCustomer) {
        throw badRequest('Coupon usage limit reached', 'COUPON_USAGE_LIMIT');
      }
    }

    let discount = coupon.discountType === 'percent'
      ? (cartSubtotal * coupon.value) / 100
      : coupon.value;
    if (coupon.maxDiscountCap != null) discount = Math.min(discount, coupon.maxDiscountCap);
    discount = roundMoney(Math.max(0, discount));

    return { coupon, discountAmount: discount };
  }

  /** Persist the immutable charge breakdown for an order. */
  async persistChargeBreakdown({ orderId, tenantId, charges, createdBy = null }) {
    const dual = config.money.dualWritePaise !== false;
    return OrderChargeBreakdown.create({
      orderId, tenantId,
      itemSubtotal: charges.itemSubtotal,
      deliveryFee: charges.deliveryFee,
      taxTotal: charges.taxTotal,
      discountTotal: charges.discountTotal,
      grandTotal: charges.grandTotal,
      ...(dual ? {
        itemSubtotalPaise: toPaise(charges.itemSubtotal),
        deliveryFeePaise: toPaise(charges.deliveryFee),
        taxTotalPaise: toPaise(charges.taxTotal),
        discountTotalPaise: toPaise(charges.discountTotal),
        grandTotalPaise: toPaise(charges.grandTotal),
      } : {}),
      currency: 'INR',
      deliveryFeePolicyId: charges.deliveryFeePolicyId || null,
      discountPolicyId: charges.discountPolicyId || null,
      couponCode: charges.couponCode || null,
      pricesInclusive: charges.pricesInclusive !== false,
      createdBy,
    });
  }

  /** Record one coupon redemption (dedupe on couponId+orderId). */
  async recordCouponUsage({ couponId, tenantId, userId, orderId, discountAmount, couponCode }) {
    if (!couponId) return null;
    try {
      return await CouponUsage.create({ couponId, tenantId, userId, orderId, discountAmount, couponCode });
    } catch (err) {
      // unique (couponId, orderId) — already recorded; harmless
      return null;
    }
  }

  /** Active coupon value for a cart (used by the cart/coupon endpoints). */
  async previewCoupon({ tenantId, code, userId, cartSubtotal }) {
    const { coupon, discountAmount } = await this.applyCoupon({ tenantId, code, userId, cartSubtotal });
    return { couponId: coupon._id, code: coupon.code, discountType: coupon.discountType, value: coupon.value, discountAmount };
  }

  /** Resolve the active delivery-fee policy (ops view). */
  async getActiveDeliveryFeePolicy({ tenantId }) {
    const policy = await DeliveryFeePolicy.findOne({ tenantId, isActive: true });
    if (!policy) throw notFound('No active delivery fee policy', 'FEE_POLICY_NOT_FOUND');
    return policy;
  }
}

export default new PricingPolicyService();
