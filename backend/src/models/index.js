/**
 * Barrel export for all models.
 * Import models from here: `import { User, Address } from '../models/index.js'`
 */

export { default as User } from './user.model.js';
export { default as Tenant } from './tenant.model.js';
export { default as TenantAuthConfig } from './tenantAuthConfig.model.js';
export { default as Address } from './address.model.js';
export { default as OtpVerification } from './otpVerification.model.js';
export { default as AuthToken } from './authToken.model.js';
export { default as Location } from './location.model.js';
export { default as ServiceablePincode } from './serviceablePincode.model.js';
export { default as DeliveryZone } from './deliveryZone.model.js';
export { default as DeliverySlot } from './deliverySlot.model.js';
export { default as Vendor } from './vendor.model.js';

// ---- Catalog (Phase 2) ----
export { default as Category } from './category.model.js';
export { default as Brand } from './brand.model.js';
export { default as ProductMaster } from './productMaster.model.js';
export { default as ProductVariant } from './productVariant.model.js';
export { default as ProductImage } from './productImage.model.js';
export { default as ProductAttributeValue } from './productAttributeValue.model.js';
export { default as TenantProduct } from './tenantProduct.model.js';
export { default as PriceHistory } from './priceHistory.model.js';
export { default as Inventory } from './inventory.model.js';
export { default as ProductChangeRequest } from './productChangeRequest.model.js';
export { default as AuditLog } from './auditLog.model.js';
export { default as CatalogEvent } from './catalogEvent.model.js';

// ---- Order lifecycle (Phase 3) ----
export { default as Hub } from './hub.model.js';
export { default as Cart } from './cart.model.js';
export { default as CartItem } from './cartItem.model.js';
export { default as SlotReservation } from './slotReservation.model.js';
export { default as Order } from './order.model.js';
export { default as OrderItem } from './orderItem.model.js';
export { default as OrderStatusHistory } from './orderStatusHistory.model.js';
export { default as Payment } from './payment.model.js';
export { default as PaymentTransaction } from './paymentTransaction.model.js';
export { default as Wallet } from './wallet.model.js';
export { default as WalletTransaction } from './walletTransaction.model.js';
export { default as ReturnRequest } from './returnRequest.model.js';
export { default as ReturnItem } from './returnItem.model.js';
export { default as RefundTransaction } from './refundTransaction.model.js';
export { default as FulfillmentTask } from './fulfillmentTask.model.js';
export { default as DeliveryAssignment } from './deliveryAssignment.model.js';

// ---- Phase 3.5: pricing policies, charge breakdown, forecasting ----
export { default as DeliveryFeePolicy } from './deliveryFeePolicy.model.js';
export { default as TaxPolicy } from './taxPolicy.model.js';
export { default as DiscountPolicy } from './discountPolicy.model.js';
export { default as CouponUsage } from './couponUsage.model.js';
export { default as OrderChargeBreakdown } from './orderChargeBreakdown.model.js';
export { default as TenantRefundPolicy } from './tenantRefundPolicy.model.js';
export { default as FulfillmentTimeLog } from './fulfillmentTimeLog.model.js';

// ---- Phase 4: admin dashboard ----
export { default as InventoryAdjustment } from './inventoryAdjustment.model.js';
export { default as AnalyticsDaily } from './analyticsDaily.model.js';

// ---- Phase 4b: notifications & exports ----
export { default as Device } from './device.model.js';
export { default as NotificationTemplate } from './notificationTemplate.model.js';
export { default as Notification } from './notification.model.js';
export { default as ExportJob } from './exportJob.model.js';
export { default as ExportArtifact } from './exportArtifact.model.js';

// ---- Phase 5: multi-tenant marketplace ----
export { default as Plan } from './plan.model.js';
export { default as Subscription } from './subscription.model.js';
export { default as Invoice } from './invoice.model.js';
export { default as VendorApplication } from './vendorApplication.model.js';
export { default as PlatformDaily } from './platformDaily.model.js';
export { default as Counter } from './counter.model.js';
export { default as MediaAsset } from './mediaAsset.model.js';

// ---- Phase 6.1: financial ledger (double-entry) ----
export { default as LedgerAccount } from './ledgerAccount.model.js';
export { default as LedgerJournal } from './ledgerJournal.model.js';
export { default as LedgerEntry } from './ledgerEntry.model.js';
export { default as AccountBalance } from './accountBalance.model.js';

// ---- Phase 6.2: GST / tax invoicing ----
export { default as TaxRegistration } from './taxRegistration.model.js';
export { default as StatutoryRate } from './statutoryRate.model.js';
export { default as TaxDocumentSeries } from './taxDocumentSeries.model.js';
export { default as TaxDocument } from './taxDocument.model.js';

// ---- Phase 6.3: vendor payouts ----
export { default as PayoutPolicy } from './payoutPolicy.model.js';
export { default as VendorPayoutAccount } from './vendorPayoutAccount.model.js';
export { default as PayoutLineItem } from './payoutLineItem.model.js';
export { default as PayoutBatch } from './payoutBatch.model.js';
export { default as PayoutStatusHistory } from './payoutStatusHistory.model.js';
export { default as PayoutAdjustment } from './payoutAdjustment.model.js';

// ---- Phase 6.4: domain routing ----
export { default as TenantDomain } from './tenantDomain.model.js';

// ---- Phase 6.5: search ----
export { default as SearchDocument } from './searchDocument.model.js';
export { default as RankingProfile } from './rankingProfile.model.js';
export { default as SearchSynonym } from './searchSynonym.model.js';
export { default as SearchQueryLog } from './searchQueryLog.model.js';
