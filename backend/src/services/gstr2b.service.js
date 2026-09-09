/**
 * Gstr2bService — GSTR-2B input tax credit (ITC) matching.
 *
 * GSTR-2B is the auto-generated ITC statement from the GST portal.
 * This service:
 *   1. Imports GSTR-2B data (from JSON download or manual entry)
 *   2. Matches against purchase invoices in the ledger
 *   3. Reports mismatches (missing invoices, value differences)
 *   4. Tracks ITC eligibility status
 *
 * This is NOT a filing integration — it's a matching/reconciliation tool.
 * The accountant downloads GSTR-2B from the portal, imports it here,
 * and gets a reconciliation report.
 *
 * Storage: uses a dedicated collection (gstr2bentries) — NOT TaxDocument,
 * because GSTR-2B entries are READ-ONLY portal data that must be preserved
 * exactly as received.
 */

import mongoose from 'mongoose';
import { serializeList } from '../utils/serialize.js';
import { badRequest } from '../utils/ApiError.js';

const { Schema, Types } = mongoose;

// --- GSTR-2B Entry Model (inline — lightweight, single-use) ---
const Gstr2bEntrySchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    period: { type: String, required: true, maxlength: 7 }, // '2024-01'
    importBatchId: { type: String, required: true },

    supplierGstin: { type: String, required: true, trim: true },
    supplierName: { type: String, trim: true, default: '' },
    invoiceNumber: { type: String, required: true, trim: true },
    invoiceDate: { type: Date, required: true },
    invoiceValue: { type: Number, required: true }, // rupees
    taxableValue: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    cess: { type: Number, default: 0 },
    placeOfSupply: { type: String, default: '' },
    reverseCharge: { type: Boolean, default: false },
    invoiceType: { type: String, default: 'Regular' },

    // Matching status
    matchStatus: {
      type: String,
      enum: ['unmatched', 'matched', 'partial_match', 'value_mismatch', 'not_in_books'],
      default: 'unmatched',
    },
    matchedDocId: { type: Types.ObjectId, default: null },
    matchNotes: { type: String, default: '' },
  },
  { collection: 'gstr2bentries' }
);

Gstr2bEntrySchema.index({ tenantId: 1, period: 1 });
Gstr2bEntrySchema.index({ tenantId: 1, matchStatus: 1 });
Gstr2bEntrySchema.index({ tenantId: 1, supplierGstin: 1, invoiceNumber: 1 }, { unique: true });

const Gstr2bEntry = mongoose.models.Gstr2bEntry || mongoose.model('Gstr2bEntry', Gstr2bEntrySchema);

// --- Import batch tracking ---
const Gstr2bBatchSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    period: { type: String, required: true },
    batchId: { type: String, required: true, unique: true },
    source: { type: String, default: 'json_import' },
    entryCount: { type: Number, default: 0 },
    importedAt: { type: Date, default: Date.now },
    importedBy: { type: Types.ObjectId, default: null },
  },
  { collection: 'gstr2bbatches' }
);

const Gstr2bBatch = mongoose.models.Gstr2bBatch || mongoose.model('Gstr2bBatch', Gstr2bBatchSchema);

// --- Service ---
import TaxDocument from '../models/taxDocument.model.js';
import { TAX_DOC_TYPE, TAX_DOC_STATUS } from '../constants/enums.js';

class Gstr2bService {
  /**
   * Import GSTR-2B entries from JSON data.
   * Expected format: array of { supplierGstin, invoiceNumber, invoiceDate, ... }
   */
  async import({ tenantId, period, entries, actorId }) {
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      throw badRequest('Period must be YYYY-MM format', 'INVALID_PERIOD');
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      throw badRequest('Entries array is required and must not be empty', 'NO_ENTRIES');
    }

    const batchId = `gstr2b-${period}-${Date.now()}`;

    const docs = entries.map((e) => ({
      tenantId,
      period,
      batchId,
      supplierGstin: e.supplierGstin || '',
      supplierName: e.supplierName || '',
      invoiceNumber: e.invoiceNumber || '',
      invoiceDate: new Date(e.invoiceDate),
      invoiceValue: Number(e.invoiceValue) || 0,
      taxableValue: Number(e.taxableValue) || 0,
      igst: Number(e.igst) || 0,
      cgst: Number(e.cgst) || 0,
      sgst: Number(e.sgst) || 0,
      cess: Number(e.cess) || 0,
      placeOfSupply: e.placeOfSupply || '',
      reverseCharge: !!e.reverseCharge,
      invoiceType: e.invoiceType || 'Regular',
    }));

    // Upsert (idempotent on supplierGstin + invoiceNumber)
    let imported = 0;
    for (const doc of docs) {
      await Gstr2bEntry.updateOne(
        { tenantId, supplierGstin: doc.supplierGstin, invoiceNumber: doc.invoiceNumber },
        { $set: doc },
        { upsert: true },
      );
      imported += 1;
    }

    await Gstr2bBatch.create({
      tenantId,
      period,
      batchId,
      entryCount: imported,
      importedBy: actorId,
    });

    return { batchId, period, imported };
  }

  /**
   * Match GSTR-2B entries against purchase invoices in the ledger.
   * Looks for matching TaxDocuments (invoices received = purchase side).
   */
  async match({ tenantId, period }) {
    const entries = await Gstr2bEntry.find({ tenantId, period }).lean();
    if (!entries.length) {
      throw badRequest('No GSTR-2B entries found for this period', 'NO_ENTRIES');
    }

    const [year, month] = period.split('-').map(Number);
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);

    // Get all invoices received (purchase side) for this period
    const purchaseInvoices = await TaxDocument.find({
      tenantId,
      docType: TAX_DOC_TYPE.INVOICE,
      status: TAX_DOC_STATUS.ISSUED,
      issuedAt: { $gte: from, $lt: to },
    }).lean();

    // Build index: (supplierGstin|invoiceNumber) → doc
    const purchaseIndex = new Map();
    for (const doc of purchaseInvoices) {
      const key = `${(doc.supplier?.gstin || '').toUpperCase()}|${(doc.number || '').toUpperCase()}`;
      purchaseIndex.set(key, doc);
    }

    let matched = 0;
    let partialMatch = 0;
    let valueMismatch = 0;
    let notInBooks = 0;

    for (const entry of entries) {
      const key = `${entry.supplierGstin.toUpperCase()}|${entry.invoiceNumber.toUpperCase()}`;
      const bookDoc = purchaseIndex.get(key);

      if (!bookDoc) {
        await Gstr2bEntry.updateOne(
          { _id: entry._id },
          { $set: { matchStatus: 'not_in_books', matchNotes: 'No matching invoice found in books' } },
        );
        notInBooks += 1;
        continue;
      }

      const bookValue = (bookDoc.totals?.grandTotalPaise || 0) / 100;
      const diff = Math.abs(bookValue - entry.invoiceValue);
      const tolerance = Math.max(entry.invoiceValue * 0.01, 10); // 1% or ₹10

      if (diff <= tolerance) {
        await Gstr2bEntry.updateOne(
          { _id: entry._id },
          {
            $set: {
              matchStatus: 'matched',
              matchedDocId: bookDoc._id,
              matchNotes: `Matched with ${bookDoc.number}`,
            },
          },
        );
        matched += 1;
      } else {
        await Gstr2bEntry.updateOne(
          { _id: entry._id },
          {
            $set: {
              matchStatus: 'value_mismatch',
              matchedDocId: bookDoc._id,
              matchNotes: `GSTR-2B: ₹${entry.invoiceValue}, Books: ₹${bookValue.toFixed(2)}, Diff: ₹${diff.toFixed(2)}`,
            },
          },
        );
        valueMismatch += 1;
      }
    }

    return {
      period,
      totalEntries: entries.length,
      matched,
      valueMismatch,
      notInBooks,
      matchRate: entries.length > 0 ? Math.round((matched / entries.length) * 100) : 0,
    };
  }

  /**
   * Get reconciliation report for a period.
   */
  async report({ tenantId, period }) {
    const [entries, stats] = await Promise.all([
      Gstr2bEntry.find({ tenantId, period }).sort({ matchStatus: 1, supplierGstin: 1 }).lean(),
      Gstr2bEntry.aggregate([
        { $match: { tenantId: new Types.ObjectId(tenantId), period } },
        { $group: { _id: '$matchStatus', count: { $sum: 1 }, totalValue: { $sum: '$invoiceValue' } } },
      ]),
    ]);

    const statusMap = {};
    for (const s of stats) {
      statusMap[s._id] = { count: s.count, totalValue: s.totalValue };
    }

    return {
      period,
      entries: serializeList(entries),
      summary: {
        total: entries.length,
        matched: statusMap.matched || { count: 0, totalValue: 0 },
        valueMismatch: statusMap.value_mismatch || { count: 0, totalValue: 0 },
        notInBooks: statusMap.not_in_books || { count: 0, totalValue: 0 },
        unmatched: statusMap.unmatched || { count: 0, totalValue: 0 },
      },
    };
  }

  /**
   * List available periods with import counts.
   */
  async listPeriods({ tenantId }) {
    const batches = await Gstr2bBatch.find({ tenantId }).sort({ period: -1 }).lean();
    return serializeList(batches);
  }
}

export default new Gstr2bService();
