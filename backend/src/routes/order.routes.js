import { Router } from 'express';
import OrderController from '../controllers/order.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  cancelOrderSchema,
  orderListQuerySchema,
} from '../utils/validators/order.validators.js';

const router = Router();

/**
 * /orders — customer order reads + cancellation.
 */
router.use(authenticate);

router.get('/', validate(orderListQuerySchema, 'query'), OrderController.listMine);
router.get('/:id', OrderController.detail);
router.get('/:id/timeline', OrderController.timeline);
router.post('/:id/cancel', validate(cancelOrderSchema), OrderController.cancel);

export default router;
