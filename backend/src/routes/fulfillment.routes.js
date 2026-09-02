import { Router } from 'express';
import OpsController from '../controllers/ops.controller.js';
import PaymentController from '../controllers/payment.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  deliverSchema,
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
router.post('/orders/:id/pick', authorize(...PICK_ROLES), OpsController.startPicking);
router.post('/orders/:id/pack', authorize(...PICK_ROLES), OpsController.markPacked);

// ---- delivery ----
router.post('/orders/:id/dispatch', authorize(...RIDER_ROLES), OpsController.dispatch);
router.post('/orders/:id/deliver', authorize(...RIDER_ROLES), validate(deliverSchema), OpsController.deliver);
router.post('/orders/:id/delivery-failed', authorize(...RIDER_ROLES), OpsController.deliveryFailed);
router.post('/orders/:id/retry-delivery', authorize(...RIDER_ROLES), OpsController.retryDelivery);

// ---- slots ops ----
router.post('/slots/generate', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.generateSlots);
router.get('/slots/utilization', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.slotUtilization);
router.post('/slots/sweep', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.sweepExpiredHolds);

// ---- returns + refunds ops ----
router.get('/returns', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.listReturns);
router.get('/refunds', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.listRefunds);
router.post('/refunds', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(refundInitiateSchema), OpsController.adminRefund);

// ---- slot forecasting (admin) ----
router.post('/forecast', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.forecastHub);
router.get('/forecast/upcoming', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.forecastUpcoming);
router.get('/forecast/history', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.fulfillmentHistory);
router.post('/assignments/sweep', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.sweepExpiredAssignments);

// ---- reconciliation (admin) ----
router.post('/reconcile/payments', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), OpsController.reconcilePayments);

// ---- payments ops (admin) ----
router.get('/payments', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), PaymentController.listPayments);
router.get('/payments/:id', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), PaymentController.getPayment);

export default router;
