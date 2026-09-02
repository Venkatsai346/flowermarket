import { Router } from 'express';
import ReturnsController from '../controllers/returns.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  createReturnSchema,
  qcDecisionSchema,
} from '../utils/validators/order.validators.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();
router.use(authenticate);

/**
 * /returns — customer return requests (both flows) + ops pickup/QC.
 */
router.post('/', validate(createReturnSchema), ReturnsController.create);
router.get('/', ReturnsController.listMine);
router.get('/:id', ReturnsController.detail);

// ops: pickup + QC (Flow A) — warehouse/admin only
router.post('/:id/pickup', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.PICKER), ReturnsController.markPickedUp);
router.post('/:id/qc', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.PICKER), validate(qcDecisionSchema), ReturnsController.qcDecision);

export default router;
