/**
 * TaxRegistration — who the SUPPLIER legally is (Phase 6.2).
 *
 * A tax invoice is issued by a legal person, not by a database row: it needs a
 * GSTIN, a legal name and a registered address, and the GSTIN's state code is
 * half of the intra-state/inter-state decision. One registration per owner —
 * the platform, a store (tenant), or a vendor.
 *
 * The registration is SNAPSHOTTED onto every document at issue time, so a
 * later change of address or trade name never rewrites an issued invoice.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { TAX_OWNER_TYPE, TAX_REGISTRATION_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TaxRegistrationSchema = new Schema(
  {
    ownerType: { type: String, enum: Object.values(TAX_OWNER_TYPE), required: true, index: true },
    ownerId: { type: Types.ObjectId, default: null, index: true }, // null for the platform itself

    legalName: { type: String, required: true, maxlength: 160 },
    tradeName: { type: String, default: null, maxlength: 160 },
    gstin: { type: String, default: null, uppercase: true, trim: true, maxlength: 15 },
    pan: { type: String, default: null, uppercase: true, trim: true, maxlength: 10 },

    /** 2-digit GST state code — drives CGST+SGST vs IGST. */
    stateCode: { type: String, required: true, maxlength: 2 },
    address: {
      line1: { type: String, default: null, maxlength: 200 },
      line2: { type: String, default: null, maxlength: 200 },
      city: { type: String, default: null, maxlength: 80 },
      state: { type: String, default: null, maxlength: 80 },
      pincode: { type: String, default: null, maxlength: 10 },
    },
    contact: {
      email: { type: String, default: null, maxlength: 160 },
      phone: { type: String, default: null, maxlength: 20 },
    },

    registrationType: {
      type: String,
      enum: Object.values(TAX_REGISTRATION_TYPE),
      default: TAX_REGISTRATION_TYPE.UNREGISTERED,
    },

    /** Aggregate annual turnover band — decides e-invoicing applicability. */
    turnoverBand: { type: String, enum: ['lt_5cr', 'gte_5cr'], default: 'lt_5cr' },
    einvoiceEnabled: { type: Boolean, default: false },

    /** Invoice presentation (branding is data, like notification templates). */
    invoiceFooter: { type: String, default: null, maxlength: 1000 },
    invoiceTerms: { type: String, default: null, maxlength: 2000 },
    signatureUrl: { type: String, default: null },

    verifiedAt: { type: Date, default: null },
    verificationRef: { type: String, default: null, maxlength: 120 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  },
  { collection: 'taxregistrations' }
);

TaxRegistrationSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });
TaxRegistrationSchema.index({ gstin: 1 }, { unique: true, partialFilterExpression: { gstin: { $type: 'string' } } });

TaxRegistrationSchema.plugin(auditPlugin);
TaxRegistrationSchema.plugin(softDeletePlugin);
TaxRegistrationSchema.plugin(toJSONPlugin);

export default mongoose.model('TaxRegistration', TaxRegistrationSchema);
