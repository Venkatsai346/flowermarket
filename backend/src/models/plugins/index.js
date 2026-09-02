/**
 * Shared Mongoose schema plugins.
 * Applied to every model so that cross-cutting concerns stay identical everywhere:
 *  - soft delete (isDeleted + deletedAt) instead of destructive removes
 *  - automatic createdAt / updatedAt / updatedBy audit fields
 *  - deterministic toJSON shape (no __v, no internal _id, sane id mapping)
 */

import mongoose from 'mongoose';

/** Adds `isDeleted` + `deletedAt` and hijacks the model's delete methods to soft-delete. */
export function softDeletePlugin(schema) {
  schema.add({
    isDeleted: { type: Boolean, default: false, select: false, index: true },
    deletedAt: { type: Date, default: null, select: false },
  });

  schema.pre(/^find/, function () {
    // applies to find / findOne / findOneAndUpdate / findOneAndDelete / findByIdAndUpdate / etc.
    this.where({ isDeleted: { $ne: true } });
  });

  schema.pre('aggregate', function () {
    this.pipeline().unshift({ $match: { isDeleted: { $ne: true } } });
  });

  const softDelete = function (opts = {}) {
    const { by, hard = false } = opts;
    if (hard) return this.deleteOne();

    const patch = { isDeleted: true, deletedAt: new Date() };
    if (by) patch.deletedBy = by;
    return this.updateOne(patch, { runValidators: false });
  };

  schema.methods.softDelete = function (opts = {}) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    if (opts.by) this.deletedBy = opts.by;
    return this.save();
  };

  // instance methods operate on the document itself
  schema.statics.softDeleteById = function (id, opts = {}) {
    return this.updateOne({ _id: id }, { $set: { isDeleted: true, deletedAt: new Date(), ...(opts.by ? { deletedBy: opts.by } : {}) } });
  };
}

/** Timestamps + `updatedBy` (actor id) for audit-friendly collections. */
export function auditPlugin(schema) {
  schema.add({
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
    // who last changed the record (user/admin/system id). Optional, kept lean.
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, select: false },
  });
}

/** Consistent JSON serialization: id string, no __v, no internal _id, no isDeleted leak. */
export function toJSONPlugin(schema) {
  const SECRET_FIELDS = ['password', 'passwordHash', 'codeHash', 'tokenHash', 'otpCode'];
  const apply = (doc, ret) => {
    if (ret._id && !ret.id) ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    for (const key of SECRET_FIELDS) delete ret[key]; // never leak secrets
  };

  schema.set('toJSON', { virtuals: true, versionKey: false, transform: apply });
  schema.set('toObject', { virtuals: true, versionKey: false, transform: apply });
}
