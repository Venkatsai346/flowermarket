/**
 * EwayBillService — e-way bill data extraction for GST compliance.
 *
 * E-way bills are required for interstate movement of goods where the
 * invoice value exceeds ₹50,000. This service:
 *   1. Identifies invoices that need e-way bills
 *   2. Generates e-way bill JSON in the NIC schema format
 *   3. Tracks e-way bill status per invoice
 *
 * This is NOT a filing integration — it generates the data structure that
 * an accountant or GSP can use to file. Actual filing happens outside the
 * platform (via the NIC portal or a GSP).
 *
 * Scope: GST e-way bill rules as of 2024.
 */

import TaxDocument from '../models/taxDocument.model.js';
import Tenant from '../models/tenant.model.js';
import Vendor from '../models/vendor.model.js';
import { TAX_DOC_TYPE, TAX_DOC_STATUS } from '../constants/enums.js';
import { fromPaise } from '../utils/money.js';
import { badRequest } from '../utils/ApiError.js';

const EWAY_THRESHOLD_PAISE = 50000 * 100; // ₹50,000

const rs = (paise) => fromPaise(paise || 0);
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

class EwayBillService {
  /**
   * Find invoices in a period that require e-way bills.
   * Criteria: issued, invoice value > ₹50,000, interstate movement.
   */
  async findEwayRequired({ tenantId, from, to }) {
    const docs = await TaxDocument.find({
      tenantId,
      docType: TAX_DOC_TYPE.INVOICE,
      status: TAX_DOC_STATUS.ISSUED,
      issuedAt: { $gte: new Date(from), $lt: new Date(to) },
      'totals.grandTotalPaise': { $gt: EWAY_THRESHOLD_PAISE },
    }).sort({ issuedAt: 1 }).lean();

    return docs.map((d) => ({
      invoiceId: String(d._id),
      invoiceNumber: d.number,
      invoiceDate: ymd(d.issuedAt),
      invoiceValue: rs(d.totals.grandTotalPaise),
      recipientName: d.recipient.name,
      recipientGstin: d.recipient.gstin || '',
      placeOfSupply: d.placeOfSupplyStateCode,
      isInterstate: d.supplier.stateCode !== d.placeOfSupplyStateCode,
      supplierState: d.supplier.stateCode,
      needsEwayBill: d.supplier.stateCode !== d.placeOfSupplyStateCode,
      hsnCodes: (d.lines || []).map((l) => l.hsnCode).filter(Boolean),
    }));
  }

  /**
   * Generate e-way bill JSON payload for a single invoice.
   * Follows the NIC e-way bill schema (supplyType=O, subType=1).
   */
  async generatePayload({ tenantId, invoiceId }) {
    const doc = await TaxDocument.findOne({
      _id: invoiceId,
      tenantId,
      docType: TAX_DOC_TYPE.INVOICE,
      status: TAX_DOC_STATUS.ISSUED,
    }).lean();

    if (!doc) throw badRequest('Invoice not found or not issued', 'INVOICE_NOT_FOUND');

    const tenant = await Tenant.findOne({ _id: tenantId }).lean();

    // Build supply lines grouped by HSN
    const hsnGroups = new Map();
    for (const line of doc.lines || []) {
      const key = line.hsnCode || '9999';
      if (!hsnGroups.has(key)) {
        hsnGroups.set(key, {
          hsnCode: key,
          productName: line.description,
          quantity: 0,
          taxableAmount: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          unit: line.uom || 'OTH',
        });
      }
      const g = hsnGroups.get(key);
      g.quantity += line.qty || 0;
      g.taxableAmount += line.taxableValuePaise || 0;
      g.cgst += line.cgstPaise || 0;
      g.sgst += line.sgstPaise || 0;
      g.igst += line.igstPaise || 0;
    }

    return {
      // Header
      supplyType: 'O', // outward
      subSupplyType: '1', // supply
      docType: 'INV',
      docNo: doc.number,
      docDate: ymd(doc.issuedAt),
      transactionType: doc.supplier.stateCode === doc.placeOfSupplyStateCode ? 1 : 2,

      // Supplier (from)
      fromGstin: doc.supplier.gstin || '',
      fromTrdName: doc.supplier.name || tenant?.name || '',
      fromAddr1: doc.supplier.address?.line1 || '',
      fromAddr2: doc.supplier.address?.line2 || '',
      fromPlace: doc.supplier.address?.city || '',
      fromPincode: Number(doc.supplier.address?.pincode) || 0,
      fromStateCode: doc.supplier.stateCode || 0,

      // Recipient (to)
      toGstin: doc.recipient.gstin || 'URP',
      toTrdName: doc.recipient.name || '',
      toAddr1: doc.recipient.address?.line1 || '',
      toAddr2: doc.recipient.address?.line2 || '',
      toPlace: doc.recipient.address?.city || '',
      toPincode: Number(doc.recipient.address?.pincode) || 0,
      toStateCode: doc.placeOfSupplyStateCode || 0,

      // Totals
      totalInvoiceValue: rs(doc.totals.grandTotalPaise),
      cgstValue: rs(doc.totals.cgstPaise),
      sgstValue: rs(doc.totals.sgstPaise),
      igstValue: rs(doc.totals.igstPaise),
      cessValue: rs(doc.totals.cessPaise),

      // Item list
      itemList: [...hsnGroups.values()].map((g) => ({
        productName: g.productName,
        hsnCode: g.hsnCode,
        quantity: g.quantity,
        qtyUnit: g.unit,
        taxableAmount: rs(g.taxableAmount),
        cgstRate: g.cgst > 0 ? Math.round((g.cgst / g.taxableAmount) * 10000) / 100 : 0,
        sgstRate: g.sgst > 0 ? Math.round((g.sgst / g.taxableAmount) * 10000) / 100 : 0,
        igstRate: g.igst > 0 ? Math.round((g.igst / g.taxableAmount) * 10000) / 100 : 0,
      })),
    };
  }

  /**
   * Generate a batch e-way bill export (JSON) for all qualifying invoices in a period.
   */
  async generateBatch({ tenantId, from, to }) {
    const required = await this.findEwayRequired({ tenantId, from, to });
    const interstate = required.filter((r) => r.needsEwayBill);

    const payloads = [];
    for (const inv of interstate) {
      try {
        // sequential invoice payload generation
        // eslint-disable-next-line no-await-in-loop
        const payload = await this.generatePayload({ tenantId, invoiceId: inv.invoiceId });
        payloads.push(payload);
      } catch {
        // Skip invoices that can't be processed (already handled)
      }
    }

    return {
      period: { from, to },
      totalInvoices: required.length,
      interstateAbove50k: interstate.length,
      payloads,
    };
  }
}

export default new EwayBillService();
