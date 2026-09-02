/**
 * Location — canonical geography used across the whole catalogue & delivery system.
 *
 * WHY IT EXISTS:
 *  1. Addresses become *references* to canonical location nodes (city, area, pincode)
 *     instead of free-text — this is what makes "deliver to my saved pin" and
 *     slot/pincode-based filtering possible (BigBasket-style).
 *  2. Pincode nodes carry delivery metadata (zones, delivery types) so the delivery
 *     engine can answer "can we deliver here? how? when?" with one query.
 *  3. No embedded/unbounded arrays: hierarchy relations live in this single
 *     collection via parent references. One row per city/area/pincode.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { LOCATION_TYPE, LOCATION_STATUS, GEO_SOURCE, DELIVERY_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const CoordinatesSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number], // [longitude, latitude] — GeoJSON order (MongoDB requirement)
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2,
        message: 'coordinates must be [longitude, latitude]',
      },
    },
  },
  { _id: false }
);

const DeliveryMetaSchema = new Schema(
  {
    deliveryTypes: {
      type: [String],
      enum: Object.values(DELIVERY_TYPE),
      default: [DELIVERY_TYPE.STANDARD],
    },
    isSameDayAvailable: { type: Boolean, default: false },
    isExpressAvailable: { type: Boolean, default: false },
    codAvailable: { type: Boolean, default: true },
  },
  { _id: false }
);

const LocationSchema = new Schema(
  {
    type: {
      type: String,
      enum: Object.values(LOCATION_TYPE),
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, trim: true, maxlength: 40 }, // e.g. ISO state code "AP", pincode "522xxx"

    // ---- hierarchy (parent references — keeps arrays bounded, no embedding) ----
    parentId: { type: Types.ObjectId, ref: 'Location', default: null, index: true },
    parentType: { type: String, enum: Object.values(LOCATION_TYPE), default: null },

    countryCode: { type: String, uppercase: true, trim: true, default: 'IN', index: true },

    // ---- geo ----
    coordinates: { type: CoordinatesSchema, default: null },
    geoSourcedFrom: { type: String, enum: Object.values(GEO_SOURCE), default: GEO_SOURCE.MANUAL },

    // ---- pincode-specific delivery metadata (only meaningful when type=pincode) ----
    deliveryMeta: { type: DeliveryMetaSchema, default: null },

    // tenant-agnostic platform data; tenancy applied via ZoneServiceAreas later
    isServiceable: { type: Boolean, default: false, index: true },

    status: {
      type: String,
      enum: Object.values(LOCATION_STATUS),
      default: LOCATION_STATUS.ACTIVE,
      index: true,
    },
  },
  { collection: 'locations' }
);

LocationSchema.index({ coordinates: '2dsphere' });
LocationSchema.index({ type: 1, isServiceable: 1, status: 1 });
LocationSchema.index({ name: 1, parentId: 1 });

LocationSchema.plugin(auditPlugin);
LocationSchema.plugin(softDeletePlugin);
LocationSchema.plugin(toJSONPlugin);

export default mongoose.model('Location', LocationSchema);
