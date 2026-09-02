import User from '../models/user.model.js';
import AddressService from './address.service.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import { USER_STATUS, USER_ROLES } from '../constants/enums.js';
import { isValidObjectId } from 'mongoose';

/**
 * UserService — profile management + admin user administration.
 * Auth flows (login/OTP/tokens) live in auth.service.js; this service deals
 * with the user document itself: profile, preferences, location, and
 * admin operations (list/block/role).
 */
class UserService {
  /** Full profile for "me" — the BigBasket-style account screen. */
  async getProfile(userId) {
    const user = await User.findById(userId);
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    return user;
  }

  /** Whitelist-patched profile update (never lets a client overwrite identity). */
  async updateProfile(userId, patch) {
    const user = await User.findById(userId);
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');

    // only these paths are mutable by the user
    const allowed = ['profile', 'preferences', 'marketing'];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        user[key] = { ...(user[key] || {}), ...patch[key] };
      }
    }
    await user.save();
    return user;
  }

  /** BigBasket-style "set my store location" — drives slots & catalogue. */
  async updateLocation(userId, locationPatch) {
    const user = await User.findById(userId);
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');

    user.location = {
      ...user.location,
      ...locationPatch,
      updatedAt: new Date(),
    };
    await user.save();
    return user;
  }

  async addAddress(userId, tenantId, payload) {
    const address = await AddressService.create({ userId, tenantId, payload });
    return address;
  }

  // ---------------- admin operations (tenant-scoped) ----------------

  async listUsers({ tenantId, query }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = { tenantId };
    if (query.status) filter.status = query.status;
    if (query.role) filter.role = query.role;
    if (query.search) {
      const rx = new RegExp(query.search, 'i');
      filter.$or = [
        { 'phone.number': rx },
        { 'email.address': rx },
        { 'profile.firstName': rx },
        { 'profile.lastName': rx },
      ];
    }

    const sort = { [query.sortBy === 'createdAt' ? 'createdAt' : 'createdAt']: query.sortOrder === 'asc' ? 1 : -1 };

    const [docs, total] = await Promise.all([
      User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    return {
      items: docs,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: skip + docs.length < total },
    };
  }

  async getUserById({ tenantId, userId }) {
    if (!isValidObjectId(userId)) throw notFound('User not found', 'USER_NOT_FOUND');
    const user = await User.findOne({ _id: userId, tenantId });
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    return user;
  }

  async setRole({ tenantId, userId, role }) {
    if (!Object.values(USER_ROLES).includes(role)) throw badRequest('Invalid role', 'INVALID_ROLE');
    const user = await this.getUserById({ tenantId, userId });
    user.role = role;
    await user.save();
    return user;
  }

  async setStatus({ tenantId, userId, status }) {
    if (!Object.values(USER_STATUS).includes(status)) throw badRequest('Invalid status', 'INVALID_STATUS');
    const user = await this.getUserById({ tenantId, userId });
    user.status = status;
    await user.save();
    return user;
  }
}

export default new UserService();
