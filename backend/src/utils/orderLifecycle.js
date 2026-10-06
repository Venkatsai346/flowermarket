const RETURN_STATUS_PRIORITY = Object.freeze({
  requested: 10,
  approved: 20,
  picked_up: 30,
  qc_passed: 40,
  qc_failed: 45,
  rejected: 50,
  refund_rejected: 55,
  refund_initiated: 60,
  refunded: 70,
});

const LEGACY_AFTER_SALES_ORDER_STATES = new Set([
  'return_requested', 'return_approved', 'return_rejected', 'return_picked_up',
  'qc_passed', 'qc_failed', 'refund_initiated', 'refunded',
]);

/**
 * Orders have independent fulfillment, after-sales and payment lifecycles.
 * Never erase the delivery fact to represent a return; expose a composed
 * customer state while retaining all three machine states for operations.
 */
export function composeOrderLifecycle(order = {}, returns = []) {
  const fulfillmentStatus = LEGACY_AFTER_SALES_ORDER_STATES.has(order.status) ? 'delivered' : order.status;
  const sorted = [...returns].sort((a, b) =>
    (RETURN_STATUS_PRIORITY[b.status] || 0) - (RETURN_STATUS_PRIORITY[a.status] || 0)
    || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const latest = sorted[0] || null;
  const paymentStatus = order.paymentSummary?.status || 'pending';

  let afterSalesStatus = latest?.status || 'none';
  if (paymentStatus === 'refunded') afterSalesStatus = 'refunded';
  else if (paymentStatus === 'partially_refunded' && ['refunded', 'refund_initiated'].includes(afterSalesStatus)) {
    afterSalesStatus = 'partially_refunded';
  }

  const customerStatus = afterSalesStatus !== 'none' ? afterSalesStatus : fulfillmentStatus;
  return {
    fulfillment: { status: fulfillmentStatus },
    afterSales: {
      status: afterSalesStatus,
      requestCount: returns.length,
      activeCount: returns.filter((item) => !['rejected', 'qc_failed', 'refund_rejected', 'refunded'].includes(item.status)).length,
      latestRequestId: latest?._id || latest?.id || null,
      latestUpdatedAt: latest?.updatedAt || latest?.createdAt || null,
    },
    payment: {
      status: paymentStatus,
      refundedAmount: Number(order.paymentSummary?.refundedAmount || 0),
    },
    customerStatus,
  };
}
