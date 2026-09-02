/**
 * gst.js — PURE GST arithmetic and identifiers (Phase 6.2).
 *
 * No database, no config lookups, no I/O: every function here is a pure
 * function of its arguments, which is what makes `scripts/tax-calc.test.js`
 * able to prove the tax maths exhaustively in milliseconds.
 *
 * WHY THIS EXISTS
 * `pricingPolicy.service.js` is a good POLICY engine but not a TAX engine:
 * it adds tax on top of the price, computes it on the pre-discount value, and
 * emits a single `taxAmount` with no CGST/SGST/IGST split, no place of supply
 * and no notion of nil-rated supply. A legally valid Indian tax invoice needs
 * all four. This module supplies them.
 *
 * THE CENTRAL IDENTITY, and why integers matter:
 *   inclusive:  taxable = round(net × 10000 / (10000 + rateBps))
 *               tax     = net − taxable          ← exact by construction
 *   exclusive:  taxable = net
 *               tax     = round(net × rateBps / 10000)
 * Deriving `tax` by SUBTRACTION in the inclusive case means the parts can
 * never fail to reconcile with what the customer actually paid — there is no
 * second rounding to disagree with the first.
 */

// ---------------------------------------------------------------------------
// GST state codes — the intra/inter-state decision depends on these
// ---------------------------------------------------------------------------

/** Official GST state codes (2-digit), keyed by code. */
export const GST_STATE_CODES = Object.freeze({
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim',
  12: 'Arunachal Pradesh', 13: 'Nagaland', 14: 'Manipur', 15: 'Mizoram',
  16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal',
  20: 'Jharkhand', 21: 'Odisha', 22: 'Chhattisgarh', 23: 'Madhya Pradesh',
  24: 'Gujarat', 26: 'Dadra and Nagar Haveli and Daman and Diu',
  27: 'Maharashtra', 29: 'Karnataka', 30: 'Goa', 31: 'Lakshadweep',
  32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 35: 'Andaman and Nicobar Islands',
  36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh', 97: 'Other Territory',
});

const NAME_TO_CODE = Object.freeze(
  Object.entries(GST_STATE_CODES).reduce((acc, [code, name]) => {
    acc[name.toLowerCase()] = String(code).padStart(2, '0');
    return acc;
  }, {
    // common aliases seen in free-text address fields
    'orissa': '21',
    'pondicherry': '34',
    'uttaranchal': '05',
    'new delhi': '07',
    'nct of delhi': '07',
    'delhi ncr': '07',
    'j&k': '01',
    'andaman & nicobar islands': '35',
    'dadra & nagar haveli': '26',
    'daman & diu': '26',
    'ap': '37',
    'ts': '36',
  })
);

/**
 * Resolve a free-text state (as stored on `Order.addressSnapshot.state`) to a
 * GST state code. Returns null when it cannot be resolved — the caller must
 * decide, because guessing the place of supply picks the wrong tax heads.
 */
export function stateCodeFromName(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^\d{1,2}$/.test(key)) {
    const padded = key.padStart(2, '0');
    return GST_STATE_CODES[padded] || GST_STATE_CODES[Number(padded)] ? padded : null;
  }
  return NAME_TO_CODE[key] || null;
}

/** The first two digits of a GSTIN are its state code. */
export function stateCodeFromGstin(gstin) {
  if (!gstin || String(gstin).length < 2) return null;
  const code = String(gstin).slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

// ---------------------------------------------------------------------------
// GSTIN validation (format + checksum)
// ---------------------------------------------------------------------------

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Validate a GSTIN's structure AND its check digit.
 *
 * The 15th character is a mod-36 checksum over the first 14, with alternating
 * weights 1,2. Validating it locally rejects typos before they reach an
 * invoice — a wrong GSTIN on an issued invoice can only be fixed by a credit
 * note, so catching it at entry is worth the 20 lines.
 */
export function computeGstinChecksum(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = GSTIN_ALPHABET.indexOf(first14[i]);
    if (value < 0) return null;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_ALPHABET[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin) {
  if (!gstin) return false;
  const g = String(gstin).toUpperCase().trim();
  if (g.length !== 15 || !GSTIN_RE.test(g)) return false;
  const expected = computeGstinChecksum(g.slice(0, 14));
  return expected !== null && expected === g[14];
}

/** PAN sits at positions 3–12 of a GSTIN. */
export function panFromGstin(gstin) {
  if (!gstin || String(gstin).length < 12) return null;
  return String(gstin).slice(2, 12);
}

// ---------------------------------------------------------------------------
// Financial year
// ---------------------------------------------------------------------------

/**
 * Indian FY label for a date: 1 Apr 2024 – 31 Mar 2025 -> '24-25'.
 * Invoice numbering must be consecutive WITHIN a financial year and restart
 * each year, so this is part of the document number, not decoration.
 */
export function fyLabel(date, startMonth = 4) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1-12
  const startYear = m >= startMonth ? y : y - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
}

/** Inclusive start / exclusive end of the FY containing `date`. */
export function fyRange(date, startMonth = 4) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const startYear = m >= startMonth ? y : y - 1;
  return {
    from: new Date(Date.UTC(startYear, startMonth - 1, 1)),
    to: new Date(Date.UTC(startYear + 1, startMonth - 1, 1)),
  };
}

// ---------------------------------------------------------------------------
// The tax computation
// ---------------------------------------------------------------------------

/** Split a tax amount into the CGST/SGST pair so the halves sum exactly. */
function halves(totalPaise) {
  const t = Math.round(totalPaise);
  const half = Math.trunc(t / 2);
  return [half, t - half];
}

/**
 * Compute the tax breakdown for ONE invoice line.
 *
 * @param {object} p
 * @param {number} p.grossPaise      what the customer is charged for the line
 * @param {number} [p.discountPaise] discount allocated to this line
 * @param {number} p.rateBps         GST rate in basis points (1800 = 18%)
 * @param {number} [p.cessBps]       compensation cess, if any
 * @param {string} [p.natureOfSupply] taxable | nil_rated | exempt | zero_rated | non_gst
 * @param {string} p.supplierStateCode
 * @param {string} p.placeOfSupplyStateCode
 * @param {boolean} [p.pricesInclusive]  true = grossPaise already contains the tax
 * @param {number} [p.knownTaxPaise]     RECONSTRUCTION mode: the tax actually
 *        charged (persisted on the order). When supplied it is authoritative
 *        and is merely SPLIT into heads — the invoice must always reconcile
 *        with what the customer actually paid, never with today's rate table.
 *
 * @returns {{taxableValuePaise, cgstPaise, sgstPaise, igstPaise, cessPaise,
 *            totalTaxPaise, lineTotalPaise, intraState, effectiveRateBps}}
 */
export function computeLineTax({
  grossPaise,
  discountPaise = 0,
  rateBps = 0,
  cessBps = 0,
  natureOfSupply = 'taxable',
  supplierStateCode,
  placeOfSupplyStateCode,
  pricesInclusive = true,
  knownTaxPaise = null,
}) {
  const gross = Math.round(Number(grossPaise) || 0);
  const discount = Math.round(Number(discountPaise) || 0);
  const net = gross - discount;

  if (net < 0) {
    throw new RangeError(`computeLineTax: discount (${discount}) exceeds gross (${gross})`);
  }

  const taxed = natureOfSupply === 'taxable' || natureOfSupply === 'zero_rated';
  const effectiveRateBps = taxed ? Math.max(0, Math.round(rateBps) || 0) : 0;

  let taxableValuePaise;
  let totalTaxPaise;

  if (knownTaxPaise !== null && knownTaxPaise !== undefined) {
    // ---- reconstruction: the charged tax is the truth, we only split it ----
    totalTaxPaise = Math.round(knownTaxPaise);
    taxableValuePaise = pricesInclusive ? net - totalTaxPaise : net;
  } else if (!taxed || effectiveRateBps === 0) {
    // nil-rated / exempt: the whole net is taxable VALUE at 0% — it must still
    // be reported (in the nil-rated column of GSTR-1), not omitted.
    taxableValuePaise = net;
    totalTaxPaise = 0;
  } else if (pricesInclusive) {
    taxableValuePaise = Math.round((net * 10000) / (10000 + effectiveRateBps));
    totalTaxPaise = net - taxableValuePaise; // exact: no second rounding
  } else {
    taxableValuePaise = net;
    totalTaxPaise = Math.round((net * effectiveRateBps) / 10000);
  }

  const cessPaise = cessBps > 0 ? Math.round((taxableValuePaise * cessBps) / 10000) : 0;

  const intraState = Boolean(supplierStateCode)
    && Boolean(placeOfSupplyStateCode)
    && String(supplierStateCode) === String(placeOfSupplyStateCode);

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (intraState) {
    [cgstPaise, sgstPaise] = halves(totalTaxPaise);
  } else {
    igstPaise = totalTaxPaise;
  }

  return {
    taxableValuePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    totalTaxPaise,
    lineTotalPaise: taxableValuePaise + totalTaxPaise + cessPaise,
    intraState,
    effectiveRateBps,
    natureOfSupply,
  };
}

/**
 * Rate-wise HSN summary — a mandatory table on a GST invoice and the exact
 * shape GSTR-1's HSN section expects. Groups by (hsnCode, rateBps).
 */
export function buildHsnSummary(lines) {
  const byKey = new Map();
  for (const l of lines) {
    const key = `${l.hsnCode || '-'}|${l.rateBps || 0}`;
    const cur = byKey.get(key) || {
      hsnCode: l.hsnCode || null,
      rateBps: l.rateBps || 0,
      natureOfSupply: l.natureOfSupply,
      qty: 0,
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
    };
    cur.qty += Number(l.qty) || 0;
    cur.taxableValuePaise += l.taxableValuePaise;
    cur.cgstPaise += l.cgstPaise;
    cur.sgstPaise += l.sgstPaise;
    cur.igstPaise += l.igstPaise;
    cur.cessPaise += l.cessPaise;
    byKey.set(key, cur);
  }
  return [...byKey.values()].sort((a, b) => (a.hsnCode || '').localeCompare(b.hsnCode || '') || a.rateBps - b.rateBps);
}

/**
 * Invoice-level round-off (s.170): the payable total is rounded to the nearest
 * rupee and the difference shown as its own line. Returns the ADJUSTMENT in
 * paise, always within [−50, +50].
 */
export function roundOffPaise(totalPaise) {
  const t = Math.round(totalPaise);
  const remainder = ((t % 100) + 100) % 100;
  return remainder === 0 ? 0 : (remainder < 50 ? -remainder : 100 - remainder);
}

/** Sum a set of computed lines into invoice totals (with round-off applied). */
export function summariseInvoice(lines) {
  const acc = {
    taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0,
    discountPaise: 0, grossPaise: 0,
  };
  for (const l of lines) {
    acc.taxableValuePaise += l.taxableValuePaise;
    acc.cgstPaise += l.cgstPaise;
    acc.sgstPaise += l.sgstPaise;
    acc.igstPaise += l.igstPaise;
    acc.cessPaise += l.cessPaise;
    acc.discountPaise += l.discountPaise || 0;
    acc.grossPaise += l.grossPaise || 0;
  }
  const totalTaxPaise = acc.cgstPaise + acc.sgstPaise + acc.igstPaise + acc.cessPaise;
  const beforeRounding = acc.taxableValuePaise + totalTaxPaise;
  const rounding = roundOffPaise(beforeRounding);
  return {
    ...acc,
    totalTaxPaise,
    roundOffPaise: rounding,
    grandTotalPaise: beforeRounding + rounding,
  };
}

export default {
  GST_STATE_CODES,
  stateCodeFromName,
  stateCodeFromGstin,
  isValidGstin,
  computeGstinChecksum,
  panFromGstin,
  fyLabel,
  fyRange,
  computeLineTax,
  buildHsnSummary,
  roundOffPaise,
  summariseInvoice,
};
