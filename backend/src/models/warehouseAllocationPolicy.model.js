import mongoose from 'mongoose';
import { auditPlugin, softDeletePlugin, toJSONPlugin } from './plugins/index.js';
import { FULFILLMENT_SPLIT_POLICY, WAREHOUSE_ALLOCATION_STRATEGY } from '../constants/enums.js';

const { Schema, Types } = mongoose;

/** Tenant-scoped policy controlling which physical stock is promiseable. */
const WarehouseAllocationPolicySchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true },
  strategy: {
    type: String, enum: Object.values(WAREHOUSE_ALLOCATION_STRATEGY),
    default: WAREHOUSE_ALLOCATION_STRATEGY.NEAREST_AVAILABLE,
  },
  splitPolicy: {
    type: String, enum: Object.values(FULFILLMENT_SPLIT_POLICY),
    default: FULFILLMENT_SPLIT_POLICY.NEVER,
  },
  reserveSafetyStock: { type: Number, default: 0, min: 0, max: 100000, validate: Number.isInteger },
  allowLegacyDefaultStock: { type: Boolean, default: true },
  requirePincodeForPromise: { type: Boolean, default: true },
  maxCandidateHubs: { type: Number, default: 12, validate: Number.isInteger, min: 1, max: 50 },
  defaultHandlingMinutes: { type: Number, default: 30, validate: Number.isInteger, min: 0, max: 10080 },
  version: { type: Number, default: 1, min: 1 },
  updatedBy: { type: Types.ObjectId, ref: 'User', default: null },
}, { collection: 'warehouseallocationpolicies' });

WarehouseAllocationPolicySchema.index(
  { tenantId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, name: 'warehouse_allocation_policy_tenant_uq' },
);

WarehouseAllocationPolicySchema.plugin(auditPlugin);
WarehouseAllocationPolicySchema.plugin(softDeletePlugin);
WarehouseAllocationPolicySchema.plugin(toJSONPlugin);

export default mongoose.models.WarehouseAllocationPolicy
  || mongoose.model('WarehouseAllocationPolicy', WarehouseAllocationPolicySchema);
