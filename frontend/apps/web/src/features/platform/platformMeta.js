/** Platform lifecycle, KYC and ops metadata (matches backend enums). */

export const KYC_STATUS_META = {
  not_submitted: { label: 'Not submitted', tone: 'slate' },
  pending: { label: 'Pending review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
};

export const BANK_VERIFICATION_META = {
  unverified: { label: 'Unverified', tone: 'slate' },
  pending: { label: 'Pending', tone: 'amber' },
  verified: { label: 'Verified', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const EXPORT_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  running: { label: 'Running', tone: 'sky' },
  done: { label: 'Done', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const EXPORT_TYPE_LABELS = {
  analytics_daily: 'Analytics daily',
  orders: 'Orders',
  inventory: 'Inventory',
  products: 'Products',
  users: 'Users',
  gstr1_b2b: 'GSTR-1 B2B',
  gstr1_b2cs: 'GSTR-1 B2CS',
  gstr1_hsn: 'GSTR-1 HSN',
  gstr1_cdnr: 'GSTR-1 CDNR',
  gstr8_tcs: 'GSTR-8 TCS',
  tds_194o: 'TDS 194-O',
  payout_statement: 'Payout statement',
  sales_register: 'Sales register',
};

export const TENANT_STATUS_META = {
  active: { label: 'Active', tone: 'emerald' },
  inactive: { label: 'Inactive', tone: 'slate' },
  blocked: { label: 'Blocked', tone: 'rose' },
  suspended: { label: 'Suspended', tone: 'rose' },
};

export const VENDOR_STATUS_LIFECYCLE_META = {
  active: { label: 'Active', tone: 'emerald' },
  suspended: { label: 'Suspended', tone: 'rose' },
};

export const fmtKycDocumentRole = (i) => ['PAN', 'GSTIN', 'Bank proof', `Other ${i - 2}`][i] || `Document ${i + 1}`;

/** Ops run result table: coerce errors to a safe display row. */
export const opRows = (obj = {}) =>
  Object.entries(obj).map(([key, value]) => {
    const v = value && typeof value === 'object' ? value : { value };
    return { key, ...v };
  });
