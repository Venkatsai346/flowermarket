import { Router } from 'express';
import Joi from 'joi';
import OpsController from '../controllers/ops.controller.js';
import PaymentController from '../controllers/payment.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  deliverSchema,
  deliveryFailedSchema,
  emptyMutationSchema,
  forecastBodySchema,
  generateSlotsSchema,
  mockForcePendingSchema,
  codCollectSchema,
  codDepositSchema,
  orderListQuerySchema,
  refundInitiateSchema,
} from '../utils/validators/order.validators.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();
router.use(authenticate);

/**
 * /fulfillment — warehouse + logistics + ops.
 *  - picking: PICKER / ADMIN
 *  - delivery: RIDER / ADMIN
 *  - slots ops: ADMIN (capacity comes from forecasting; we only enforce it)
 *  - refunds: ADMIN
 */
const PICK_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.PICKER];
const RIDER_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.RIDER];
const objectId = Joi.string().hex().length(24);
const allocationPolicySchema = Joi.object({
  strategy: Joi.string().valid('service_hub', 'nearest_available', 'priority_then_distance'),
  splitPolicy: Joi.string().valid('never', 'allow'),
  reserveSafetyStock: Joi.number().integer().min(0).max(100000),
  allowLegacyDefaultStock: Joi.boolean(),
  requirePincodeForPromise: Joi.boolean(),
  maxCandidateHubs: Joi.number().integer().min(1).max(50),
  defaultHandlingMinutes: Joi.number().integer().min(0).max(10080),
  expectedVersion: Joi.number().integer().min(1).allow(null),
}).min(1);
const transferSchema = Joi.object({
  idempotencyKey: Joi.string().trim().min(8).max(128),
  fromHubId: objectId.required(), toHubId: objectId.required(),
  items: Joi.array().items(Joi.object({
    tenantProductId: objectId.required(), qty: Joi.number().integer().min(1).max(100000).required(),
  })).min(1).max(200).required(),
});
const transferParams = Joi.object({ transferId: objectId.required() });
const transferListQuery = Joi.object({ limit: Joi.number().integer().min(1).max(200).default(50) });
const reservationListQuery = Joi.object({
  status: Joi.string().valid('allocating', 'active', 'confirmed', 'releasing', 'released', 'expired', 'failed'),
  limit: Joi.number().integer().min(1).max(500).default(100),
});
const reservationSweepSchema = Joi.object({ limit: Joi.number().integer().min(1).max(1000).default(100) });
const reservationReconcileSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(2000).default(200), repair: Joi.boolean().default(false),
});
const availabilityParams = Joi.object({ listingId: objectId.required() });
const availabilityQuery = Joi.object({
  pincode: Joi.string().pattern(/^\d{6}$/), hubId: objectId,
});

// ---- order ops ----
router.get('/orders', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(orderListQuerySchema, 'query'), OpsController.listAll);

// ---- shipment-scoped execution (required for multi-shipment orders) ----
router.post('/orders/:id/shipments/:shipmentId/pick', authorize(...PICK_ROLES), validate(emptyMutationSchema), OpsController.startShipmentPicking);
router.post('/orders/:id/shipments/:shipmentId/pack', authorize(...PICK_ROLES), validate(emptyMutationSchema), OpsController.packShipment);
router.post('/orders/:id/shipments/:shipmentId/dispatch', authorize(...RIDER_ROLES), validate(emptyMutationSchema), OpsController.dispatchShipment);
router.post('/orders/:id/shipments/:shipmentId/deliver', authorize(...RIDER_ROLES), validate(deliverSchema), OpsController.deliverShipment);
router.post('/orders/:id/shipments/:shipmentId/delivery-failed', authorize(...RIDER_ROLES), validate(deliveryFailedSchema), OpsController.failShipmentDelivery);
router.post('/orders/:id/shipments/:shipmentId/retry-delivery', authorize(...RIDER_ROLES), validate(emptyMutationSchema), OpsController.dispatchShipment);
router.post('/orders/:id/shipments/:shipmentId/return-to-origin', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(emptyMutationSchema), OpsController.startShipmentReturn);
router.post('/orders/:id/shipments/:shipmentId/return-to-origin/complete', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(emptyMutationSchema), OpsController.completeShipmentReturn);
router.post('/orders/:id/shipments/:shipmentId/cancel', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(deliveryFailedSchema), OpsController.cancelShipment);

// ---- picking (legacy single-shipment compatibility) ----
router.post('/orders/:id/pick', authorize(...PICK_ROLES), validate(emptyMutationSchema), OpsController.startPicking);
router.post('/orders/:id/pack', authorize(...PICK_ROLES), validate(emptyMutationSchema), OpsController.markPacked);

// ---- delivery ----
router.post('/orders/:id/dispatch', authorize(...RIDER_ROLES), validate(emptyMutationSchema), OpsController.dispatch);
router.post('/orders/:id/deliver', authorize(...RIDER_ROLES), validate(deliverSchema), OpsController.deliver);
router.post('/orders/:id/delivery-failed', authorize(...RIDER_ROLES), validate(deliveryFailedSchema), OpsController.deliveryFailed);
router.post('/orders/:id/retry-delivery', authorize(...RIDER_ROLES), validate(emptyMutationSchema), OpsController.retryDelivery);

// ---- split-shipment reconciliation / operational metrics ----
router.post('/shipments/reconcile', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(reservationReconcileSchema), OpsController.reconcileShipments);

// ---- multi-warehouse allocation ----
router.get('/warehouses/policy', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.allocationPolicy);
router.put('/warehouses/policy', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(allocationPolicySchema), OpsController.saveAllocationPolicy);
router.get('/warehouses/listings/:listingId/availability', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(availabilityParams, 'params'), validate(availabilityQuery, 'query'), OpsController.warehouseAvailability);
router.get('/warehouses/reservations', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(reservationListQuery, 'query'), OpsController.inventoryReservations);
router.post('/warehouses/reservations/sweep', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(reservationSweepSchema), OpsController.sweepInventoryReservations);
router.post('/warehouses/reservations/reconcile', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(reservationReconcileSchema), OpsController.reconcileInventoryReservations);
router.get('/warehouses/transfers', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(transferListQuery, 'query'), OpsController.listWarehouseTransfers);
router.get('/warehouses/transfers/:transferId', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(transferParams, 'params'), OpsController.warehouseTransfer);
router.post('/warehouses/transfers', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(transferSchema), OpsController.transferStock);

// ---- slots ops ----
router.post('/slots/generate', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(generateSlotsSchema), OpsController.generateSlots);
router.get('/slots/utilization', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.slotUtilization);
router.post('/slots/sweep', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.sweepExpiredHolds);

// ---- returns + refunds ops ----
router.get('/returns', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.listReturns);
router.get('/refunds', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.listRefunds);
router.post('/refunds', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(refundInitiateSchema), OpsController.adminRefund);

// ---- slot forecasting (admin) ----
router.post('/forecast', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(forecastBodySchema), OpsController.forecastHub);
router.get('/forecast/upcoming', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.forecastUpcoming);
router.get('/forecast/history', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.fulfillmentHistory);
router.post('/assignments/sweep', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.sweepExpiredAssignments);

// ---- reconciliation (admin) ----
router.post('/reconcile/payments', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.reconcilePayments);

// ---- payments ops (admin) ----
router.get('/payments', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), PaymentController.listPayments);
// NOTE: must be declared BEFORE /payments/:id or 'webhook-events' matches :id
router.get('/payments/webhook-events', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), PaymentController.listWebhookEvents);
// ---- cash on delivery ops (admin) ----
// NOTE: declared BEFORE /payments/:id or 'cod' would be parsed as an :id.
// `outstanding` is the exposure report ("how much of our money is on bikes?");
// collect/deposit are the two facts that move it — a rider handing cash in at
// end of shift, and finance banking it later.
router.get('/payments/cod/outstanding', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), PaymentController.codOutstanding);
router.post('/payments/:id/collect-cash', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.RIDER), validate(codCollectSchema, 'body'), PaymentController.collectCodCash);
router.post('/payments/:id/deposit-cash', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(codDepositSchema, 'body'), PaymentController.depositCodCash);
// dev-only: mock gateway sync/async toggle for exercising the pending flow
router.post('/payments/mock/force-pending', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(mockForcePendingSchema), PaymentController.mockForcePending);
router.get('/payments/:id', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), PaymentController.getPayment);

export default router;
