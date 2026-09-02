import TenantRefundPolicy from '../models/tenantRefundPolicy.model.js';
import { notFound } from '../utils/ApiError.js';

/**
 * RefundCalculatorService — the blueprint §5 fix.
 *
 * With per-item tax_amount/discount_allocated persisted at order time (Phase
 * 3.5), a refund is a LOOKUP, not a recomputation against possibly-changed
 * policy:
 *
 *   refundItemAmount = Σ over returned lines of (price − discountAllocated) × qty
 *                      (NET goods value — tax is NOT folded in; it gets its
 *                      own component so a GST credit note can show it)
 *   refundTaxAmount  = Σ over returned lines of taxAmount            (credit-note line)
 *   refundFeeAmount  = deliveryFee × refundFeePct  IF TenantRefundPolicy triggers it
 *   totalRefund      = refundItemAmount + refundTaxAmount + refundFeeAmount
 *
 * The fee decision is explicit policy (NEVER / FULL_ORDER_RETURN_ONLY / ALWAYS),
 * never a silent default — the delivery physically happened, whether to refund
 * it is a genuine business call.
 */
class RefundCalculatorService {
  /**
   * @param {object} p
   * @param {string} p.tenantId
   * @param {string} p.orderId
   * @param {Array}  p.returnedOrderItems  OrderItem docs (lean ok) that passed QC
   * @param {number} p.deliveryFee         the order's persisted delivery fee
   * @param {number} p.orderGrandTotal     the order's persisted grand total
   * @returns {Promise<{ refundItemAmount, refundTaxAmount, refundFeeAmount, totalRefund }>}
   */
  async compute({ tenantId, orderId, returnedOrderItems, deliveryFee = 0, orderGrandTotal = 0 }) {
    const policy = await TenantRefundPolicy.findOne({ tenantId }).lean()
      || { refundDeliveryFeeWhen: 'full_order_return_only', refundFeePct: 100 };

    // ---- per-item components (persisted at order time) ----
    let refundItemAmount = 0;
    let refundTaxAmount = 0;
    for (const line of returnedOrderItems) {
      const price = line.priceAtOrder?.sellingPrice ?? 0;
      const qty = line.returnedQtyTotal ?? 1; // caller passes requested qty
      // per-unit price minus per-unit discount (tax tracked separately below)
      const unitItem = round2(price - (line.discountAllocatedPerUnit || 0));
      refundItemAmount = round2(refundItemAmount + unitItem * qty);
      refundTaxAmount = round2(refundTaxAmount + (line.taxPerUnit || 0) * qty);
    }

    // ---- fee decision: is this a FULL return? ----
    const { isFullReturn, totalDeliveredQty, returnedQty } = this.fullReturnCheck(returnedOrderItems);
    const refundFeeWhen = policy.refundDeliveryFeeWhen;
    const feeEligible = refundFeeWhen === 'always'
      || (refundFeeWhen === 'full_order_return_only' && isFullReturn);
    let refundFeeAmount = 0;
    if (feeEligible && deliveryFee > 0) {
      refundFeeAmount = round2(deliveryFee * (policy.refundFeePct ?? 100) / 100);
    }

    const totalRefund = round2(refundItemAmount + refundTaxAmount + refundFeeAmount);
    return { refundItemAmount, refundTaxAmount, refundFeeAmount, totalRefund };
  }

  /**
   * Full-return detection. The caller passes the order's TOTAL items (so we
   * can compare against what was delivered); returnedOrderItems are the
   * returned subset.
   */
  fullReturnCheck(returnedOrderItems) {
    // caller may include orderItems with returnedQtyTotal and a flag
    const all = returnedOrderItems;
    const totalDeliveredQty = all.reduce((s, l) => s + (l.qty || 0), 0);
    const returnedQty = all.reduce((s, l) => s + (l.returnedQtyTotal || 0), 0);
    const isFullReturn = totalDeliveredQty > 0 && returnedQty >= totalDeliveredQty;
    return { isFullReturn, totalDeliveredQty, returnedQty };
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

export default new RefundCalculatorService();
