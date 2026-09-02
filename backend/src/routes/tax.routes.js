import { Router } from 'express';
import TaxController from '../controllers/tax.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';
import {
  taxDocListQuerySchema, taxDocIdParamSchema, issueInvoiceSchema, cancelDocSchema,
  creditNoteSchema, registrationSchema, taxPolicySchema, statutoryRateSchema,
  seriesAuditQuerySchema,
} from '../utils/validators/tax.validators.js';

const router = Router();

/**
 * /tax — GST registrations, documents and rate policies (Phase 6.2).
 *
 * Three privilege tiers, deliberately separated:
 *   - customer  : may read the invoice for an order they own
 *   - store admin: manages its own registration, series and documents
 *   - super_admin: owns RATE POLICY and STATUTORY RATES, because GST
 *     classification is a legal fact and not a tenant's business decision.
 *     A store must never be able to pick its own GST slab.
 */
router.use(authenticate);

const storeAdmin = authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN);
const platformAdmin = authorize(USER_ROLES.SUPER_ADMIN);

// ---- customer ----
router.get('/orders/:id/invoice', validate(taxDocIdParamSchema, 'params'), TaxController.myOrderInvoice);

// ---- store registration ----
router.get('/registration', storeAdmin, TaxController.getMyRegistration);
router.put('/registration', storeAdmin, validate(registrationSchema), TaxController.upsertMyRegistration);

// ---- documents ----
router.get('/documents', storeAdmin, validate(taxDocListQuerySchema, 'query'), TaxController.listDocuments);
router.get('/documents/:id', storeAdmin, validate(taxDocIdParamSchema, 'params'), TaxController.getDocument);
router.post('/documents/invoice', storeAdmin, validate(issueInvoiceSchema), TaxController.issueInvoice);
router.post('/documents/credit-note', storeAdmin, validate(creditNoteSchema), TaxController.issueCreditNote);
router.post('/documents/:id/cancel', storeAdmin, validate(taxDocIdParamSchema, 'params'), validate(cancelDocSchema), TaxController.cancelDocument);
router.post('/documents/:id/einvoice/retry', storeAdmin, validate(taxDocIdParamSchema, 'params'), TaxController.retryEinvoice);

// ---- numbering integrity ----
router.get('/series/audit', storeAdmin, validate(seriesAuditQuerySchema, 'query'), TaxController.auditSeries);

// ---- platform-only: rates are law, not configuration ----
router.get('/policies', platformAdmin, TaxController.listPolicies);
router.post('/policies', platformAdmin, validate(taxPolicySchema), TaxController.upsertPolicy);
router.get('/statutory-rates', platformAdmin, TaxController.listStatutoryRates);
router.post('/statutory-rates', platformAdmin, validate(statutoryRateSchema), TaxController.createStatutoryRate);

export default router;
