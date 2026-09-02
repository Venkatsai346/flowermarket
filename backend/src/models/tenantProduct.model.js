/**
 * TenantProduct — the row that makes a ProductMaster SELLABLE in a tenant.
 *
 * THE core of the multi-tenant catalog model:
 *  - ProductMaster is shared globally; TenantProduct carries per-tenant
 *    PRICE, STOCK (snapshot), LISTING STATUS.
 *  - A product shows up for customers of tenant A only when
 *    TenantProduct(tenant=A).status = ACTIVE — even though the master is shared
 *    with 50 other tenants.
 *  - `version` + optimistic locking for price/status updates.
 *  - `variantId` optional: lists a specific global variant as its own SKU.
 *
 * Status transitions:
 *   DRAFT -> ACTIVE (requires master ACTIVE + price set)
 *   ACTIVE <-> INACTIVE ; ACTIVE -> OUT_OF_STOCK (stock snapshot zeroed)
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { TENANT_LISTING_STATUS, AVAILABILITY_STATUS, PRICE_CURRENCY } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const PriceSchema = new Schema(
  {
    mrp: { type: Number, min: 0, default: null },
    sellingPrice: { type: Number, min: 0, default: null },
    currency: {
      type: String,
      enum: Object.values(PRICE_CURRENCY),
      default: PRICE_CURRENCY.INR,
    },
  },
  { _id: false }
);

const OrderLimitsSchema = new Schema(
  {
    minOrderQty: { type: Number, min: 1, default: null }, // null = fall back to master
    maxOrderQty: { type: Number, min: 1, default: null },
  },
  { _id: false }
);

const TenantProductSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true, index: true },
    variantId: { type: Types.ObjectId, ref: 'ProductVariant', default: null },

    price: { type: PriceSchema, default: () => ({}) },
    orderLimits: { type: OrderLimitsSchema, default: () => ({}) },

    // stock snapshot — truth lives in the Inventory collection; kept here for
    // cheap availability reads & customer queries
    stockQty: { type: Number, default: 0, min: 0 },
    availability: {
      status: {
        type: String,
        enum: Object.values(AVAILABILITY_STATUS),
        default: AVAILABILITY_STATUS.IN_STOCK,
      },
      updatedAt: { type: Date, default: null },
    },

    status: {
      type: String,
      enum: Object.values(TENANT_LISTING_STATUS),
      default: TENANT_LISTING_STATUS.DRAFT,
      index: true,
    },

    version: { type: Number, default: 1, min: 1 },

    listedBy: { type: Types.ObjectId, ref: 'User', default: null },
    lastPriceChangedAt: { type: Date, default: null },
    lastStockChangedAt: { type: Date, default: null },
    lastStatusChangedAt: { type: Date, default: null },
  },
  { collection: 'tenantproducts' }
);

// one listing per (tenant, master) or (tenant, master, variant)
TenantProductSchema.index({ tenantId: 1, productMasterId: 1, variantId: 1 }, { unique: true });
TenantProductSchema.index({ tenantId: 1, status: 1 });
TenantProductSchema.index({ tenantId: 1, productMasterId: 1 });

TenantProductSchema.plugin(auditPlugin);
TenantProductSchema.plugin(softDeletePlugin);
TenantProductSchema.plugin(toJSONPlugin);

export default mongoose.model('TenantProduct', TenantProductSchema);
