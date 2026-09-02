import { Router } from 'express';
import UserController from '../controllers/user.controller.js';
import AddressController from '../controllers/address.controller.js';
import NotificationController from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  updateProfileSchema,
  addressSchema,
  updateAddressSchema,
  roleUpdateSchema,
  idParamSchema,
  listQuerySchema,
  deviceRegisterSchema,
  notificationQuerySchema,
} from '../utils/validators/user.validators.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();

/**
 * /users — all routes require authentication.
 * Self-service under /me; administration under /admin.
 */
router.use(authenticate);

// ---------------- self-service ----------------
router.get('/me', UserController.getMe);
router.patch('/me', validate(updateProfileSchema), UserController.updateMe);
router.delete('/me', UserController.deleteMe);
router.put('/me/location', UserController.updateLocation);

// ---- saved addresses ----
router.get('/me/addresses', AddressController.list);
router.post('/me/addresses', validate(addressSchema), AddressController.create);
router.get('/me/addresses/:id', validate(idParamSchema, 'params'), AddressController.getById);
router.patch('/me/addresses/:id', validate(idParamSchema, 'params'), validate(updateAddressSchema), AddressController.update);
router.delete('/me/addresses/:id', validate(idParamSchema, 'params'), AddressController.remove);
router.patch('/me/addresses/:id/default', validate(idParamSchema, 'params'), AddressController.setDefault);

// ---- Phase 4b: push devices + notification inbox ----
router.get('/me/devices', NotificationController.listDevices);
router.post('/me/devices', validate(deviceRegisterSchema), NotificationController.registerDevice);
router.delete('/me/devices/:id', validate(idParamSchema, 'params'), NotificationController.removeDevice);
router.get('/me/notifications', validate(notificationQuerySchema, 'query'), NotificationController.listMyNotifications);
router.post('/me/notifications/:id/read', validate(idParamSchema, 'params'), NotificationController.markRead);

// ---------------- administration (admin & above) ----------------
router.get('/', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(listQuerySchema, 'query'), UserController.list);
router.get('/:id', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(idParamSchema, 'params'), UserController.getById);
router.patch('/:id/role', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(idParamSchema, 'params'), validate(roleUpdateSchema), UserController.setRole);
router.patch('/:id/status', authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), validate(idParamSchema, 'params'), UserController.setStatus);

export default router;
