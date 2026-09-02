/**
 * Category — global product taxonomy (admin-owned), a tree via parent refs.
 *
 * DESIGN NOTES (per the multi-tenant catalog architecture):
 *  - Categories are GLOBAL reference data: "Central Admin / Catalog Ops" owns the
 *    taxonomy. Tenants read it read-only; they can never create categories.
 *  - Tree structure via `parentId` ref (NOT nested docs) — bounded, queryable.
 *  - `attributeSchema` is a BOUNDED array of field definitions that drives
 *    create/update validation: a category like "Food/Pharma" can require FSSAI
 *    license or expiry fields before a product in it is accepted. This is the
 *    compliance-gating hook from the architecture doc.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ENTITY_STATUS, ATTRIBUTE_FIELD_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const AttributeSchemaField = new Schema(
  {
    key: { type: String, required: true, trim: true, match: /^[a-z0-9_]+$/ },
    label: { type: String, trim: true, default: null },
    type: {
      type: String,
      enum: Object.values(ATTRIBUTE_FIELD_TYPE),
      default: ATTRIBUTE_FIELD_TYPE.STRING,
    },
    required: { type: Boolean, default: false },
    options: { type: [String], default: [] }, // for select
    unit: { type: String, default: null },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    regex: { type: String, default: null }, // client-side + server validation hint
  },
  { _id: false }
);

const CategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 140 },
    parentId: { type: Types.ObjectId, ref: 'Category', default: null, index: true },
    level: { type: Number, default: 0, min: 0 }, // denormalized depth (0 = root)

    description: { type: String, default: null, maxlength: 500 },
    imageUrl: { type: String, default: null },
    iconUrl: { type: String, default: null },

    attributeSchema: { type: [AttributeSchemaField], default: [] },

    sortOrder: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },

    status: {
      type: String,
      enum: Object.values(ENTITY_STATUS),
      default: ENTITY_STATUS.ACTIVE,
      index: true,
    },
  },
  { collection: 'categories' }
);

CategorySchema.index({ slug: 1 }, { unique: true });
CategorySchema.index({ status: 1, parentId: 1, sortOrder: 1 });

CategorySchema.plugin(auditPlugin);
CategorySchema.plugin(softDeletePlugin);
CategorySchema.plugin(toJSONPlugin);

export default mongoose.model('Category', CategorySchema);
