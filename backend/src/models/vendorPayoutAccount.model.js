/**
 * VendorPayoutAccount — where a vendor's money goes (Phase 6.3).
 *
 * SECURITY POSTURE (this is the account-takeover target of the whole system):
 *  - the account number is stored ENCRYPTED and `select:false`; the API only
 *    ever returns `maskedAccount`;
 *  - `fingerprint` = sha256(account+ifsc | vpa) detects a change without
 *    decrypting anything, which is what arms the post-change payout freeze;
 *  - a change resets verification and starts `frozenUntil`, so a stolen
 *    session cannot redirect the next payout;
 *  - no payout may be built for an account that is not `verified` AND whose
 *    KYC is not `approved`.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { PAYOUT_METHOD, KYC_STATUS, BANK_VERIFICATION_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const VendorPayoutAccountSchema = new Schema(
  {
    vendorId: { type: Types.ObjectId, ref: 'Vendor', required: true, index: true },
    method: { type: String, enum: Object.values(PAYOUT_METHOD), default: PAYOUT_METHOD.UPI },

    accountHolderName: { type: String, default: null, maxlength: 120 },
    accountNumberEnc: { type: String, default: null, select: false },
    ifsc: { type: String, default: null, uppercase: true, maxlength: 11 },
    vpa: { type: String, default: null, lowercase: true, maxlength: 100 },
    bankName: { type: String, default: null, maxlength: 120 },
    maskedAccount: { type: String, default: null, maxlength: 40 },
    fingerprint: { type: String, default: null, index: true },

    verification: {
      status: {
        type: String,
        enum: Object.values(BANK_VERIFICATION_STATUS),
        default: BANK_VERIFICATION_STATUS.UNVERIFIED,
      },
      method: { type: String, enum: ['penny_drop', 'vpa_validate', 'manual'], default: null },
      ref: { type: String, default: null, maxlength: 120 },
      nameMatchScore: { type: Number, default: null, min: 0, max: 1 },
      verifiedAt: { type: Date, default: null },
      lastError: { type: String, default: null, maxlength: 300 },
    },

    kyc: {
      pan: { type: String, default: null, uppercase: true, maxlength: 10 },
      gstin: { type: String, default: null, uppercase: true, maxlength: 15 },
      documents: [{ type: Types.ObjectId, ref: 'MediaAsset' }],
      status: { type: String, enum: Object.values(KYC_STATUS), default: KYC_STATUS.NOT_SUBMITTED },
      reviewedBy: { type: Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null, maxlength: 300 },
    },

    /** Payouts are refused until this passes (set on any bank-detail change). */
    frozenUntil: { type: Date, default: null },
    isDefault: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true },

    /** Provider-side fund account id (RazorpayX contact/fund_account, etc.). */
    providerRefs: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'vendorpayoutaccounts' }
);

VendorPayoutAccountSchema.index(
  { vendorId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true, status: 'active' } }
);

/** True when this account may receive money right now. */
VendorPayoutAccountSchema.methods.isPayable = function isPayable(now = new Date()) {
  return this.status === 'active'
    && this.verification?.status === BANK_VERIFICATION_STATUS.VERIFIED
    && this.kyc?.status === KYC_STATUS.APPROVED
    && (!this.frozenUntil || this.frozenUntil <= now);
};

VendorPayoutAccountSchema.plugin(auditPlugin);
VendorPayoutAccountSchema.plugin(softDeletePlugin);
VendorPayoutAccountSchema.plugin(toJSONPlugin);

export default mongoose.model('VendorPayoutAccount', VendorPayoutAccountSchema);
