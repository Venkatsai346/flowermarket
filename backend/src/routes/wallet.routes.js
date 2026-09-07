import { Router } from 'express';
import WalletController from '../controllers/wallet.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';
import { orderListQuerySchema, walletTopupSchema } from '../utils/validators/order.validators.js';

const router = Router();

/**
 * /wallet — customer wallet + refund history (wallet is the default refund
 * destination; gateway refunds go to the original payment method).
 */
router.use(authenticate);

router.get('/', WalletController.balance);
// Phase 16 — wallet ledger reconcile (SUPER_ADMIN): proves wallet balances
// equal the customer_wallet_liability account; repair=true posts a backfill
router.get('/admin/reconcile', authorize(USER_ROLES.SUPER_ADMIN), WalletController.ledgerReconcile);
router.post('/admin/reconcile/repair', authorize(USER_ROLES.SUPER_ADMIN), WalletController.ledgerReconcileRepair);
router.post('/topup', validate(walletTopupSchema, 'body'), WalletController.topup);
router.get('/transactions', validate(orderListQuerySchema, 'query'), WalletController.ledger);
router.get('/refunds', validate(orderListQuerySchema, 'query'), WalletController.refunds);

export default router;
