/**
 * Invoice — a tenant's bill for one billing period (Phase 5).
 *
 * Line items are FROZEN at generation time (subscription fee from the plan
 * snapshot, commission from the period GMV × commissionRateBps, optional
 * pro-rata adjustment). Unique (tenantId, period.from, period.to) makes the
 * billing cycle idempotent — re-running a period never duplicates an invoice.
 * Number format: INV-{YYMM}-{seq} (unique per platform).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { INVOICE_STATUS, INVOICE_LINE_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const InvoiceSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    number: { type: String, required: true, unique: true, index: true },
    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    dueAt: { type: Date, default: null },

    lineItems: [
      {
        type: { type: String, enum: Object.values(INVOICE_LINE_TYPE), required: true },
        label: { type: String, required: true, maxlength: 200 },
        qty: { type: Number, default: 1, min: 0 },
        unitAmount: { type: Number, default: 0, min: 0 },
        amount: { type: Number, required: true, min: 0 },
      },
    ],
    subtotal: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: Object.values(INVOICE_STATUS),
      default: INVOICE_STATUS.DRAFT,
      index: true,
    },
    paidAt: { type: Date, default: null },
    paymentRef: { type: String, default: null },
    generatedBy: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'invoices' }
);

InvoiceSchema.index({ tenantId: 1, status: 1 });
InvoiceSchema.index({ tenantId: 1, 'period.from': 1, 'period.to': 1 }, { unique: true });
InvoiceSchema.index({ status: 1, dueAt: 1 }); // overdue sweep

InvoiceSchema.plugin(auditPlugin);
InvoiceSchema.plugin(softDeletePlugin);
InvoiceSchema.plugin(toJSONPlugin);

export default mongoose.model('Invoice', InvoiceSchema);
