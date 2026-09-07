import { Router } from 'express';
import Joi from 'joi';
import LedgerController from '../controllers/ledger.controller.js';
import PeriodController from '../controllers/period.controller.js';
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

// Phase 10 — the money audit backbone (super_admin, platform-wide):
//   GET  /ledger/integrity          read-only "is the system consistent?" report
//   POST /ledger/integrity/replay   rebuild missing journals/events from the
//                                   domain event store (idempotent, additive)
router.get('/integrity', LedgerController.integrity);
router.post('/integrity/replay', LedgerController.replay);

// Phase 11 — fold unanchored audit rows into the hash chain (safe, additive;
// chain BREAKS are never auto-healed — that would bless the tamper).
router.post('/integrity/replay-chain', LedgerController.replayChain);
// deliberate re-link after a legitimate row-set change (manual, recorded)
router.post('/integrity/rebuild-chain', LedgerController.rebuildChain);

// Phase 11 — fiscal period close. Closing a period makes it immutable:
// the ledger refuses new journals dated inside it until it is reopened.
const periodKeyParam = Joi.object({ periodKey: Joi.string().pattern(/^\d{4}-\d{2}$/).max(7).required() }).unknown();
router.get('/periods', PeriodController.list);
router.get('/periods/:periodKey', validate(periodKeyParam, 'params'), PeriodController.report);
router.post('/periods/:periodKey/close', validate(periodKeyParam, 'params'), PeriodController.close);
router.post('/periods/:periodKey/reopen', validate(periodKeyParam, 'params'), PeriodController.reopen);

export default router;
