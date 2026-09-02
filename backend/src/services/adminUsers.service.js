/**
 * AdminUsersService — staff management + user detail + rider stats (Phase 4).
 *
 * Guard rails (blueprint §5):
 *  - staff create / role change can NEVER mint or touch super_admin;
 *  - a user cannot block/change themselves;
 *  - rider stats come from deliveryAssignments + fulfillmentTimeLogs.
 */

import User from '../models/user.model.js';
import Address from '../models/address.model.js';
import Wallet from '../models/wallet.model.js';
import Order from '../models/order.model.js';
import ReturnRequest from '../models/returnRequest.model.js';
import DeliveryAssignment from '../models/deliveryAssignment.model.js';
import FulfillmentTimeLog from '../models/fulfillmentTimeLog.model.js';
import auditService from './audit.service.js';
import { serializeList } from '../utils/serialize.js';
import { notFound, badRequest, conflict, forbidden } from '../utils/ApiError.js';
import { USER_ROLES, USER_STATUS } from '../constants/enums.js';

const STAFF_ROLES = [USER_ROLES.ADMIN, USER_ROLES.PICKER, USER_ROLES.RIDER];
const SUPER = USER_ROLES.SUPER_ADMIN;

export class AdminUsersService {
  async list({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const filter = { tenantId };
    if (query.status) filter.status = query.status;
    if (query.role) filter.role = query.role;
    if (query.search) {
      const rx = new RegExp(query.search, 'i');
      filter.$or = [{ 'phone.number': rx }, { 'email.address': rx }, { 'profile.firstName': rx }, { 'profile.lastName': rx }];
    }
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) filter.createdAt.$lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86400000);
    }
    const [docs, total] = await Promise.all([
      User.find(filter).select('+passwordHash').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    const safe = docs.map((d) => {
      const { passwordHash, ...rest } = d;
      return rest;
    });
    return { items: serializeList(safe), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async detail({ tenantId, userId }) {
    const user = await User.findOne({ _id: userId, tenantId }).select('+passwordHash');
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    const [addresses, wallet, orders, returns] = await Promise.all([
      Address.find({ tenantId, userId }).lean(),
      Wallet.findOne({ tenantId, userId }).lean(),
      Order.find({ tenantId, userId }).select('orderNumber status totalAmount createdAt').sort({ createdAt: -1 }).limit(20).lean(),
      ReturnRequest.find({ tenantId, userId }).select('id claimType status createdAt').sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    const orderTotals = await Order.aggregate([
      { $match: { tenantId, userId, status: { $nin: ['cancelled'] } } },
      { $group: { _id: null, orders: { $sum: 1 }, gmv: { $sum: '$totalAmount' } } },
    ]);
    const safeUser = user.toObject();
    delete safeUser.passwordHash;
    return {
      user: safeUser,
      addresses: serializeList(addresses),
      wallet: wallet ? { ...wallet, id: wallet._id } : null,
      orderSummary: orderTotals[0] || { orders: 0, gmv: 0 },
      recentOrders: serializeList(orders),
      recentReturns: serializeList(returns),
    };
  }

  async createStaff({ tenantId, payload, actorId = null, req = null }) {
    const role = payload.role;
    if (!STAFF_ROLES.includes(role)) {
      throw badRequest('Role must be admin, picker or rider', 'INVALID_STAFF_ROLE');
    }
    const identity = payload.email?.trim() || payload.phone?.number?.trim();
    if (!identity) throw badRequest('Email or phone is required', 'IDENTITY_REQUIRED');

    const existing = payload.email
      ? await User.findOne({ tenantId, 'email.address': payload.email.trim() })
      : await User.findOne({ tenantId, 'phone.number': payload.phone.number });
    if (existing) throw conflict('A user with this identity already exists', 'ACCOUNT_EXISTS');

    const user = await User.create({
      tenantId,
      phone: payload.phone ? { countryCode: payload.phone.countryCode || '+91', number: payload.phone.number, verified: true, verifiedAt: new Date() } : { verified: false },
      email: payload.email ? { address: payload.email.trim(), verified: true, verifiedAt: new Date() } : undefined,
      role,
      status: USER_STATUS.ACTIVE,
      profile: { firstName: payload.firstName || null, lastName: payload.lastName || null },
      loginMethods: payload.password ? ['email_password'] : [],
      rider: role === USER_ROLES.RIDER ? { availability: 'available', currentHubId: payload.hubId || null } : undefined,
      accountMeta: { source: 'admin', createdBy: actorId },
    });
    if (payload.password) await user.setPassword(payload.password);

    await auditService.record({
      action: 'create', entityType: 'user', entityId: user._id,
      tenantId, actorId, actorType: 'admin',
      after: { role: user.role, phone: user.phone?.number || null }, req,
    });
    return user;
  }

  async setStatus({ tenantId, userId, status, actorId = null, req = null }) {
    if (!Object.values(USER_STATUS).includes(status)) throw badRequest('Invalid status', 'INVALID_STATUS');
    if (String(userId) === String(actorId)) throw badRequest('You cannot change your own status', 'SELF_MODIFICATION');
    const user = await User.findOne({ _id: userId, tenantId });
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    if (user.role === SUPER) throw forbidden('Super admins cannot be modified', 'FORBIDDEN');
    const before = user.status;
    user.status = status;
    await user.save();
    await auditService.record({
      action: 'status_change', entityType: 'user', entityId: user._id,
      tenantId, actorId, actorType: 'admin', before: { status: before }, after: { status }, req,
    });
    return user;
  }

  async setRole({ tenantId, userId, role, actorId = null, req = null }) {
    if (!Object.values(USER_ROLES).includes(role)) throw badRequest('Invalid role', 'INVALID_ROLE');
    if (String(userId) === String(actorId)) throw badRequest('You cannot change your own role', 'SELF_MODIFICATION');
    if (role === SUPER) throw forbidden('Cannot grant super_admin', 'FORBIDDEN');
    const user = await User.findOne({ _id: userId, tenantId });
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    if (user.role === SUPER) throw forbidden('Super admins cannot be modified', 'FORBIDDEN');
    const before = user.role;
    user.role = role;
    if (role === USER_ROLES.RIDER && !user.rider?.availability) {
      user.rider = { ...(user.rider || {}), availability: 'available' };
    }
    await user.save();
    await auditService.record({
      action: 'role_change', entityType: 'user', entityId: user._id,
      tenantId, actorId, actorType: 'admin', before: { role: before }, after: { role }, req,
    });
    return user;
  }

  /** Per-rider ops stats over a window. */
  async riderStats({ tenantId, from, to, userId = null }) {
    const window = {};
    if (from) window.createdAt = { $gte: new Date(`${from}T00:00:00.000Z`) };
    if (to) window.createdAt = { ...(window.createdAt || {}), $lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000) };

    const match = { tenantId, ...window };
    if (userId) match.riderId = userId;

    const [deliveries, timeLogs, riders] = await Promise.all([
      DeliveryAssignment.aggregate([
        { $match: { ...match, status: 'delivered' } },
        { $group: { _id: '$riderId', delivered: { $sum: 1 }, rejected: { $sum: '$rejectCount' } } },
      ]),
      FulfillmentTimeLog.aggregate([
        { $match: { tenantId, ...(from || to ? { createdAt: window.createdAt } : {}) } },
        { $group: { _id: '$riderId', avgDeliverySeconds: { $avg: '$deliverySeconds' }, count: { $sum: 1 } } },
      ]),
      User.find({ tenantId, role: USER_ROLES.RIDER }).select('profile rider status').lean(),
    ]);

    const deliveryByRider = new Map(deliveries.map((d) => [String(d._id), d]));
    const timeByRider = new Map(timeLogs.map((t) => [String(t._id), t]));

    return riders.map((r) => {
      const d = deliveryByRider.get(String(r._id)) || { delivered: 0, rejected: 0 };
      const t = timeByRider.get(String(r._id)) || { avgDeliverySeconds: null, count: 0 };
      return {
        riderId: r._id,
        name: [r.profile?.firstName, r.profile?.lastName].filter(Boolean).join(' ') || null,
        availability: r.rider?.availability || null,
        status: r.status,
        delivered: d.delivered,
        rejections: d.rejected || 0,
        avgDeliverySeconds: t.avgDeliverySeconds ? Math.round(t.avgDeliverySeconds) : null,
        timeLogs: t.count,
      };
    });
  }

  async csv({ tenantId, query = {} }) {
    const { items } = await this.list({ tenantId, query: { ...query, page: 1, limit: 200 } });
    return items.map((u) => ({
      id: u.id, role: u.role, status: u.status,
      name: [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' '),
      phone: u.phone?.number || '', email: u.email?.address || '',
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : '',
    }));
  }
}

export default new AdminUsersService();
