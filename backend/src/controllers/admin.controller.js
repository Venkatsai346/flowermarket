import adminCatalogService from '../services/adminCatalog.service.js';
import adminInventoryService from '../services/adminInventory.service.js';
import adminSlotsService from '../services/adminSlots.service.js';
import adminOrdersService from '../services/adminOrders.service.js';
import adminUsersService from '../services/adminUsers.service.js';
import analyticsService from '../services/analytics.service.js';
import notificationService from '../services/notification.service.js';
import exportService from '../services/export.service.js';
import maintenanceService from '../services/maintenance.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { toCsvString, sendCsv } from '../utils/csv.js';

/**
 * AdminController — Phase 4 admin dashboard read-side + write-controlled ops.
 * All routes are ADMIN/SUPER_ADMIN (enforced at the router). Writes reuse the
 * domain invariants (atomic inventory, slot capacity gate, user guards) and
 * always append audit rows.
 */
class AdminController {
  // ---------------- products ----------------
  listProducts = asyncHandler(async (req, res) => {
    const result = await adminCatalogService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Products fetched', meta: result.meta }));
  });

  getProduct = asyncHandler(async (req, res) => {
    const detail = await adminCatalogService.detail({ tenantId: req.tenantId, id: req.params.id });
    res.status(200).json(success(detail, { message: 'Product fetched' }));
  });

  exportProducts = asyncHandler(async (req, res) => {
    const rows = await adminCatalogService.csv({ tenantId: req.tenantId, query: req.query });
    const headers = [['id','ID'],['skuGlobal','SKU'],['title','Title'],['type','Type'],['categoryId','Category ID'],['status','Status'],['mrp','MRP'],['sellingPrice','Selling Price'],['qtyOnHand','Qty On Hand'],['qtyReserved','Qty Reserved'],['available','Available'],['health','Health']];
    sendCsv(res, 'products.csv', toCsvString(rows, headers));
  });

  // ---------------- inventory ----------------
  inventorySummary = asyncHandler(async (req, res) => {
    const summary = await adminInventoryService.summary({ tenantId: req.tenantId });
    res.status(200).json(success(summary, { message: 'Inventory summary' }));
  });

  listInventory = asyncHandler(async (req, res) => {
    const result = await adminInventoryService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Inventory fetched', meta: result.meta }));
  });

  inventoryLedger = asyncHandler(async (req, res) => {
    const ledger = await adminInventoryService.ledger({ tenantId: req.tenantId, listingId: req.params.id });
    res.status(200).json(success(ledger, { message: 'Inventory ledger fetched' }));
  });

  adjustInventory = asyncHandler(async (req, res) => {
    const result = await adminInventoryService.adjust({
      tenantId: req.tenantId, listingId: req.params.id,
      type: req.body.type, qtyChange: req.body.qtyChange,
      reason: req.body.reason, note: req.body.note,
      actorId: req.auth.userId, req,
    });
    res.status(200).json(success(result, { message: 'Inventory adjusted (ledger row appended)' }));
  });

  exportInventory = asyncHandler(async (req, res) => {
    const rows = await adminInventoryService.csv({ tenantId: req.tenantId, query: req.query });
    const headers = [['listingId','Listing ID'],['skuGlobal','SKU'],['title','Title'],['mrp','MRP'],['sellingPrice','Selling Price'],['qtyOnHand','Qty On Hand'],['qtyReserved','Qty Reserved'],['available','Available'],['health','Health'],['restockSuggestion','Restock Suggestion']];
    sendCsv(res, 'inventory.csv', toCsvString(rows, headers));
  });

  // ---------------- hubs & slots ----------------
  listHubs = asyncHandler(async (req, res) => {
    const hubs = await adminSlotsService.listHubs({ tenantId: req.tenantId });
    res.status(200).json(success(hubs, { message: 'Hubs fetched' }));
  });

  createHub = asyncHandler(async (req, res) => {
    const hub = await adminSlotsService.createHub({ tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId, req });
    res.status(201).json(created(hub, { message: 'Hub created' }));
  });

  updateHub = asyncHandler(async (req, res) => {
    const hub = await adminSlotsService.updateHub({ tenantId: req.tenantId, hubId: req.params.id, payload: req.body, actorId: req.auth.userId, req });
    res.status(200).json(success(hub, { message: 'Hub updated' }));
  });

  toggleHub = asyncHandler(async (req, res) => {
    const hub = await adminSlotsService.toggleHub({ tenantId: req.tenantId, hubId: req.params.id, isActive: req.body.isActive === true, actorId: req.auth.userId, req });
    res.status(200).json(success(hub, { message: hub.isActive ? 'Hub activated' : 'Hub deactivated' }));
  });

  manageHubPincodes = asyncHandler(async (req, res) => {
    const result = await adminSlotsService.managePincodes({
      tenantId: req.tenantId, hubId: req.params.id,
      add: req.body.add || [], remove: req.body.remove || [],
      actorId: req.auth.userId, req,
    });
    res.status(200).json(success(result, { message: 'Hub pincodes updated' }));
  });

  listSlots = asyncHandler(async (req, res) => {
    const slots = await adminSlotsService.listSlots({
      tenantId: req.tenantId, hubId: req.query.hubId || null,
      fromDate: req.query.from, toDate: req.query.to,
    });
    res.status(200).json(success(slots, { message: 'Slots fetched' }));
  });

  overrideSlot = asyncHandler(async (req, res) => {
    const slot = await adminSlotsService.overrideSlot({
      tenantId: req.tenantId, slotId: req.params.id,
      manualCapacity: req.body.manualCapacity, reason: req.body.reason,
      actorId: req.auth.userId, req,
    });
    res.status(200).json(success(slot, { message: 'Slot capacity overridden (atomic gate honors it)' }));
  });

  setSlotStatus = asyncHandler(async (req, res) => {
    const slot = await adminSlotsService.setSlotStatus({
      tenantId: req.tenantId, slotId: req.params.id,
      status: req.body.status, reason: req.body.reason,
      actorId: req.auth.userId, req,
    });
    res.status(200).json(success(slot, { message: `Slot ${req.body.status}` }));
  });

  slotsUtilization = asyncHandler(async (req, res) => {
    const result = await adminSlotsService.utilization({
      tenantId: req.tenantId, hubId: req.query.hubId || null,
      fromDate: req.query.from, toDate: req.query.to,
    });
    res.status(200).json(success(result, { message: 'Slot utilization fetched' }));
  });

  // ---------------- orders ----------------
  listOrders = asyncHandler(async (req, res) => {
    const result = await adminOrdersService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Orders fetched', meta: result.meta }));
  });

  getOrder = asyncHandler(async (req, res) => {
    const detail = await adminOrdersService.detail({ tenantId: req.tenantId, orderId: req.params.id });
    res.status(200).json(success(detail, { message: 'Order detail fetched' }));
  });

  exportOrders = asyncHandler(async (req, res) => {
    const rows = await adminOrdersService.csv({ tenantId: req.tenantId, query: req.query });
    const headers = [['orderNumber','Order'],['status','Status'],['createdAt','Created'],['customerName','Customer'],['itemsCount','Items'],['itemsSubtotal','Subtotal'],['deliveryFee','Delivery Fee'],['discount','Discount'],['taxAmount','Tax'],['totalAmount','Total'],['paymentMethod','Payment'],['pincode','Pincode'],['hubId','Hub'],['slot','Slot']];
    sendCsv(res, 'orders.csv', toCsvString(rows, headers));
  });

  // ---------------- users & staff ----------------
  listUsers = asyncHandler(async (req, res) => {
    const result = await adminUsersService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Users fetched', meta: result.meta }));
  });

  getUser = asyncHandler(async (req, res) => {
    const detail = await adminUsersService.detail({ tenantId: req.tenantId, userId: req.params.id });
    res.status(200).json(success(detail, { message: 'User detail fetched' }));
  });

  createStaff = asyncHandler(async (req, res) => {
    const user = await adminUsersService.createStaff({ tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId, req });
    res.status(201).json(created(user, { message: 'Staff user created' }));
  });

  setUserStatus = asyncHandler(async (req, res) => {
    const user = await adminUsersService.setStatus({ tenantId: req.tenantId, userId: req.params.id, status: req.body.status, actorId: req.auth.userId, req });
    res.status(200).json(success(user, { message: `User status → ${req.body.status}` }));
  });

  setUserRole = asyncHandler(async (req, res) => {
    const user = await adminUsersService.setRole({ tenantId: req.tenantId, userId: req.params.id, role: req.body.role, actorId: req.auth.userId, req });
    res.status(200).json(success(user, { message: `User role → ${req.body.role}` }));
  });

  riderStats = asyncHandler(async (req, res) => {
    const stats = await adminUsersService.riderStats({
      tenantId: req.tenantId, from: req.query.from, to: req.query.to, userId: req.query.riderId || null,
    });
    res.status(200).json(success(stats, { message: 'Rider stats fetched' }));
  });

  exportUsers = asyncHandler(async (req, res) => {
    const rows = await adminUsersService.csv({ tenantId: req.tenantId, query: req.query });
    const headers = [['id','ID'],['role','Role'],['status','Status'],['name','Name'],['phone','Phone'],['email','Email'],['createdAt','Created']];
    sendCsv(res, 'users.csv', toCsvString(rows, headers));
  });

  // ---------------- analytics ----------------
  dashboard = asyncHandler(async (req, res) => {
    const result = await analyticsService.dashboard({
      tenantId: req.tenantId, from: req.query.from, to: req.query.to, hubId: req.query.hubId || null,
    });
    res.status(200).json(success(result, { message: 'Dashboard analytics' }));
  });

  topProducts = asyncHandler(async (req, res) => {
    const items = await analyticsService.topProducts({
      tenantId: req.tenantId, from: req.query.from, to: req.query.to,
      limit: Number(req.query.limit) || 20, hubId: req.query.hubId || null,
    });
    res.status(200).json(success(items, { message: 'Top products' }));
  });

  categoryPerformance = asyncHandler(async (req, res) => {
    const items = await analyticsService.categoryPerformance({ tenantId: req.tenantId, from: req.query.from, to: req.query.to });
    res.status(200).json(success(items, { message: 'Category performance' }));
  });

  hubPerformance = asyncHandler(async (req, res) => {
    const items = await analyticsService.hubPerformance({ tenantId: req.tenantId, from: req.query.from, to: req.query.to });
    res.status(200).json(success(items, { message: 'Hub performance' }));
  });

  slotPerformance = asyncHandler(async (req, res) => {
    const result = await analyticsService.slotPerformance({ tenantId: req.tenantId, from: req.query.from, to: req.query.to, hubId: req.query.hubId || null });
    res.status(200).json(success(result, { message: 'Slot performance' }));
  });

  rebuildAnalytics = asyncHandler(async (req, res) => {
    const result = await analyticsService.rebuildDailyStats({ tenantId: req.tenantId, from: req.body.from, to: req.body.to });
    res.status(200).json(success(result, { message: 'Daily stats rebuilt (idempotent upsert)' }));
  });

  exportAnalytics = asyncHandler(async (req, res) => {
    const rows = await analyticsService.csv({ tenantId: req.tenantId, from: req.query.from, to: req.query.to, hubId: req.query.hubId || null });
    const headers = [['date','Date'],['hubId','Hub'],['ordersCreated','Orders'],['gmv','GMV'],['netRevenue','Net Revenue'],['aov','AOV'],['delivered','Delivered'],['cancelled','Cancelled'],['returnRequests','Returns'],['newCustomers','New Customers'],['repeatCustomers','Repeat Customers']];
    sendCsv(res, 'analytics.csv', toCsvString(rows, headers));
  });

  // ================= Phase 4b: notifications (templates / log / send / worker) =================
  listTemplates = asyncHandler(async (req, res) => {
    const items = await notificationService.listTemplates({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(items, { message: 'Notification templates fetched' }));
  });

  createTemplate = asyncHandler(async (req, res) => {
    const tpl = await notificationService.createTemplate({ tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId, req });
    res.status(201).json(success(tpl, { message: 'Notification template created' }));
  });

  updateTemplate = asyncHandler(async (req, res) => {
    const tpl = await notificationService.updateTemplate({ tenantId: req.tenantId, templateId: req.params.id, payload: req.body, req });
    res.status(200).json(success(tpl, { message: 'Notification template updated (version bumped)' }));
  });

  deleteTemplate = asyncHandler(async (req, res) => {
    const tpl = await notificationService.updateTemplate({ tenantId: req.tenantId, templateId: req.params.id, payload: { isActive: false }, req });
    res.status(200).json(success(tpl, { message: 'Notification template deactivated' }));
  });

  listNotifications = asyncHandler(async (req, res) => {
    const result = await notificationService.listAll({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Notifications fetched', meta: result.meta }));
  });

  sendNotification = asyncHandler(async (req, res) => {
    const { templateCode, userId, orderId, data, channels, dedupeKey } = req.body;
    const result = await notificationService.dispatch({
      tenantId: req.tenantId,
      userId,
      orderId: orderId || null,
      templateCode,
      data: data || {},
      channels: channels || null,
      dedupeKey: dedupeKey || null,
      actorId: req.auth.userId,
      req,
    });
    res.status(result.created ? 201 : 200).json(success(result.notification, { message: result.created ? 'Notification queued' : (result.reason === 'duplicate' ? 'Duplicate — existing notification returned' : 'Notification skipped'), meta: { reason: result.reason || null } }));
  });

  processNotifications = asyncHandler(async (req, res) => {
    const result = await notificationService.processPending({ limit: req.body.limit || 50 });
    res.status(200).json(success(result, { message: 'Notification worker pass complete' }));
  });

  // ================= Phase 4b: exports =================
  listExports = asyncHandler(async (req, res) => {
    const result = await exportService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Export jobs fetched', meta: result.meta }));
  });

  createExport = asyncHandler(async (req, res) => {
    const { job, created } = await exportService.createJob({
      tenantId: req.tenantId,
      type: req.body.type,
      params: req.body.params || {},
      scheduledFor: req.body.scheduledFor || null,
      requestedBy: req.auth.userId,
      req,
    });
    res.status(created ? 201 : 200).json(success(job, { message: created ? 'Export job created' : 'Export job already exists (idempotent)' }));
  });

  getExport = asyncHandler(async (req, res) => {
    const detail = await exportService.detail({ tenantId: req.tenantId, jobId: req.params.id });
    res.status(200).json(success(detail, { message: 'Export job fetched' }));
  });

  runExport = asyncHandler(async (req, res) => {
    const result = await exportService.runJob(req.params.id);
    res.status(200).json(success(result.job, { message: 'Export job run complete', meta: { artifact: result.artifact } }));
  });

  runDueExports = asyncHandler(async (req, res) => {
    const result = await exportService.runDueJobs({ limit: req.body.limit || 20 });
    res.status(200).json(success(result, { message: 'Due export jobs run' }));
  });

  downloadExport = asyncHandler(async (req, res) => {
    const { csv, filename } = await exportService.artifactForDownload({ tenantId: req.tenantId, jobId: req.params.id });
    sendCsv(res, filename, csv);
  });

  // ================= Phase 4b: maintenance =================
  nightly = asyncHandler(async (req, res) => {
    const result = await maintenanceService.nightly({
      tenantId: req.tenantId,
      actorId: req.auth.userId,
      actorType: 'admin',
      req,
      opts: req.body || {},
    });
    res.status(200).json(success(result, { message: 'Nightly pipeline complete (idempotent steps)' }));
  });
}

export default new AdminController();
