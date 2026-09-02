import { Router } from 'express';
import RiderController from '../controllers/rider.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  riderActionSchema,
  riderAvailabilitySchema,
  deliveryListQuerySchema,
} from '../utils/validators/order.validators.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();

/**
 * /rider — the rider app API (blueprint §3). Only RIDER (+ ADMIN/SUPER_ADMIN
 * for demo/support) may drive these transitions.
 */
router.use(authenticate, authorize(USER_ROLES.RIDER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN));

router.get('/deliveries', validate(deliveryListQuerySchema, 'query'), RiderController.list);
router.post('/availability', validate(riderAvailabilitySchema), RiderController.setAvailability);

router.post('/deliveries/:id/accept', RiderController.accept);
router.post('/deliveries/:id/reject', validate(riderActionSchema, 'body'), RiderController.reject);
router.post('/deliveries/:id/arrive-hub', RiderController.arriveHub);
router.post('/deliveries/:id/depart', validate(riderActionSchema, 'body'), RiderController.depart);
router.post('/deliveries/:id/arrive', RiderController.arrive);
router.post('/deliveries/:id/complete', validate(riderActionSchema, 'body'), RiderController.complete);
router.post('/deliveries/:id/fail', validate(riderActionSchema, 'body'), RiderController.fail);

export default router;
