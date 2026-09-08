import DeliveryFeePolicy from '../models/deliveryFeePolicy.model.js';
import TaxPolicy from '../models/taxPolicy.model.js';
import DiscountPolicy from '../models/discountPolicy.model.js';
import CouponUsage from '../models/couponUsage.model.js';
import OrderChargeBreakdown from '../models/orderChargeBreakdown.model.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { roundMoney, moneySum, toPaise, fromPaise, allocatePaise } from '../utils/money.js';
import { computeLineTax } from '../utils/gst.js';
import { pricingFallback } from '../observability/registry.js';
import config from '../config/index.js';

/** HSN default when a category has no TaxPolicy row (legal fallback). */
const DEFAULT_GST_SLAB_PCT = 0;

/**
 * Tenants already warned about pricing on a platform default. Bounded by tenant
 * count and process lifetime, so it cannot grow without limit; its only job is
 * to keep a busy store from writing the same line to the log on every order.
 */
const warnedNoFeePolicy = new Set();
const warnedNoTaxPolicy = new Set();

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
      tenantId,
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

      // No TaxPolicy for this category → nil-rated (0%), which is a LEGAL
      // declaration rather than a safe default: most flowers and gifts are
      // taxable. Count and warn so a store silently issuing zero-GST invoices is
      // visible instead of surfacing later as a tax notice. Onboarding lists it
      // as a (non-blocking) warning for the same reason.
      if (!taxPolicy && item.categoryId) {
        pricingFallback.inc({ kind: 'tax_policy' });
        const key = `${tenantId}:${item.categoryId}`;
        if (!warnedNoTaxPolicy.has(key)) {
          warnedNoTaxPolicy.add(key);
          console.warn(
            `[pricing] tenant ${tenantId} has no active TaxPolicy for category `
            + `${item.categoryId} — treating it as nil-rated (0% GST). Add the slab `
            + 'and HSN code, or these invoices declare no tax.'
          );
        }
      }

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

  /**
   * Delivery fee formula (blueprint §2 flowchart).
   *
   * When the tenant has NO active policy this used to `return 49` — a literal in
   * the very file whose header announces that it "Replaces the hardcoded
   * deliveryFee = 49". So the first fee a self-registered merchant's customers
   * paid was a magic number nobody chose, visible on no admin page and mentioned
   * in no document. It is now configured, defaults to ZERO (never surprise-charge
   * a real customer with a number the merchant did not set), counted in
   * `fm_pricing_fallback_total{kind="delivery_fee"}`, and warned about once per
   * tenant per process. Onboarding readiness also flags it as blocking, so a
   * store cannot publish while relying on it.
   */
  computeDeliveryFee({ policy, cartSubtotal, slotType, zoneDistanceKm, tenantId = null }) {
    if (!policy) {
      pricingFallback.inc({ kind: 'delivery_fee' });
      const key = tenantId ? String(tenantId) : 'unknown';
      if (!warnedNoFeePolicy.has(key)) {
        warnedNoFeePolicy.add(key);
        console.warn(
          `[pricing] tenant ${key} has no active DeliveryFeePolicy — charging the `
          + `platform fallback of ₹${config.onboarding.fallbackDeliveryFee}. `
          + 'Set a policy in the admin console; onboarding treats this as blocking.'
        );
      }
      return roundMoney(config.onboarding.fallbackDeliveryFee);
    }
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

  /**
   * Proportionally split discountTotal across lines by pre-discount price weight.
   *
   * Routed through `allocatePaise` — the same largest-remainder integer split the
   * ledger, payouts, GST documents and refunds all use. This used to hand-roll
   * "the last line absorbs the rounding", which is the exact algorithm
   * `utils/money.js` says it REPLACES, and which has two concrete faults:
   *
   *   • BIAS. Every order's rounding residue landed on the final line, so one
   *     line systematically carried a paisa more (or less) discount than its
   *     share. Largest-remainder gives it to whoever is mathematically closest
   *     to being owed it, ties broken by index.
   *   • NEGATIVE SHARES. The last line was assigned `discountTotal - allocated`
   *     with no floor. If the earlier `roundMoney()` calls over-allocated — easy
   *     when the last line is a ₹0 freebie or an add-on — that line received a
   *     NEGATIVE discount, inflating its taxable base. `allocatePaise` clamps
   *     zero weights to zero and keeps every part the same sign as the total.
   *
   * Totals still reconcile exactly, as before: the split is exact by
   * construction, so Σ discountAllocated === discountTotal to the paisa, and the
   * per-line values persisted on OrderItem (which the tax, invoice, refund and
   * payout layers reconstruct from rather than re-deriving) stay consistent with
   * a paise re-derivation of the same line.
   */
  allocateDiscount(lineItems, discountTotal) {
    if (!(Number(discountTotal) > 0)) return;
    const subtotal = moneySum(...lineItems.map((l) => l.lineTotal));
    if (subtotal <= 0) return;

    const sharesPaise = allocatePaise(
      toPaise(discountTotal),
      lineItems.map((l) => toPaise(l.lineTotal)),
    );

    // same length as lineItems by contract; the ?? 0 keeps a future change to
    // allocatePaise from silently leaving a line un-discounted
    lineItems.forEach((line, idx) => {
      line.discountAllocated = fromPaise(sharesPaise[idx] ?? 0);
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
