/**
 * Platform lifecycle, KYC and ops metadata.
 *
 * The label/tone vocabulary lives in `@flower-market/shared` so the mobile app
 * stays aligned. This module only adds web-console helpers.
 */
import {
  BANK_VERIFICATION_META, EXPORT_STATUS_META, EXPORT_TYPE_LABELS,
  KYC_STATUS_META, TENANT_STATUS_META, VENDOR_STATUS_LIFECYCLE_META,
} from '@flower-market/shared';

export {
  BANK_VERIFICATION_META, EXPORT_STATUS_META, EXPORT_TYPE_LABELS,
  KYC_STATUS_META, TENANT_STATUS_META, VENDOR_STATUS_LIFECYCLE_META,
};

export const fmtKycDocumentRole = (i) => ['PAN', 'GSTIN', 'Bank proof', `Other ${i - 2}`][i] || `Document ${i + 1}`;

/** Ops run result table: coerce errors to a safe display row. */
export const opRows = (obj = {}) =>
  Object.entries(obj).map(([key, value]) => {
    const v = value && typeof value === 'object' ? value : { value };
    return { key, ...v };
  });
