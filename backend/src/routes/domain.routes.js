import { Router } from 'express';
import Joi from 'joi';
import DomainController from '../controllers/domain.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();

const hostnameSchema = Joi.object({
  hostname: Joi.string().min(4).max(253).lowercase().required(),
});
const idParam = Joi.object({ id: Joi.string().hex().length(24).required() });

/**
 * /domains — hostname management (Phase 6.4).
 *
 * `/bootstrap` and `/tls-check` are PUBLIC by design:
 *   - bootstrap is what a storefront calls before anyone has logged in, and it
 *     only ever returns the tenant the HOST already resolved to;
 *   - tls-check is called by the TLS terminator, not a browser, and is
 *     IP-allowlistable.
 * Everything else is store-owner or platform scoped.
 */
router.get('/bootstrap', DomainController.bootstrap);
router.get('/tls-check', DomainController.tlsAllowed);

router.use(authenticate);

const storeAdmin = authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN);

router.get('/', storeAdmin, DomainController.list);
router.post('/', storeAdmin, validate(hostnameSchema), DomainController.add);
router.post('/:id/verify', storeAdmin, validate(idParam, 'params'), DomainController.verify);
router.post('/:id/primary', storeAdmin, validate(idParam, 'params'), DomainController.setPrimary);
router.delete('/:id', storeAdmin, validate(idParam, 'params'), DomainController.remove);

router.get('/admin/all', authorize(USER_ROLES.SUPER_ADMIN), DomainController.adminList);

export default router;
