/**
 * Nightly ops job — cron entry for the Phase 4b maintenance pipeline.
 *
 *   node scripts/nightly-job.mjs [tenantId]
 *
 * Runs the same steps as POST /admin/maintenance/nightly against a real Mongo
 * (see .env MONGODB_URI). Without an argument it uses the default tenant
 * (config.tenant.defaultTenantId, falling back to the first active tenant).
 * Idempotent — safe to run every night; duplicate export jobs are never created.
 *
 * Suggested cron:  0 2 * * *  cd /path/to/flower-market-backend && node scripts/nightly-job.mjs >> /var/log/flower-nightly.log 2>&1
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import config from '../src/config/index.js';
import Tenant from '../src/models/tenant.model.js';

// Phase 4b + dependency models need indexes before queries hit them
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
];

async function main() {
  await connectDb();
  for (const f of MODEL_FILES) {
    await (await import(`../src/models/${f}`)).default.init();
  }

  const argTenant = process.argv[2];
  let tenantId = argTenant || config.tenant.defaultTenantId;
  if (!tenantId) {
    const first = await Tenant.findOne({ status: 'active' }).lean();
    if (!first) throw new Error('No active tenant found — seed first');
    tenantId = first._id;
  }

  const { default: maintenanceService } = await import('../src/services/maintenance.service.js');
  const started = Date.now();
  const result = await maintenanceService.nightly({ tenantId });
  // eslint-disable-next-line no-console
  console.log(`[nightly] tenant=${tenantId} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));

  // ---- Phase 5: platform-wide marketplace pass (billing cycle, rollups) ----
  const mpStarted = Date.now();
  const mpResult = await maintenanceService.marketplaceNightly({});
  // eslint-disable-next-line no-console
  console.log(`[nightly] marketplace pass in ${((Date.now() - mpStarted) / 1000).toFixed(1)}s`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(mpResult, null, 2));

  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('[nightly] FAILED:', err?.message || err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
