/** GST/tax display metadata + form converters (matches backend enums). */

export const TAX_DOC_TYPE_META = {
  invoice: { label: 'Tax invoice', tone: 'sky' },
  credit_note: { label: 'Credit note', tone: 'violet' },
};

export const TAX_DOC_STATUS_META = {
  draft: { label: 'Draft', tone: 'slate' },
  issued: { label: 'Issued', tone: 'emerald' },
  cancelled: { label: 'Cancelled', tone: 'rose' },
};

export const EINVOICE_STATUS_META = {
  not_applicable: { label: 'Not applicable', tone: 'slate' },
  pending: { label: 'Pending', tone: 'amber' },
  generated: { label: 'Generated', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export const TAX_REGISTRATION_TYPE_META = {
  regular: { label: 'Regular', tone: 'emerald' },
  composition: { label: 'Composition', tone: 'sky' },
  unregistered: { label: 'Unregistered', tone: 'slate' },
};

export const TAX_NATURE_OF_SUPPLY_META = {
  taxable: { label: 'Taxable', tone: 'emerald' },
  nil_rated: { label: 'Nil-rated', tone: 'sky' },
  exempt: { label: 'Exempt', tone: 'violet' },
  zero_rated: { label: 'Zero-rated (export/SEZ)', tone: 'amber' },
  non_gst: { label: 'Non-GST', tone: 'slate' },
};

export const STATUTORY_RATE_KIND_META = {
  tcs_gst_52: { label: 'TCS — GST s.52', tone: 'rose' },
  tds_194o: { label: 'TDS — IT s.194-O', tone: 'sky' },
};

export const CREDIT_NOTE_REASON_META = {
  return: { label: 'Return', tone: 'emerald' },
  cancellation: { label: 'Cancellation', tone: 'rose' },
  price_revision: { label: 'Price revision', tone: 'violet' },
  deficiency: { label: 'Deficiency', tone: 'amber' },
  other: { label: 'Other', tone: 'slate' },
};

export const STATUTORY_APPLIES_TO_META = {
  net_taxable: { label: 'Net taxable value', tone: 'sky' },
  gross_sales: { label: 'Gross sales', tone: 'violet' },
};

export const TAX_TABS = [
  ['registration', 'Registration'],
  ['documents', 'Documents'],
  ['series', 'Series audit'],
  ['rates', 'Rates & policies'],
];

const nullish = (v) => (v === null || v === undefined || v === '' ? null : v);

export const emptyRegistration = () => ({
  legalName: '',
  tradeName: '',
  gstin: '',
  pan: '',
  stateCode: '',
  registrationType: 'regular',
  turnoverBand: 'lt_5cr',
  einvoiceEnabled: false,
  status: 'active',
  address: { line1: '', line2: '', city: '', state: '', pincode: '' },
  contact: { email: '', phone: '' },
  invoiceFooter: '',
  invoiceTerms: '',
  signatureUrl: '',
});

export const registrationToForm = (r) => ({
  legalName: r.legalName || '',
  tradeName: r.tradeName || '',
  gstin: r.gstin || '',
  pan: r.pan || '',
  stateCode: r.stateCode || '',
  registrationType: r.registrationType || 'regular',
  turnoverBand: r.turnoverBand || 'lt_5cr',
  einvoiceEnabled: Boolean(r.einvoiceEnabled),
  status: r.status || 'active',
  address: {
    line1: r.address?.line1 || '',
    line2: r.address?.line2 || '',
    city: r.address?.city || '',
    state: r.address?.state || '',
    pincode: r.address?.pincode || '',
  },
  contact: { email: r.contact?.email || '', phone: r.contact?.phone || '' },
  invoiceFooter: r.invoiceFooter || '',
  invoiceTerms: r.invoiceTerms || '',
  signatureUrl: r.signatureUrl || '',
});

export const registrationPayload = (f) => ({
  legalName: String(f.legalName || '').trim(),
  tradeName: String(f.tradeName || '').trim() || null,
  gstin: String(f.gstin || '').trim().toUpperCase() || null,
  pan: String(f.pan || '').trim().toUpperCase() || null,
  stateCode: String(f.stateCode || '').trim() || null,
  registrationType: f.registrationType,
  turnoverBand: f.turnoverBand,
  einvoiceEnabled: Boolean(f.einvoiceEnabled),
  status: f.status === 'active' ? 'active' : 'inactive',
  address: {
    line1: nullish(f.address?.line1),
    line2: nullish(f.address?.line2),
    city: nullish(f.address?.city),
    state: nullish(f.address?.state),
    pincode: nullish(f.address?.pincode),
  },
  contact: {
    email: nullish(f.contact?.email),
    phone: nullish(f.contact?.phone),
  },
  invoiceFooter: nullish(f.invoiceFooter),
  invoiceTerms: nullish(f.invoiceTerms),
  signatureUrl: nullish(f.signatureUrl),
});

export const emptyTaxPolicy = () => ({
  categoryId: '',
  gstSlabPct: '',
  natureOfSupply: 'taxable',
  cessBps: '',
  hsnCode: '',
  effectiveFrom: '',
});

export const taxPolicyPayload = (f) => {
  const pct = Number(f.gstSlabPct);
  return {
    categoryId: f.categoryId,
    gstSlabPct: pct,
    rateBps: Math.round(pct * 100),
    natureOfSupply: f.natureOfSupply,
    cessBps: f.cessBps === '' ? 0 : Number(f.cessBps),
    hsnCode: String(f.hsnCode || '').trim() || null,
    effectiveFrom: f.effectiveFrom || undefined,
  };
};

export const emptyStatutoryRate = () => ({
  kind: 'tcs_gst_52',
  ratePct: '',
  appliesTo: 'net_taxable',
  effectiveFrom: '',
  notificationRef: '',
  note: '',
});

export const statutoryRatePayload = (f) => ({
  kind: f.kind,
  rateBps: Math.round(Number(f.ratePct) * 100),
  appliesTo: f.appliesTo,
  effectiveFrom: f.effectiveFrom || undefined,
  notificationRef: String(f.notificationRef || '').trim() || null,
  note: String(f.note || '').trim() || null,
});

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** 1800 bps -> "18" for display; 50 bps -> "0.5". */
export const bpsToPct = (bps) => {
  const n = Number(bps);
  return Number.isFinite(n) ? Number((n / 100).toFixed(2)) : null;
};
