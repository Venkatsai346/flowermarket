/**
 * MODEL_FILES — every Mongoose model in the app, in one place.
 *
 * Used to `init()` (build) indexes before queries hit them:
 *  - `scripts/nightly-job.mjs` (standalone cron entry)
 *  - `src/worker.js` (worker runtime)
 * Both connect a bare mongoose instance that the API process never inits,
 * so indexes (TTL, compound query indexes) must be materialised explicitly.
 */

const MODEL_FILES = [
  'tenant.model.js', 'tenantAuthConfig.model.js', 'user.model.js', 'category.model.js', 'brand.model.js',
  'productMaster.model.js', 'tenantProduct.model.js', 'inventory.model.js', 'address.model.js', 'hub.model.js',
  'serviceablePincode.model.js', 'deliverySlot.model.js', 'slotReservation.model.js', 'cart.model.js', 'cartItem.model.js',
  'order.model.js', 'orderItem.model.js', 'orderStatusHistory.model.js', 'payment.model.js', 'paymentTransaction.model.js',
  'refundTransaction.model.js', 'wallet.model.js', 'walletTransaction.model.js', 'returnRequest.model.js', 'returnItem.model.js',
  'fulfillmentTask.model.js', 'deliveryAssignment.model.js', 'deliveryFeePolicy.model.js', 'taxPolicy.model.js',
  'discountPolicy.model.js', 'couponUsage.model.js', 'orderChargeBreakdown.model.js', 'tenantRefundPolicy.model.js',
  'fulfillmentTimeLog.model.js', 'auditLog.model.js', 'catalogEvent.model.js',
  'inventoryAdjustment.model.js', 'analyticsDaily.model.js',
  'device.model.js', 'notificationTemplate.model.js', 'notification.model.js', 'exportJob.model.js', 'exportArtifact.model.js',
  // ---- Phase 5 ----
  'plan.model.js', 'subscription.model.js', 'invoice.model.js', 'vendorApplication.model.js', 'vendor.model.js',
  'platformDaily.model.js', 'counter.model.js',
  // ---- worker runtime ----
  'scheduledJob.model.js',
  // ---- payments ----
  'paymentWebhookEvent.model.js',
  // ---- Phase 6.1/6.3: ledger + payouts (their unique idempotencyKey indexes
  //      are the exactly-once backbone — they must be materialised in the
  //      worker/nightly context, not only the API) ----
  'ledgerAccount.model.js', 'ledgerJournal.model.js', 'ledgerEntry.model.js', 'accountBalance.model.js',
  'payoutPolicy.model.js', 'vendorPayoutAccount.model.js', 'payoutLineItem.model.js',
  'payoutBatch.model.js', 'payoutStatusHistory.model.js', 'payoutAdjustment.model.js',
  // ---- observability ----
  'systemHeartbeat.model.js',
  // ---- Phase 10: money audit backbone ----
  'domainEvent.model.js',
  // ---- Phase 11: tamper-evident audit chain + fiscal periods ----
  'auditChain.model.js',
  'fiscalPeriod.model.js',
  // ---- Phase 13: statutory deposits (TCS/TDS to the government) ----
  'statutoryDeposit.model.js',
  // ---- Phase 14: bank statement reconciliation (egress truth) ----
  'bankStatementLine.model.js',
];

export default MODEL_FILES;
