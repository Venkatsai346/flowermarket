import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const DimensionSchema = new Schema({
  code: { type: String, required: true, maxlength: 40 },
  label: { type: String, required: true, maxlength: 80 },
  score: { type: Number, required: true, min: 0 },
  maxScore: { type: Number, required: true, min: 1 },
  percent: { type: Number, required: true, min: 0, max: 100 },
}, { _id: false });

const IssueSchema = new Schema({
  code: { type: String, required: true, maxlength: 80 },
  severity: { type: String, enum: ['blocker', 'warning', 'info'], required: true },
  owner: { type: String, enum: ['master', 'taxonomy', 'variant', 'media', 'listing', 'inventory', 'search'], required: true },
  field: { type: String, default: null, maxlength: 120 },
  label: { type: String, required: true, maxlength: 160 },
  message: { type: String, required: true, maxlength: 500 },
  action: { type: String, required: true, maxlength: 240 },
  fingerprint: { type: String, required: true, maxlength: 64 },
  firstDetectedAt: { type: Date, required: true },
  lastDetectedAt: { type: Date, required: true },
}, { _id: false });

const CatalogQualityAssessmentSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true },
  productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', required: true },
  snapshot: {
    title: { type: String, required: true, maxlength: 160 },
    slug: { type: String, default: null, maxlength: 200 },
    skuGlobal: { type: String, default: null, maxlength: 80 },
    categoryId: { type: Types.ObjectId, ref: 'Category', default: null },
    categoryName: { type: String, default: null, maxlength: 120 },
    brandId: { type: Types.ObjectId, ref: 'Brand', default: null },
    status: { type: String, default: null, maxlength: 40 },
    listingCount: { type: Number, default: 0, min: 0 },
    activeListingCount: { type: Number, default: 0, min: 0 },
    variantCount: { type: Number, default: 0, min: 0 },
    imageCount: { type: Number, default: 0, min: 0 },
  },
  score: { type: Number, required: true, min: 0, max: 100, index: true },
  grade: { type: String, enum: ['A', 'B', 'C', 'D', 'F'], required: true, index: true },
  publishable: { type: Boolean, required: true, index: true },
  launchReady: { type: Boolean, required: true, index: true },
  dimensions: { type: [DimensionSchema], default: [], validate: (value) => value.length <= 12 },
  issues: { type: [IssueSchema], default: [], validate: (value) => value.length <= 100 },
  blockerCount: { type: Number, default: 0, min: 0, index: true },
  warningCount: { type: Number, default: 0, min: 0 },
  sourceFingerprint: { type: String, required: true, maxlength: 64 },
  evaluatorVersion: { type: String, required: true, maxlength: 40 },
  qualityRunId: { type: Types.ObjectId, ref: 'CatalogQualityRun', default: null, index: true },
  evaluatedAt: { type: Date, required: true, default: Date.now, index: true },
}, { collection: 'catalogqualityassessments', timestamps: true });

CatalogQualityAssessmentSchema.index(
  { tenantId: 1, productMasterId: 1 },
  { unique: true, name: 'tenant_master_quality_unique' },
);
CatalogQualityAssessmentSchema.index(
  { tenantId: 1, launchReady: 1, score: 1 },
  { name: 'tenant_quality_readiness_score_idx' },
);
CatalogQualityAssessmentSchema.index(
  { tenantId: 1, 'issues.code': 1 },
  { name: 'tenant_quality_issue_idx' },
);
CatalogQualityAssessmentSchema.index(
  { tenantId: 1, blockerCount: -1, score: 1, productMasterId: 1 },
  { name: 'tenant_quality_priority_idx' },
);
CatalogQualityAssessmentSchema.index(
  { tenantId: 1, qualityRunId: 1, productMasterId: 1 },
  { name: 'tenant_quality_run_projection_idx' },
);
CatalogQualityAssessmentSchema.plugin(toJSONPlugin);

export default mongoose.model('CatalogQualityAssessment', CatalogQualityAssessmentSchema);
