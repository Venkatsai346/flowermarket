/**
 * HsnSummaryService — HSN-wise summary table for GST returns.
 *
 * Generates a consolidated HSN summary that accountants need for:
 *   - GSTR-1 HSN table (Table 12)
 *   - Annual return (GSTR-9)
 *   - Internal compliance checks
 *
 * This is a STANDALONE service that reads from TaxDocument (already issued).
 * The GstrExportService has a gstr1Hsn() method, but this service provides:
 *   - Grouping by HSN + UOM (as the portal expects)
 *   - Intra/inter state split
 *   - Nature of supply breakdown
 *   - Monthly trend data
 *   - Exportable CSV format
 */

import TaxDocument from '../models/taxDocument.model.js';
import { TAX_DOC_TYPE, TAX_DOC_STATUS, TAX_NATURE_OF_SUPPLY } from '../constants/enums.js';
import { fromPaise } from '../utils/money.js';
import { serializeList } from '../utils/serialize.js';

const rs = (paise) => fromPaise(paise || 0);

class HsnSummaryService {
  /**
   * Generate HSN summary for a period.
   *
   * @param {Object} opts
   * @param {string} opts.tenantId
   * @param {string} opts.from - ISO date
   * @param {string} opts.to - ISO date
   * @param {string} [opts.docType] - 'invoice' | 'credit_note' | null (all)
   * @param {string} [opts.groupBy] - 'hsn_uqc' (default) | 'hsn_rate'
   */
  async summary({ tenantId, from, to, docType = null, groupBy = 'hsn_uqc' }) {
    const match = {
      tenantId,
      status: TAX_DOC_STATUS.ISSUED,
      issuedAt: { $gte: new Date(from), $lt: new Date(to) },
    };
    if (docType) match.docType = docType;

    const docs = await TaxDocument.find(match).lean();

    const byKey = new Map();

    for (const d of docs) {
      const sign = d.docType === TAX_DOC_TYPE.CREDIT_NOTE ? -1 : 1;

      for (const line of d.lines || []) {
        const hsn = line.hsnCode || '';
        const uqc = line.uom || 'OTH';
        const rate = line.rateBps || 0;

        const key = groupBy === 'hsn_rate'
          ? `${hsn}|${rate}`
          : `${hsn}|${uqc}|${rate}`;

        if (!byKey.has(key)) {
          byKey.set(key, {
            hsnCode: hsn,
            description: line.description || '',
            uqc,
            rateBps: rate,
            natureOfSupply: line.natureOfSupply || TAX_NATURE_OF_SUPPLY.TAXABLE,
            qty: 0,
            taxablePaise: 0,
            cgstPaise: 0,
            sgstPaise: 0,
            igstPaise: 0,
            cessPaise: 0,
            invoiceCount: new Set(),
            intraStatePaise: 0,
            interStatePaise: 0,
          });
        }

        const g = byKey.get(key);
        g.qty += sign * (line.qty || 0);
        g.taxablePaise += sign * (line.taxableValuePaise || 0);
        g.cgstPaise += sign * (line.cgstPaise || 0);
        g.sgstPaise += sign * (line.sgstPaise || 0);
        g.igstPaise += sign * (line.igstPaise || 0);
        g.cessPaise += sign * (line.cessPaise || 0);
        g.invoiceCount.add(String(d._id));

        // Intra/inter split
        const isIntra = d.supplier?.stateCode === d.placeOfSupplyStateCode;
        if (isIntra) g.intraStatePaise += sign * (line.taxableValuePaise || 0);
        else g.interStatePaise += sign * (line.taxableValuePaise || 0);

        if (!g.description && line.description) g.description = line.description;
      }
    }

    return [...byKey.values()]
      .map((g) => ({
        hsnCode: g.hsnCode,
        description: g.description,
        uqc: g.uqc,
        rate: g.rateBps / 100,
        natureOfSupply: g.natureOfSupply,
        totalQuantity: Number(g.qty.toFixed(3)),
        taxableValue: rs(g.taxablePaise),
        cgst: rs(g.cgstPaise),
        sgst: rs(g.sgstPaise),
        igst: rs(g.igstPaise),
        cess: rs(g.cessPaise),
        totalValue: rs(g.taxablePaise + g.cgstPaise + g.sgstPaise + g.igstPaise + g.cessPaise),
        invoiceCount: g.invoiceCount.size,
        intraStateValue: rs(g.intraStatePaise),
        interStateValue: rs(g.interStatePaise),
      }))
      .sort((a, b) => String(a.hsnCode).localeCompare(String(b.hsnCode)) || a.rate - b.rate);
  }

  /**
   * Monthly HSN trend — how a specific HSN code performed month over month.
   */
  async monthlyTrend({ tenantId, hsnCode, months = 6 }) {
    const results = [];
    const now = new Date();

    for (let i = 0; i < months; i++) {
      const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      // sequential monthly trend queries
      // eslint-disable-next-line no-await-in-loop
      const monthData = await this.summary({
        tenantId,
        from: fromStr,
        to: toStr,
      });

      const hsnRows = monthData.filter((r) => r.hsnCode === hsnCode);
      const totalQty = hsnRows.reduce((s, r) => s + r.totalQuantity, 0);
      const totalTaxable = hsnRows.reduce((s, r) => {
        const v = typeof r.taxableValue === 'string' ? parseFloat(r.taxableValue.replace(/,/g, '')) : r.taxableValue;
        return s + (v || 0);
      }, 0);

      results.unshift({
        month: fromStr.slice(0, 7),
        quantity: totalQty,
        taxableValue: totalTaxable,
      });
    }

    return results;
  }
}

export default new HsnSummaryService();
