/**
 * TaxDocumentSeries — the numbering authority (Phase 6.2).
 *
 * GST requires document numbers to be unique and CONSECUTIVE within a
 * financial year, at most 16 characters, restricted to alphanumerics plus
 * '/' and '-'. That is a legal constraint, not a formatting preference, so the
 * sequence lives in its own document with a unique key and is advanced
 * atomically (the same `Counter` pattern Phase 5 used for invoice numbers).
 *
 * Gaplessness is why a document is CANCELLED and never deleted: a missing
 * number in a series is a question an auditor will ask.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { TAX_DOC_TYPE, TAX_OWNER_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TaxDocumentSeriesSchema = new Schema(
  {
    ownerType: { type: String, enum: Object.values(TAX_OWNER_TYPE), required: true },
    ownerId: { type: Types.ObjectId, default: null },
    docType: { type: String, enum: Object.values(TAX_DOC_TYPE), required: true },

    fyLabel: { type: String, required: true, maxlength: 8 }, // '24-25'
    seriesCode: { type: String, default: 'A', maxlength: 8 },
    prefix: { type: String, required: true, maxlength: 8 },
    width: { type: Number, default: 6, min: 3, max: 10 },

    /** Last number ISSUED. The next document takes `lastValue + 1`. */
    lastValue: { type: Number, default: 0, min: 0 },
    lastIssuedAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
  },
  { collection: 'taxdocumentseries' }
);

TaxDocumentSeriesSchema.index(
  { ownerType: 1, ownerId: 1, docType: 1, fyLabel: 1, seriesCode: 1 },
  { unique: true }
);

TaxDocumentSeriesSchema.plugin(auditPlugin);
TaxDocumentSeriesSchema.plugin(softDeletePlugin);
TaxDocumentSeriesSchema.plugin(toJSONPlugin);

export default mongoose.model('TaxDocumentSeries', TaxDocumentSeriesSchema);
