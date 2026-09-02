/**
 * PayoutLineItem — the eligibility ledger: one row per sold order item (6.3).
 *
 * This is what makes "what do we owe this vendor, and for exactly what?" a
 * query instead of an argument. Every deduction is stored as its own field, so
 * a vendor's statement can show the arithmetic line by line and a dispute is
 * answered by pointing at a row rather than by re-deriving it.
 *
 * All amounts are integer PAISE. A REVERSED line (refund before payout) carries
 * NEGATIVE values so a cycle is simply the sum of its lines.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { PAYOUT_LINE_STATE, PAYOUT_HOLD_REASON } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const PayoutLineItemSchema = new Schema(
  {
    vendorId: { type: Types.ObjectId, ref: 'Vendor', required: true, index: true },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', required: true, index: true },
    orderItemId: { type: Types.ObjectId, ref: 'OrderItem', default: null },
    orderNumber: { type: String, default: null, maxlength: 40 },
    taxDocumentId: { type: Types.ObjectId, ref: 'TaxDocument', default: null },

    // ---- the arithmetic, frozen at accrual ----
    grossPaise: { type: Number, required: true },          // what the customer paid for this line
    taxableValuePaise: { type: Number, default: 0 },       // ex-GST value
    sellerGstPaise: { type: Number, default: 0 },          // GST the seller must deposit
    commissionRateBps: { type: Number, default: 0 },
    commissionPaise: { type: Number, default: 0 },
    gstOnCommissionPaise: { type: Number, default: 0 },
    tcsRateBps: { type: Number, default: 0 },
    tcsPaise: { type: Number, default: 0 },
    tdsRateBps: { type: Number, default: 0 },
    tdsPaise: { type: Number, default: 0 },
    shippingSharePaise: { type: Number, default: 0 },
    netPayablePaise: { type: Number, required: true },

    // ---- eligibility ----
    state: {
      type: String,
      enum: Object.values(PAYOUT_LINE_STATE),
      default: PAYOUT_LINE_STATE.ACCRUED,
      index: true,
    },
    deliveredAt: { type: Date, default: null },
    eligibleAt: { type: Date, default: null, index: true },
    holdReason: { type: String, enum: Object.values(PAYOUT_HOLD_REASON), default: null },
    holdNote: { type: String, default: null, maxlength: 300 },

    // ---- settlement ----
    payoutBatchId: { type: Types.ObjectId, ref: 'PayoutBatch', default: null, index: true },
    paidAt: { type: Date, default: null },

    // ---- reversal (refund / return) ----
    reversalOfLineId: { type: Types.ObjectId, ref: 'PayoutLineItem', default: null },
    refundTransactionId: { type: Types.ObjectId, ref: 'RefundTransaction', default: null },
    creditNoteId: { type: Types.ObjectId, ref: 'TaxDocument', default: null },

    currency: { type: String, default: 'INR', maxlength: 8 },
  },
  { collection: 'payoutlineitems' }
);

// one accrual per order item (reversals carry reversalOfLineId, so they are
// excluded from the uniqueness constraint)
PayoutLineItemSchema.index(
  { orderItemId: 1 },
  { unique: true, partialFilterExpression: { orderItemId: { $type: 'objectId' }, reversalOfLineId: null } }
);
PayoutLineItemSchema.index({ vendorId: 1, state: 1, eligibleAt: 1 }); // cycle sweep
PayoutLineItemSchema.index({ state: 1, eligibleAt: 1 });

PayoutLineItemSchema.plugin(auditPlugin);
PayoutLineItemSchema.plugin(softDeletePlugin);
PayoutLineItemSchema.plugin(toJSONPlugin);

export default mongoose.model('PayoutLineItem', PayoutLineItemSchema);
