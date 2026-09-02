import Address from '../models/address.model.js';
import ServiceablePincode from '../models/serviceablePincode.model.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import config from '../config/index.js';

/**
 * AddressService — CRUD + business rules for saved delivery addresses.
 *
 * Rules enforced:
 *  1. Ownership: a user can only read/update/delete their own addresses.
 *  2. Bounded per user: MAX_ADDRESSES_PER_USER (default 10) — keeps the
 *     addresses collection sane per user and is the reason we normalize
 *     addresses OUT of the user document.
 *  3. Serviceability check: on create/update we look up the pincode in
 *     ServiceablePincode (tenant-scoped) and stamp the result on the address,
 *     so the client can render "deliverable / not deliverable" instantly.
 *  4. Exactly one default address per user (enforced by a partial unique index
 *     plus explicit unset logic here).
 */
class AddressService {
  async list({ userId, tenantId }) {
    return Address.find({ userId, tenantId }).sort({ isDefault: -1, createdAt: -1 }).lean();
  }

  async get({ userId, tenantId, addressId }) {
    const address = await Address.findOne({ _id: addressId, userId, tenantId });
    if (!address) throw notFound('Address not found', 'ADDRESS_NOT_FOUND');
    return address;
  }

  async create({ userId, tenantId, payload }) {
    const count = await Address.countDocuments({ userId, tenantId });
    if (count >= config.limits.maxAddressesPerUser) {
      throw badRequest(`You can save up to ${config.limits.maxAddressesPerUser} addresses`, 'ADDRESS_LIMIT_REACHED');
    }

    const serviceability = await this.checkServiceability({ tenantId, pincode: payload.pincode });

    // create as non-default first; setDefault() handles the exactly-one-default
    // invariant (and the partial unique index) safely
    const { isDefault, ...rest } = payload;
    const address = await Address.create({
      tenantId,
      userId,
      ...rest,
      isDefault: false,
      serviceability,
    });

    if (isDefault) {
      await this.setDefault({ userId, tenantId, addressId: address.id });
    }

    return address;
  }

  async update({ userId, tenantId, addressId, patch }) {
    const address = await this.get({ userId, tenantId, addressId });

    if (patch.pincode && patch.pincode !== address.pincode) {
      patch.serviceability = await this.checkServiceability({ tenantId, pincode: patch.pincode });
    }

    Object.assign(address, patch);
    await address.save();

    if (patch.isDefault) {
      await this.setDefault({ userId, tenantId, addressId });
    }
    return address;
  }

  async remove({ userId, tenantId, addressId }) {
    const address = await this.get({ userId, tenantId, addressId });
    await address.softDelete();
    // if the deleted address was the default, promote the newest remaining one
    if (address.isDefault) {
      await Address.updateMany(
        { userId, tenantId, _id: { $ne: addressId } },
        { $set: { isDefault: false } }
      );
      const replacement = await Address.findOne({ userId, tenantId }).sort({ createdAt: 1 });
      if (replacement) {
        replacement.isDefault = true;
        await replacement.save();
      }
    }
    return { deleted: true };
  }

  async setDefault({ userId, tenantId, addressId }) {
    await this.get({ userId, tenantId, addressId }); // ownership check
    await Address.updateMany(
      { userId, tenantId, isDefault: true },
      { $set: { isDefault: false } }
    );
    await Address.updateOne(
      { _id: addressId, userId, tenantId },
      { $set: { isDefault: true } }
    );
    // also point the user's preferred default address
    const { default: User } = await import('../models/user.model.js');
    await User.updateOne({ _id: userId }, { $set: { 'preferences.defaultAddressId': addressId } });
    return { defaultAddressId: addressId };
  }

  /** Resolve deliverability for a pincode within the tenant. */
  async checkServiceability({ tenantId, pincode }) {
    const row = await ServiceablePincode.findOne({ tenantId, pincode, isServiceable: true }).lean();
    if (row && !row.blocked) {
      return {
        status: 'serviceable',
        checkedAt: new Date(),
        message: `We deliver to ${pincode}.`,
      };
    }
    return {
      status: 'unserviceable',
      checkedAt: new Date(),
      message: `We are currently not delivering to ${pincode}.`,
    };
  }
}

export default new AddressService();
