import TaxDocument from '../models/taxDocument.model.js';
import Vendor from '../models/vendor.model.js';
import taxService from './tax.service.js';
import { fromPaise } from '../utils/money.js';
import { GST_STATE_CODES } from '../utils/gst.js';
import {
  TAX_DOC_TYPE, TAX_DOC_STATUS, STATUTORY_RATE_KIND,
} from '../constants/enums.js';

/**
 * GstrExportService — filing-ready report rows (Phase 6.3 / M3).
 *
 * Every function here returns a plain array of row objects; the existing
 * Phase-4b `ExportService` turns them into idempotent, downloadable CSV
 * artifacts. No new export machinery was built — `jobKey` uniqueness, the
 * worker, the artifact store and the download route already exist.
 *
 * SCOPE AND HONESTY
 * These are *working papers*, not a filing integration. They reproduce the
 * shape of the GSTR-1 / GSTR-8 / 26Q tables so an accountant can reconcile and
 * upload, and they are computed from ISSUED documents only — never from
 * drafts, never from cancelled documents. Filing through a GSP is a separate
 * decision with its own compliance surface.
 *
 * A NOTE ON PERIODS
 * GST periods are calendar months in the supplier's own timezone. Every query
 * here is `issuedAt` between [from, to), and the caller (the nightly job or an
 * admin) supplies the month boundaries — so re-running a period is stable.
 */

const rs = (paise) => fromPaise(paise || 0);
const stateName = (code) => GST_STATE_CODES[code] || GST_STATE_CODES[Number(code)] || code;
const posLabel = (code) => `${code}-${stateName(code)}`;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/** Documents in scope: issued only, within the period, for this tenant. */
function periodQuery({ tenantId, from, to, docType }) {
  return {
    tenantId,
    docType,
    status: TAX_DOC_STATUS.ISSUED,
    issuedAt: { $gte: new Date(from), $lt: new Date(to) },
  };
}

class GstrExportService {
  // -------------------------------------------------------------------------
  // GSTR-1 — outward supplies
  // -------------------------------------------------------------------------

  /**
   * B2B: supplies to registered recipients, reported INVOICE-WISE and split by
   * rate (one row per invoice per rate, which is what the portal expects).
   */
  async gstr1B2b({ tenantId, from, to }) {
    const docs = await TaxDocument.find({
      ...periodQuery({ tenantId, from, to, docType: TAX_DOC_TYPE.INVOICE }),
      'recipient.gstin': { $ne: null },
    }).sort({ issuedAt: 1 }).lean();

    const rows = [];
    for (const d of docs) {
      const byRate = new Map();
      for (const l of d.lines) {
        const cur = byRate.get(l.rateBps) || { taxable: 0, cess: 0 };
        cur.taxable += l.taxableValuePaise;
        cur.cess += l.cessPaise;
        byRate.set(l.rateBps, cur);
      }
      for (const [rateBps, agg] of byRate) {
        rows.push({
          recipientGstin: d.recipient.gstin,
          recipientName: d.recipient.name,
          invoiceNumber: d.number,
          invoiceDate: ymd(d.issuedAt),
          invoiceValue: rs(d.totals.grandTotalPaise),
          placeOfSupply: posLabel(d.placeOfSupplyStateCode),
          reverseCharge: d.reverseCharge ? 'Y' : 'N',
          invoiceType: 'Regular B2B',
          ecommerceGstin: d.supplier.gstin || '',
          rate: rateBps / 100,
          taxableValue: rs(agg.taxable),
          cessAmount: rs(agg.cess),
          irn: d.einvoice?.irn || '',
        });
      }
    }
    return rows;
  }

  /**
   * B2CS: unregistered recipients, CONSOLIDATED by (place of supply, rate).
   * This is the bulk of a flower marketplace's filing.
   */
  async gstr1B2cs({ tenantId, from, to }) {
    const docs = await TaxDocument.find({
      ...periodQuery({ tenantId, from, to, docType: TAX_DOC_TYPE.INVOICE }),
      'recipient.gstin': null,
    }).lean();

    const byKey = new Map();
    for (const d of docs) {
      for (const l of d.lines) {
        const key = `${d.placeOfSupplyStateCode}|${l.rateBps}`;
        const cur = byKey.get(key) || {
          type: 'OE', // other than e-commerce operator supplies
          placeOfSupply: posLabel(d.placeOfSupplyStateCode),
          rate: l.rateBps / 100,
          taxableValuePaise: 0,
          cessPaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          invoiceCount: new Set(),
        };
        cur.taxableValuePaise += l.taxableValuePaise;
        cur.cessPaise += l.cessPaise;
        cur.cgstPaise += l.cgstPaise;
        cur.sgstPaise += l.sgstPaise;
        cur.igstPaise += l.igstPaise;
        cur.invoiceCount.add(String(d._id));
        byKey.set(key, cur);
      }
    }

    return [...byKey.values()]
      .sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate)
      .map((r) => ({
        type: r.type,
        placeOfSupply: r.placeOfSupply,
        rate: r.rate,
        taxableValue: rs(r.taxableValuePaise),
        cessAmount: rs(r.cessPaise),
        cgst: rs(r.cgstPaise),
        sgst: rs(r.sgstPaise),
        igst: rs(r.igstPaise),
        invoices: r.invoiceCount.size,
      }));
  }

  /**
   * HSN summary — mandatory, and the reason `natureOfSupply` is first-class:
   * nil-rated and exempt values must be reported, not omitted.
   */
  async gstr1Hsn({ tenantId, from, to }) {
    const docs = await TaxDocument.find({
      ...periodQuery({ tenantId, from, to, docType: TAX_DOC_TYPE.INVOICE }),
    }).lean();

    const byKey = new Map();
    for (const d of docs) {
      for (const s of (d.hsnSummary || [])) {
        const key = `${s.hsnCode || '-'}|${s.rateBps}`;
        const cur = byKey.get(key) || {
          hsn: s.hsnCode || '',
          description: '',
          uqc: 'OTH',
          rate: s.rateBps / 100,
          natureOfSupply: s.natureOfSupply || 'taxable',
          qty: 0,
          taxableValuePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          cessPaise: 0,
        };
        cur.qty += s.qty || 0;
        cur.taxableValuePaise += s.taxableValuePaise;
        cur.cgstPaise += s.cgstPaise;
        cur.sgstPaise += s.sgstPaise;
        cur.igstPaise += s.igstPaise;
        cur.cessPaise += s.cessPaise;
        byKey.set(key, cur);
      }
      // description: first line matching the HSN (best effort, for the human)
      for (const l of d.lines) {
        const key = `${l.hsnCode || '-'}|${l.rateBps}`;
        const cur = byKey.get(key);
        if (cur && !cur.description) cur.description = l.description;
        if (cur && l.uom) cur.uqc = l.uom;
      }
    }

    return [...byKey.values()]
      .sort((a, b) => String(a.hsn).localeCompare(String(b.hsn)) || a.rate - b.rate)
      .map((r) => ({
        hsn: r.hsn,
        description: r.description,
        uqc: r.uqc,
        rate: r.rate,
        natureOfSupply: r.natureOfSupply,
        totalQuantity: Number(r.qty.toFixed(3)),
        taxableValue: rs(r.taxableValuePaise),
        totalValue: rs(r.taxableValuePaise + r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise),
        integratedTax: rs(r.igstPaise),
        centralTax: rs(r.cgstPaise),
        stateTax: rs(r.sgstPaise),
        cess: rs(r.cessPaise),
      }));
  }

  /** CDNR/CDNUR — credit notes issued in the period, against their originals. */
  async gstr1Cdnr({ tenantId, from, to }) {
    const docs = await TaxDocument.find({
      ...periodQuery({ tenantId, from, to, docType: TAX_DOC_TYPE.CREDIT_NOTE }),
    }).sort({ issuedAt: 1 }).lean();

    const rows = [];
    for (const d of docs) {
      const byRate = new Map();
      for (const l of d.lines) {
        const cur = byRate.get(l.rateBps) || { taxable: 0, cess: 0 };
        cur.taxable += l.taxableValuePaise;
        cur.cess += l.cessPaise;
        byRate.set(l.rateBps, cur);
      }
      for (const [rateBps, agg] of byRate) {
        rows.push({
          recipientGstin: d.recipient.gstin || 'URP',
          recipientName: d.recipient.name,
          noteNumber: d.number,
          noteDate: ymd(d.issuedAt),
          noteType: 'C', // credit
          originalInvoiceNumber: d.originalNumber || '',
          placeOfSupply: posLabel(d.placeOfSupplyStateCode),
          reverseCharge: 'N',
          noteValue: rs(d.totals.grandTotalPaise),
          rate: rateBps / 100,
          taxableValue: rs(agg.taxable),
          cessAmount: rs(agg.cess),
          reason: d.reason || '',
        });
      }
    }
    return rows;
  }

  // -------------------------------------------------------------------------
  // GSTR-8 — TCS collected by the e-commerce operator (s.52)
  // -------------------------------------------------------------------------

  /**
   * Per-supplier statement of supplies made THROUGH the platform.
   *
   * net liable = gross supplies − supplies returned (credit notes)
   * TCS is applied to the NET TAXABLE value at the rate in force on the
   * period start, resolved from `statutoryrates` — never a constant.
   * Intra-state splits into CGST/SGST halves; inter-state is IGST.
   */
  async gstr8Tcs({ tenantId, from, to }) {
    const [invoices, notes, rate] = await Promise.all([
      TaxDocument.find({
        ...periodQuery({ tenantId, from, to, docType: TAX_DOC_TYPE.INVOICE }),
        supplierType: 'vendor',
      }).lean(),
      TaxDocument.find({
        ...periodQuery({ tenantId, from, to, docType: TAX_DOC_TYPE.CREDIT_NOTE }),
        supplierType: 'vendor',
      }).lean(),
      taxService.resolveStatutoryRate({ kind: STATUTORY_RATE_KIND.TCS_GST_52, at: new Date(from) }),
    ]);

    const rateBps = rate?.rateBps ?? 0;
    const byVendor = new Map();

    const bucket = (d) => {
      const key = String(d.vendorId || d.supplier.gstin || 'unknown');
      if (!byVendor.has(key)) {
        byVendor.set(key, {
          vendorId: d.vendorId,
          supplierGstin: d.supplier.gstin || '',
          supplierName: d.supplier.name,
          grossPaise: 0,
          returnedPaise: 0,
          intraStatePaise: 0,
          interStatePaise: 0,
        });
      }
      return byVendor.get(key);
    };

    for (const d of invoices) {
      const b = bucket(d);
      b.grossPaise += d.totals.taxableValuePaise;
      const intra = d.supplier.stateCode === d.placeOfSupplyStateCode;
      if (intra) b.intraStatePaise += d.totals.taxableValuePaise;
      else b.interStatePaise += d.totals.taxableValuePaise;
    }
    for (const d of notes) {
      const b = bucket(d);
      b.returnedPaise += d.totals.taxableValuePaise;
      const intra = d.supplier.stateCode === d.placeOfSupplyStateCode;
      if (intra) b.intraStatePaise -= d.totals.taxableValuePaise;
      else b.interStatePaise -= d.totals.taxableValuePaise;
    }

    const vendorIds = [...byVendor.values()].map((v) => v.vendorId).filter(Boolean);
    const vendors = vendorIds.length
      ? await Vendor.find({ _id: { $in: vendorIds } }).select('businessName gstin').lean()
      : [];
    const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

    return [...byVendor.values()].map((v) => {
      const netPaise = Math.max(0, v.grossPaise - v.returnedPaise);
      const intra = Math.max(0, v.intraStatePaise);
      const inter = Math.max(0, v.interStatePaise);
      const igstTcs = Math.round((inter * rateBps) / 10000);
      const totalIntraTcs = Math.round((intra * rateBps) / 10000);
      const cgstTcs = Math.trunc(totalIntraTcs / 2);
      const sgstTcs = totalIntraTcs - cgstTcs;

      return {
        supplierGstin: v.supplierGstin || vendorById.get(String(v.vendorId))?.gstin || '',
        supplierName: v.supplierName || vendorById.get(String(v.vendorId))?.businessName || '',
        grossValueOfSupplies: rs(v.grossPaise),
        valueOfSuppliesReturned: rs(v.returnedPaise),
        netAmountLiableToTcs: rs(netPaise),
        tcsRatePct: rateBps / 100,
        integratedTaxTcs: rs(igstTcs),
        centralTaxTcs: rs(cgstTcs),
        stateTaxTcs: rs(sgstTcs),
        totalTcs: rs(igstTcs + cgstTcs + sgstTcs),
        rateNotification: rate?.notificationRef || 'NO RATE ROW FOR THIS PERIOD — check statutoryrates',
      };
    }).sort((a, b) => String(a.supplierName).localeCompare(String(b.supplierName)));
  }

  // -------------------------------------------------------------------------
  // TDS u/s 194-O — deduction register (feeds 26Q)
  // -------------------------------------------------------------------------

  async tds194o({ tenantId, from, to }) {
    const [invoices, rate] = await Promise.all([
      TaxDocument.find({
        ...periodQuery({ tenantId, from, to, docType: TAX_DOC_TYPE.INVOICE }),
        supplierType: 'vendor',
      }).lean(),
      taxService.resolveStatutoryRate({ kind: STATUTORY_RATE_KIND.TDS_194O, at: new Date(from) }),
    ]);

    const rateBps = rate?.rateBps ?? 0;
    const byVendor = new Map();
    for (const d of invoices) {
      const key = String(d.vendorId || 'unknown');
      const cur = byVendor.get(key) || {
        vendorId: d.vendorId,
        name: d.supplier.name,
        gstin: d.supplier.gstin || '',
        grossPaise: 0,
        invoices: 0,
      };
      cur.grossPaise += d.totals.grandTotalPaise; // 194-O applies to gross sales
      cur.invoices += 1;
      byVendor.set(key, cur);
    }

    const vendorIds = [...byVendor.values()].map((v) => v.vendorId).filter(Boolean);
    const vendors = vendorIds.length
      ? await Vendor.find({ _id: { $in: vendorIds } }).select('businessName gstin').lean()
      : [];
    const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

    return [...byVendor.values()].map((v) => ({
      deducteeName: v.name || vendorById.get(String(v.vendorId))?.businessName || '',
      deducteeGstin: v.gstin,
      deducteePan: v.gstin ? v.gstin.slice(2, 12) : '',
      invoiceCount: v.invoices,
      grossAmountPaid: rs(v.grossPaise),
      tdsRatePct: rateBps / 100,
      tdsAmount: rs(Math.round((v.grossPaise * rateBps) / 10000)),
      section: '194-O',
      rateNotification: rate?.notificationRef || 'NO RATE ROW FOR THIS PERIOD — check statutoryrates',
    })).sort((a, b) => String(a.deducteeName).localeCompare(String(b.deducteeName)));
  }

  // -------------------------------------------------------------------------
  // Sales register — the accountant's full dump, one row per document
  // -------------------------------------------------------------------------

  async salesRegister({ tenantId, from, to }) {
    const docs = await TaxDocument.find({
      tenantId,
      status: TAX_DOC_STATUS.ISSUED,
      issuedAt: { $gte: new Date(from), $lt: new Date(to) },
    }).sort({ issuedAt: 1, number: 1 }).lean();

    return docs.map((d) => {
      const sign = d.docType === TAX_DOC_TYPE.CREDIT_NOTE ? -1 : 1;
      return {
        docType: d.docType,
        number: d.number,
        date: ymd(d.issuedAt),
        orderNumber: d.orderNumber || '',
        originalNumber: d.originalNumber || '',
        supplierName: d.supplier.name,
        supplierGstin: d.supplier.gstin || '',
        recipientName: d.recipient.name,
        recipientGstin: d.recipient.gstin || '',
        placeOfSupply: posLabel(d.placeOfSupplyStateCode),
        taxableValue: rs(sign * d.totals.taxableValuePaise),
        cgst: rs(sign * d.totals.cgstPaise),
        sgst: rs(sign * d.totals.sgstPaise),
        igst: rs(sign * d.totals.igstPaise),
        cess: rs(sign * d.totals.cessPaise),
        roundOff: rs(sign * d.totals.roundOffPaise),
        total: rs(sign * d.totals.grandTotalPaise),
        irn: d.einvoice?.irn || '',
        status: d.status,
      };
    });
  }
}

export default new GstrExportService();
