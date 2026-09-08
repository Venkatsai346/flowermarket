import { Router } from 'express';
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

// ---- order ops ----
router.get('/orders', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(orderListQuerySchema, 'query'), OpsController.listAll);

// ---- picking ----
router.post('/orders/:id/pick', authorize(...PICK_ROLES), validate(emptyMutationSchema), OpsController.startPicking);
router.post('/orders/:id/pack', authorize(...PICK_ROLES), validate(emptyMutationSchema), OpsController.markPacked);

// ---- delivery ----
router.post('/orders/:id/dispatch', authorize(...RIDER_ROLES), validate(emptyMutationSchema), OpsController.dispatch);
router.post('/orders/:id/deliver', authorize(...RIDER_ROLES), validate(deliverSchema), OpsController.deliver);
router.post('/orders/:id/delivery-failed', authorize(...RIDER_ROLES), validate(deliveryFailedSchema), OpsController.deliveryFailed);
router.post('/orders/:id/retry-delivery', authorize(...RIDER_ROLES), validate(emptyMutationSchema), OpsController.retryDelivery);

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
