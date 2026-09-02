import { Router } from 'express';
import Joi from 'joi';
import LedgerController from '../controllers/ledger.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();

/**
 * /ledger — read-only general-ledger access (super_admin).
 *
 * Deliberately has no write endpoints: journals are posted only by the
 * services that own the business event. An API that could post an arbitrary
 * journal would make the ledger unauditable.
 */
router.use(authenticate, authorize(USER_ROLES.SUPER_ADMIN));

const statementQuery = Joi.object({
  accountCode: Joi.string().max(120).required(),
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(200),
});

const journalsQuery = Joi.object({
  refType: Joi.string().max(40).required(),
  refId: Joi.string().hex().length(24).required(),
});

router.get('/accounts', LedgerController.accounts);
router.get('/statement', validate(statementQuery, 'query'), LedgerController.statement);
router.get('/trial-balance', LedgerController.trialBalance);
router.get('/journals', validate(journalsQuery, 'query'), LedgerController.journals);
router.post('/verify', LedgerController.verify);

export default router;
