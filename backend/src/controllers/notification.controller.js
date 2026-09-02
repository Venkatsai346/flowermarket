/**
 * NotificationController — customer self-service for devices + inbox (Phase 4b).
 * Mounted under /users (routes: /me/devices*, /me/notifications*).
 */

import notificationService from '../services/notification.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';

class NotificationController {
  // ---------------- devices ----------------
  listDevices = asyncHandler(async (req, res) => {
    const items = await notificationService.listDevices({ tenantId: req.tenantId, userId: req.auth.userId });
    res.status(200).json(success(items, { message: 'Devices fetched' }));
  });

  registerDevice = asyncHandler(async (req, res) => {
    const { device, reRegistered } = await notificationService.registerDevice({
      tenantId: req.tenantId,
      userId: req.auth.userId,
      payload: req.body,
    });
    res.status(reRegistered ? 200 : 201).json(success(device, { message: reRegistered ? 'Device refreshed' : 'Device registered' }));
  });

  removeDevice = asyncHandler(async (req, res) => {
    const device = await notificationService.removeDevice({
      tenantId: req.tenantId,
      userId: req.auth.userId,
      deviceId: req.params.id,
    });
    res.status(200).json(success(device, { message: 'Device removed' }));
  });

  // ---------------- inbox ----------------
  listMyNotifications = asyncHandler(async (req, res) => {
    const result = await notificationService.listForUser({ tenantId: req.tenantId, userId: req.auth.userId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Notifications fetched', meta: result.meta }));
  });

  markRead = asyncHandler(async (req, res) => {
    const n = await notificationService.markRead({ tenantId: req.tenantId, userId: req.auth.userId, notificationId: req.params.id });
    res.status(200).json(success(n, { message: 'Notification marked read' }));
  });
}

export default new NotificationController();
