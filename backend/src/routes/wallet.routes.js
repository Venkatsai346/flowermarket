import { Router } from 'express';
import WalletController from '../controllers/wallet.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { orderListQuerySchema } from '../utils/validators/order.validators.js';

const router = Router();

/**
 * /wallet — customer wallet + refund history (wallet is the default refund
 * destination; gateway refunds go to the original payment method).
 */
router.use(authenticate);

router.get('/', WalletController.balance);
router.get('/transactions', validate(orderListQuerySchema, 'query'), WalletController.ledger);
router.get('/refunds', validate(orderListQuerySchema, 'query'), WalletController.refunds);

export default router;
