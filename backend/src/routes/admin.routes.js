import { Router } from 'express';
import AdminController from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  adminListQuerySchema,
  inventoryAdjustSchema,
  hubCreateSchema,
  hubUpdateSchema,
  hubToggleSchema,
  hubPincodesSchema,
  slotListQuerySchema,
  slotOverrideSchema,
  slotStatusSchema,
  adminOrderListSchema,
  staffCreateSchema,
  userStatusSchema,
  userRoleSchema,
  adminAnalyticsQuerySchema,
  adminDateRangeSchema,
  rebuildSchema,
  riderStatsQuerySchema,
} from '../utils/validators/admin.validators.js';
import { USER_ROLES } from '../constants/enums.js';
import {
  templateCreateSchema,
  templateUpdateSchema,
  adminNotificationQuerySchema,
  adminSendNotificationSchema,
  processNotificationsSchema,
  exportCreateSchema,
  exportListQuerySchema,
  runDueExportsSchema,
  nightlySchema,
} from '../utils/validators/admin.validators.js';

const router = Router();

/**
 * /admin — Phase 4 admin dashboard API (ADMIN / SUPER_ADMIN only).
 * Read-first; writes are write-controlled and reuse domain invariants.
 */
router.use(authenticate, authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN));

// ---- products ----
router.get('/products', validate(adminListQuerySchema, 'query'), AdminController.listProducts);
router.get('/products/export.csv', validate(adminListQuerySchema, 'query'), AdminController.exportProducts);
router.get('/products/:id', AdminController.getProduct);

// ---- inventory ----
router.get('/inventory/summary', AdminController.inventorySummary);
router.get('/inventory', validate(adminListQuerySchema, 'query'), AdminController.listInventory);
router.get('/inventory/export.csv', validate(adminListQuerySchema, 'query'), AdminController.exportInventory);
router.get('/inventory/ledger/:id', AdminController.inventoryLedger);
router.post('/inventory/:id/adjust', validate(inventoryAdjustSchema), AdminController.adjustInventory);

// ---- hubs & slots ----
router.get('/hubs', AdminController.listHubs);
router.post('/hubs', validate(hubCreateSchema), AdminController.createHub);
router.patch('/hubs/:id', validate(hubUpdateSchema), AdminController.updateHub);
router.post('/hubs/:id/toggle', validate(hubToggleSchema), AdminController.toggleHub);
router.post('/hubs/:id/pincodes', validate(hubPincodesSchema), AdminController.manageHubPincodes);
router.get('/slots', validate(slotListQuerySchema, 'query'), AdminController.listSlots);
router.post('/slots/:id/override', validate(slotOverrideSchema), AdminController.overrideSlot);
router.post('/slots/:id/status', validate(slotStatusSchema), AdminController.setSlotStatus);
router.get('/slots/utilization', validate(adminDateRangeSchema, 'query'), AdminController.slotsUtilization);

// ---- orders ----
router.get('/orders', validate(adminOrderListSchema, 'query'), AdminController.listOrders);
router.get('/orders/export.csv', validate(adminOrderListSchema, 'query'), AdminController.exportOrders);
router.get('/orders/:id', AdminController.getOrder);

// ---- users & staff ----
router.get('/users', validate(adminListQuerySchema, 'query'), AdminController.listUsers);
router.get('/users/export.csv', validate(adminListQuerySchema, 'query'), AdminController.exportUsers);
router.get('/users/riders/stats', validate(riderStatsQuerySchema, 'query'), AdminController.riderStats);
router.get('/users/:id', AdminController.getUser);
router.post('/users/staff', validate(staffCreateSchema), AdminController.createStaff);
router.patch('/users/:id/status', validate(userStatusSchema), AdminController.setUserStatus);
router.patch('/users/:id/role', validate(userRoleSchema), AdminController.setUserRole);

// ---- analytics ----
router.get('/analytics/dashboard', validate(adminAnalyticsQuerySchema, 'query'), AdminController.dashboard);
router.get('/analytics/products', validate(adminAnalyticsQuerySchema, 'query'), AdminController.topProducts);
router.get('/analytics/categories', validate(adminAnalyticsQuerySchema, 'query'), AdminController.categoryPerformance);
router.get('/analytics/hubs', validate(adminAnalyticsQuerySchema, 'query'), AdminController.hubPerformance);
router.get('/analytics/slots', validate(adminAnalyticsQuerySchema, 'query'), AdminController.slotPerformance);
router.get('/analytics/export.csv', validate(adminAnalyticsQuerySchema, 'query'), AdminController.exportAnalytics);
router.post('/analytics/rebuild', validate(rebuildSchema), AdminController.rebuildAnalytics);

// ---- Phase 4b: notification templates, log, manual send, worker ----
router.get('/notifications/templates', AdminController.listTemplates);
router.post('/notifications/templates', validate(templateCreateSchema), AdminController.createTemplate);
router.patch('/notifications/templates/:id', validate(templateUpdateSchema), AdminController.updateTemplate);
router.delete('/notifications/templates/:id', AdminController.deleteTemplate);
router.get('/notifications', validate(adminNotificationQuerySchema, 'query'), AdminController.listNotifications);
router.post('/notifications/send', validate(adminSendNotificationSchema), AdminController.sendNotification);
router.post('/notifications/process', validate(processNotificationsSchema), AdminController.processNotifications);

// ---- Phase 4b: scheduled CSV/BI exports ----
router.get('/exports', validate(exportListQuerySchema, 'query'), AdminController.listExports);
router.post('/exports', validate(exportCreateSchema), AdminController.createExport);
router.get('/exports/:id', AdminController.getExport);
router.post('/exports/:id/run', AdminController.runExport);
router.get('/exports/:id/download', AdminController.downloadExport);
router.post('/exports/run', validate(runDueExportsSchema), AdminController.runDueExports);

// ---- Phase 4b: nightly maintenance pipeline ----
router.post('/maintenance/nightly', validate(nightlySchema), AdminController.nightly);

export default router;
