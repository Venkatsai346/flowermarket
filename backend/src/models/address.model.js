/**
 * Address — saved delivery addresses, BigBasket-style.
 *
 * DESIGN NOTES:
 *  1. Stored as its OWN collection (user -> Address one-to-many via userId ref),
 *     NOT embedded in the User document. This keeps the User document bounded
 *     and is the scalable pattern (a heavy buyer can save dozens of addresses
 *     without bloating the users collection).
 *  2. Every address is tenant-scoped AND user-scoped.
 *  3. `location` subdoc holds canonical references into the Location collection
 *     (city/area/pincode) — derived from user input + geo lookup. Delivery
 *     serviceability is decided by ServiceablePincode, not by free-text.
 *  4. `serviceability` caches the result of the serviceability check so the
 *     app can render "deliverable / not deliverable" without repeated lookups.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ADDRESS_TYPE, ADDRESS_VERIFICATION_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const AddressSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    type: {
      type: String,
      enum: Object.values(ADDRESS_TYPE),
      default: ADDRESS_TYPE.HOME,
    },
    tag: { type: String, enum: ['home', 'work', 'other'], default: 'home' },

    // ---- free-form lines (what the user actually typed) ----
    name: { type: String, trim: true, maxlength: 80 }, // "Ramu"
    phone: { type: String, trim: true, maxlength: 15 },
    line1: { type: String, required: true, trim: true, maxlength: 160 },
    line2: { type: String, trim: true, maxlength: 160, default: null },
    landmark: { type: String, trim: true, maxlength: 120, default: null },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    pincode: { type: String, trim: true, maxlength: 12, index: true },

    // ---- canonical location refs (resolved via geocoding/autocomplete) ----
    location: {
      cityId: { type: Types.ObjectId, ref: 'Location', default: null },
      areaId: { type: Types.ObjectId, ref: 'Location', default: null },
      stateId: { type: Types.ObjectId, ref: 'Location', default: null },
    },

    coordinates: { type: [Number], default: null }, // [lng, lat]
    geoSource: { type: String, enum: ['user', 'manual', 'google', 'places'], default: 'manual' },

    isDefault: { type: Boolean, default: false },

    serviceability: {
      status: {
        type: String,
        enum: Object.values(ADDRESS_VERIFICATION_STATUS),
        default: ADDRESS_VERIFICATION_STATUS.UNVERIFIED,
      },
      checkedAt: { type: Date, default: null },
      message: { type: String, default: null },
    },
  },
  { collection: 'addresses' }
);

// exactly one default address per user per tenant
AddressSchema.index({ tenantId: 1, userId: 1, isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });
AddressSchema.index({ tenantId: 1, userId: 1, pincode: 1 });

AddressSchema.plugin(auditPlugin);
AddressSchema.plugin(softDeletePlugin);
AddressSchema.plugin(toJSONPlugin);

export default mongoose.model('Address', AddressSchema);
