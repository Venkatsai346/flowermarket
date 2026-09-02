/**
 * MediaService — presign → confirm → registry lifecycle for image/video uploads.
 *
 * Everything flows through `storageProvider` (s3 | local) so the API contract is
 * provider-agnostic. Validation happens at sign time (type + size allowlists by
 * purpose) and verification at confirm time (size + magic bytes / HeadObject).
 */
import path from 'node:path';
import crypto from 'node:crypto';
import MediaAsset from '../models/mediaAsset.model.js';
import config from '../config/index.js';
import { createStorageProvider } from './storageProvider.service.js';
import { serializeList } from '../utils/serialize.js';
import {
  badRequest,
  notFound,
  forbidden,
} from '../utils/ApiError.js';
import { MEDIA_TYPE, MEDIA_STATUS, MEDIA_PURPOSE } from '../constants/enums.js';

const provider = createStorageProvider(config.storage);
const PURPOSE_TYPE = {
  [MEDIA_PURPOSE.PRODUCT_IMAGE]: MEDIA_TYPE.IMAGE,
  [MEDIA_PURPOSE.CATEGORY_IMAGE]: MEDIA_TYPE.IMAGE,
  [MEDIA_PURPOSE.BRAND_LOGO]: MEDIA_TYPE.IMAGE,
  [MEDIA_PURPOSE.STORE_LOGO]: MEDIA_TYPE.IMAGE,
  [MEDIA_PURPOSE.STORE_BANNER]: MEDIA_TYPE.IMAGE,
  [MEDIA_PURPOSE.PRODUCT_VIDEO]: MEDIA_TYPE.VIDEO,
  [MEDIA_PURPOSE.OTHER]: MEDIA_TYPE.IMAGE,
};

function purposeAllowed(purpose) {
  return Boolean(PURPOSE_TYPE[purpose]);
}

function extFor(filename, contentType) {
  const fromName = (filename || '').split('.').pop()?.toLowerCase() || '';
  if (fromName) return fromName;
  const mime = String(contentType || '').split('/')[1] || '';
  return mime.split('+')[0]?.toLowerCase() || 'bin';
}

function validateUpload({ filename, contentType, size, purpose }) {
  const type = PURPOSE_TYPE[purpose];
  if (!type) throw badRequest(`Unsupported purpose: ${purpose}`, 'BAD_MEDIA_PURPOSE');

  const ext = extFor(filename, contentType);
  const allowed = type === MEDIA_TYPE.IMAGE ? config.storage.limits.imageTypes : config.storage.limits.videoTypes;
  if (!allowed.includes(ext)) {
    throw badRequest(
      `${type} type "${ext}" not allowed. Allowed: ${allowed.join(', ')}`,
      'MEDIA_TYPE_NOT_ALLOWED'
    );
  }

  const max = type === MEDIA_TYPE.IMAGE ? config.storage.limits.maxImageBytes : config.storage.limits.maxVideoBytes;
  if (!Number.isFinite(size) || size <= 0) throw badRequest('Invalid file size', 'BAD_MEDIA_SIZE');
  if (size > max) {
    throw badRequest(
      `${type} exceeds the ${max / (1024 * 1024)} MB limit`,
      'MEDIA_TOO_LARGE'
    );
  }

  return { type, ext };
}

function buildKey({ tenantId, purpose, ext }) {
  const yymm = new Date().toISOString().slice(0, 7).replace('-', '');
  const uuid = crypto.randomUUID();
  return `${String(tenantId)}/${purpose}/${yymm}/${uuid}.${ext}`;
}

class MediaService {
  /**
   * Per-tenant storage quota (Phase 6.0). Counts PENDING + READY bytes so a
   * flood of presigns that are never confirmed still consumes quota until they
   * are swept. 0 = unlimited.
   */
  async assertQuota({ tenantId, incomingBytes }) {
    const quota = config.storage.limits.tenantQuotaBytes;
    if (!quota) return { used: 0, quota: 0 };
    const [agg] = await MediaAsset.aggregate([
      { $match: { tenantId, status: { $in: [MEDIA_STATUS.PENDING, MEDIA_STATUS.READY] } } },
      { $group: { _id: null, bytes: { $sum: '$sizeBytes' } } },
    ]);
    const used = agg?.bytes || 0;
    if (used + incomingBytes > quota) {
      throw badRequest(
        `Storage quota exceeded (${(quota / (1024 * 1024 * 1024)).toFixed(1)} GB). Delete unused media or contact support.`,
        'MEDIA_QUOTA_EXCEEDED',
        { usedBytes: used, quotaBytes: quota, incomingBytes }
      );
    }
    return { used, quota };
  }

  /** Sign an upload + register the pending asset. */
  async presign({ userId, tenantId, filename, contentType, size, purpose }) {
    if (!purposeAllowed(purpose)) throw badRequest(`Unsupported purpose: ${purpose}`, 'BAD_MEDIA_PURPOSE');
    const { type, ext } = validateUpload({ filename, contentType, size, purpose });
    await this.assertQuota({ tenantId, incomingBytes: size });
    const key = buildKey({ tenantId, purpose, ext });
    const expiresIn = config.storage.presignExpirySeconds;

    const signed = await provider.signUpload({
      key,
      contentType,
      size,
      expiresIn,
    });

    const asset = await MediaAsset.create({
      tenantId,
      uploadedBy: userId,
      purpose,
      type,
      mimeType: contentType,
      extension: ext,
      sizeBytes: size,
      key,
      bucket: config.storage.provider === 's3' ? config.storage.s3.bucket : null,
      url: provider.getPublicUrl(key),
      status: MEDIA_STATUS.PENDING,
    });

    return {
      asset,
      uploadUrl: signed.uploadUrl,
      method: signed.method,
      headers: signed.headers,
      expiresIn,
    };
  }

  /** Confirm after the client uploaded bytes → verify in the store → ready. */
  async confirm({ assetId, tenantId }) {
    const asset = await MediaAsset.findOne({ _id: assetId, tenantId });
    if (!asset) throw notFound('Media asset not found', 'MEDIA_NOT_FOUND');
    if (asset.status === MEDIA_STATUS.READY) return asset;
    if (asset.status === MEDIA_STATUS.DELETED) throw notFound('Media asset not found', 'MEDIA_NOT_FOUND');

    const result = await provider.verify({
      key: asset.key,
      expectedSize: asset.sizeBytes,
      contentType: asset.mimeType,
    });

    if (!result.ok) {
      asset.status = MEDIA_STATUS.FAILED;
      asset.meta = { ...(asset.meta || {}), verifyError: result.reason };
      await asset.save();
      throw badRequest(`Upload verification failed: ${result.reason}`, 'MEDIA_VERIFY_FAILED');
    }

    asset.status = MEDIA_STATUS.READY;
    await asset.save();
    return asset;
  }

  /** Tenant-scoped list for the gallery picker. */
  async list({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 24));
    const q = { tenantId, status: { $ne: MEDIA_STATUS.DELETED } };
    if (query.purpose) q.purpose = query.purpose;
    if (query.type) q.type = query.type;
    if (query.status) q.status = query.status;
    const [docs, total] = await Promise.all([
      MediaAsset.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      MediaAsset.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async get({ assetId, tenantId }) {
    const asset = await MediaAsset.findOne({ _id: assetId, tenantId, status: { $ne: MEDIA_STATUS.DELETED } });
    if (!asset) throw notFound('Media asset not found', 'MEDIA_NOT_FOUND');
    return asset;
  }

  /** Soft delete + best-effort object removal from the store. */
  async remove({ assetId, tenantId, actorId }) {
    const asset = await MediaAsset.findOne({ _id: assetId, tenantId });
    if (!asset) throw notFound('Media asset not found', 'MEDIA_NOT_FOUND');
    asset.status = MEDIA_STATUS.DELETED;
    asset.deletedAt = new Date();
    asset.meta = { ...(asset.meta || {}), deletedBy: String(actorId) };
    await asset.save();
    provider.remove(asset.key).catch(() => {});
    return { deleted: true, id: asset.id };
  }

  /** Local provider: stream the raw PUT body to disk under the signed key. */
  async uploadLocal({ key, tenantId, contentType, size }) {
    if (config.storage.provider !== 'local') {
      throw forbidden('Local uploads are disabled (STORAGE_PROVIDER !== local)', 'LOCAL_UPLOAD_DISABLED');
    }
    // key must belong to this tenant's namespace
    const prefix = `${String(tenantId)}/`;
    if (!key || !key.startsWith(prefix)) {
      throw forbidden('Upload key does not belong to this tenant', 'KEY_TENANT_MISMATCH');
    }
    // re-run the same validation (size cap by content type)
    const mime = contentType || 'application/octet-stream';
    const isVideo = mime.startsWith('video/');
    const max = isVideo ? config.storage.limits.maxVideoBytes : config.storage.limits.maxImageBytes;
    if (size > max) throw badRequest(`Exceeds the ${max / (1024 * 1024)} MB limit`, 'MEDIA_TOO_LARGE');
    return { isVideo };
  }

  /** Local provider: write the client's raw body (Buffer) to disk under the signed key. */
  async writeLocal({ key, buffer }) {
    if (config.storage.provider !== 'local') {
      throw forbidden('Local uploads are disabled (STORAGE_PROVIDER !== local)', 'LOCAL_UPLOAD_DISABLED');
    }
    return provider.writeBuffer(key, buffer);
  }
}

export default new MediaService();
