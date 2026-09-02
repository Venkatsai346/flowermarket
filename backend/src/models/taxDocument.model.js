/**
 * TaxDocument — an immutable tax invoice or credit note (Phase 6.2).
 *
 * ── One model, two document types (deviation from the blueprint, on purpose) ─
 * The plan specified separate `TaxInvoice` and `CreditNote` collections. They
 * share ~60 fields, the same numbering machinery, the same PDF renderer and the
 * same GSTR export queries — and a credit note is legally a *correction to* an
 * invoice, always reported alongside it. One collection discriminated by
 * `docType` (with series keyed on docType, so numbering stays legally separate)
 * removes the duplication without weakening any constraint. Documented here so
 * the divergence from the blueprint is deliberate and visible.
 *
 * ── Immutability ─────────────────────────────────────────────────────────────
 * Once `status === 'issued'` this document never changes. Not the amounts, not
 * the supplier, not the recipient. A mistake is corrected by issuing a credit
 * note; a document that must not exist is CANCELLED, keeping its number so the
 * series stays gapless. The service enforces this; the schema records it.
 *
 * ── Why every rate is stored inline ──────────────────────────────────────────
 * `lines[].rateBps` is a VALUE, not a reference to TaxPolicy. When a slab
 * changes next year, re-rendering a two-year-old invoice must produce the same
 * numbers it produced then. A reference would silently re-price history; a
 * stored value cannot. Same reason `supplier` and `recipient` are snapshots.
 *
 * ── Ledger relationship ──────────────────────────────────────────────────────
 * Issuing a document posts NO ledger journal. The money was already recognised
 * by `sale_captured` when the order was confirmed (and reversed by
 * `refund_issued`). A tax document is the legal *evidence* of a movement that
 * the ledger already recorded — posting again would double-count.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import {
  TAX_DOC_TYPE,
  TAX_DOC_STATUS,
  TAX_NATURE_OF_SUPPLY,
  TAX_OWNER_TYPE,
  EINVOICE_STATUS,
  CREDIT_NOTE_REASON,
} from '../constants/enums.js';

const { Schema, Types } = mongoose;

/** Snapshot of a party at issue time — never a live reference. */
const PartySchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 160 },
    tradeName: { type: String, default: null, maxlength: 160 },
    gstin: { type: String, default: null, maxlength: 15 },
    stateCode: { type: String, default: null, maxlength: 2 },
    address: {
      line1: { type: String, default: null, maxlength: 200 },
      line2: { type: String, default: null, maxlength: 200 },
      city: { type: String, default: null, maxlength: 80 },
      state: { type: String, default: null, maxlength: 80 },
      pincode: { type: String, default: null, maxlength: 10 },
    },
    email: { type: String, default: null, maxlength: 160 },
    phone: { type: String, default: null, maxlength: 20 },
  },
  { _id: false }
);

const LineSchema = new Schema(
  {
    orderItemId: { type: Types.ObjectId, ref: 'OrderItem', default: null },
    description: { type: String, required: true, maxlength: 200 },
    hsnCode: { type: String, default: null, maxlength: 16 },
    qty: { type: Number, required: true, min: 0 },
    uom: { type: String, default: 'PCS', maxlength: 12 },

    // all monetary values are integer PAISE
    unitPricePaise: { type: Number, default: 0 },
    grossPaise: { type: Number, required: true },      // charged before discount
    discountPaise: { type: Number, default: 0 },
    taxableValuePaise: { type: Number, required: true },

    rateBps: { type: Number, default: 0, min: 0, max: 10000 },
    cessBps: { type: Number, default: 0, min: 0 },
    natureOfSupply: {
      type: String,
      enum: Object.values(TAX_NATURE_OF_SUPPLY),
      default: TAX_NATURE_OF_SUPPLY.TAXABLE,
    },

    cgstPaise: { type: Number, default: 0 },
    sgstPaise: { type: Number, default: 0 },
    igstPaise: { type: Number, default: 0 },
    cessPaise: { type: Number, default: 0 },
    lineTotalPaise: { type: Number, required: true },
  },
  { _id: false }
);

const HsnSummarySchema = new Schema(
  {
    hsnCode: { type: String, default: null, maxlength: 16 },
    rateBps: { type: Number, default: 0 },
    natureOfSupply: { type: String, default: null },
    qty: { type: Number, default: 0 },
    taxableValuePaise: { type: Number, default: 0 },
    cgstPaise: { type: Number, default: 0 },
    sgstPaise: { type: Number, default: 0 },
    igstPaise: { type: Number, default: 0 },
    cessPaise: { type: Number, default: 0 },
  },
  { _id: false }
);

const TaxDocumentSchema = new Schema(
  {
    docType: { type: String, enum: Object.values(TAX_DOC_TYPE), required: true, index: true },

    // ---- identity ----
    number: { type: String, required: true, maxlength: 32 }, // e.g. FM/24-25/000123
    seriesCode: { type: String, default: 'A', maxlength: 8 },
    fyLabel: { type: String, required: true, maxlength: 8, index: true },
    sequence: { type: Number, required: true, min: 1 },

    // ---- scope ----
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true },
    supplierType: { type: String, enum: Object.values(TAX_OWNER_TYPE), required: true },

    // ---- references ----
    orderId: { type: Types.ObjectId, ref: 'Order', default: null, index: true },
    orderNumber: { type: String, default: null, maxlength: 40 },
    originalDocumentId: { type: Types.ObjectId, ref: 'TaxDocument', default: null }, // credit notes
    originalNumber: { type: String, default: null, maxlength: 32 },
    refundTransactionId: { type: Types.ObjectId, ref: 'RefundTransaction', default: null },
    returnRequestId: { type: Types.ObjectId, ref: 'ReturnRequest', default: null },
    reason: { type: String, enum: Object.values(CREDIT_NOTE_REASON), default: null },

    // ---- parties (snapshots) ----
    supplier: { type: PartySchema, required: true },
    recipient: { type: PartySchema, required: true },
    placeOfSupplyStateCode: { type: String, required: true, maxlength: 2 },
    reverseCharge: { type: Boolean, default: false },

    // ---- dates ----
    issuedAt: { type: Date, default: null },
    supplyDate: { type: Date, required: true },

    // ---- content ----
    lines: { type: [LineSchema], required: true },
    hsnSummary: { type: [HsnSummarySchema], default: [] },
    totals: {
      grossPaise: { type: Number, default: 0 },
      discountPaise: { type: Number, default: 0 },
      taxableValuePaise: { type: Number, default: 0 },
      cgstPaise: { type: Number, default: 0 },
      sgstPaise: { type: Number, default: 0 },
      igstPaise: { type: Number, default: 0 },
      cessPaise: { type: Number, default: 0 },
      totalTaxPaise: { type: Number, default: 0 },
      roundOffPaise: { type: Number, default: 0 },
      grandTotalPaise: { type: Number, required: true },
    },
    currency: { type: String, default: 'INR', maxlength: 8 },
    amountInWords: { type: String, default: null, maxlength: 300 },

    // ---- lifecycle ----
    status: {
      type: String,
      enum: Object.values(TAX_DOC_STATUS),
      default: TAX_DOC_STATUS.DRAFT,
      index: true,
    },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, maxlength: 300 },

    // ---- e-invoice (IRP) ----
    einvoice: {
      status: {
        type: String,
        enum: Object.values(EINVOICE_STATUS),
        default: EINVOICE_STATUS.NOT_APPLICABLE,
      },
      irn: { type: String, default: null, maxlength: 80 },
      ackNo: { type: String, default: null, maxlength: 40 },
      ackDate: { type: Date, default: null },
      signedQrPayload: { type: String, default: null },
      attempts: { type: Number, default: 0 },
      lastError: { type: String, default: null, maxlength: 400 },
      provider: { type: String, default: null, maxlength: 20 },
    },

    pdf: {
      mediaAssetId: { type: Types.ObjectId, ref: 'MediaAsset', default: null },
      generatedAt: { type: Date, default: null },
    },

    issuedBy: { type: Types.ObjectId, ref: 'User', default: null },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'taxdocuments' }
);

// numbering: unique per series, and unique globally by number
TaxDocumentSchema.index({ number: 1 }, { unique: true });
TaxDocumentSchema.index(
  { supplierType: 1, vendorId: 1, tenantId: 1, docType: 1, fyLabel: 1, seriesCode: 1, sequence: 1 },
  { unique: true }
);
// one issued invoice per order per supplier (a multi-vendor order yields one
// document per selling entity, which is what the law requires)
TaxDocumentSchema.index(
  { orderId: 1, docType: 1, vendorId: 1 },
  { unique: true, partialFilterExpression: { orderId: { $type: 'objectId' }, docType: 'invoice' } }
);
TaxDocumentSchema.index({ tenantId: 1, issuedAt: -1 });
TaxDocumentSchema.index({ 'einvoice.status': 1 }); // retry queue

TaxDocumentSchema.plugin(auditPlugin);
TaxDocumentSchema.plugin(softDeletePlugin);
TaxDocumentSchema.plugin(toJSONPlugin);

export default mongoose.model('TaxDocument', TaxDocumentSchema);
