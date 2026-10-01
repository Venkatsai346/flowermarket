import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import config from '../config/index.js';
import MediaAsset from '../models/mediaAsset.model.js';
import ProductImage from '../models/productImage.model.js';
import MediaProcessingJob from '../models/mediaProcessingJob.model.js';
import { MEDIA_STATUS, MEDIA_TYPE } from '../constants/enums.js';
import { createStorageProvider, sniffMagic } from './storageProvider.service.js';

const provider = createStorageProvider(config.storage);
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PIXELS = 40_000_000;
const RENDITION_WIDTHS = [320, 640, 960, 1440];
const DETECTED_MIME = Object.freeze({
  jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
});

function compatible(claimed, detected) {
  const normalized = String(claimed || '').toLowerCase();
  if (detected === 'jpeg') return ['image/jpeg', 'image/jpg'].includes(normalized);
  if (detected === 'mov') return ['video/quicktime', 'video/mov'].includes(normalized);
  return normalized === DETECTED_MIME[detected];
}

function safeError(error) {
  return String(error?.message || error || 'Unknown media processing error').slice(0, 500);
}

class MediaProcessingService {
  async enqueue({ assetId, tenantId }) {
    return MediaProcessingJob.findOneAndUpdate(
      { assetId },
      {
        $set: { tenantId, status: 'queued', attempts: 0, claimedBy: null, leaseExpiresAt: null, errorCode: null, errorMessage: null, finishedAt: null, expiresAt: null },
        $setOnInsert: { assetId },
      },
      { upsert: true, new: true },
    );
  }

  async claim(workerId) {
    const now = new Date();
    const exhausted = await MediaProcessingJob.find({ status: 'running', attempts: { $gte: MAX_ATTEMPTS }, leaseExpiresAt: { $lte: now } }).select('assetId');
    if (exhausted.length) {
      const assetIds = exhausted.map((row) => row.assetId);
      await Promise.all([
        MediaProcessingJob.updateMany(
          { assetId: { $in: assetIds }, status: 'running' },
          { $set: { status: 'failed', finishedAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS), claimedBy: null, leaseExpiresAt: null, errorCode: 'MEDIA_PROCESSING_ATTEMPTS_EXHAUSTED', errorMessage: 'Processing lease expired too many times' } },
        ),
        MediaAsset.updateMany({ _id: { $in: assetIds }, status: MEDIA_STATUS.PROCESSING }, { $set: { status: MEDIA_STATUS.FAILED, 'meta.processingError': 'Processing lease expired too many times' } }),
      ]);
    }
    return MediaProcessingJob.findOneAndUpdate(
      { attempts: { $lt: MAX_ATTEMPTS }, $or: [{ status: 'queued' }, { status: 'running', leaseExpiresAt: { $lte: now } }] },
      { $set: { status: 'running', claimedBy: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), lastHeartbeatAt: now }, $inc: { attempts: 1 } },
      { sort: { lastHeartbeatAt: 1, createdAt: 1 }, new: true },
    );
  }

  async processAvailable({ workerId = `media-${process.pid}`, maxJobs = 1 } = {}) {
    const results = [];
    for (let index = 0; index < maxJobs; index += 1) {
      // Atomic claims are serial to preserve the exact maxJobs bound.
      // eslint-disable-next-line no-await-in-loop
      const job = await this.claim(workerId);
      if (!job) break;
      // Each object is bounded by upload limits and one lease owner.
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.processClaimed(job, workerId));
    }
    return results;
  }

  async processClaimed(job, workerId) {
    try {
      const asset = await MediaAsset.findOne({ _id: job.assetId, tenantId: job.tenantId, status: MEDIA_STATUS.PROCESSING });
      if (!asset) throw new Error('Processing asset is missing or no longer processing');
      const maxBytes = asset.type === MEDIA_TYPE.IMAGE ? config.storage.limits.maxImageBytes : config.storage.limits.maxVideoBytes;
      const buffer = await provider.readBuffer(asset.key, maxBytes);
      const detected = sniffMagic(buffer.subarray(0, 32));
      if (!detected || !compatible(asset.mimeType, detected)) throw new Error(`File signature ${detected || 'unknown'} does not match ${asset.mimeType}`);
      const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const duplicate = await MediaAsset.findOne({
        _id: { $ne: asset._id }, tenantId: asset.tenantId, checksumSha256,
        status: MEDIA_STATUS.READY,
      }).select('_id');
      const evidence = { checksumSha256, detectedMimeType: DETECTED_MIME[detected], duplicateOf: duplicate?._id || null, verifiedAt: new Date(), health: { status: 'healthy', checkedAt: new Date(), consecutiveFailures: 0, error: null } };
      if (asset.type === MEDIA_TYPE.IMAGE) Object.assign(evidence, await this.processImage(asset, buffer));
      await provider.makePublic(asset.key, evidence.detectedMimeType);
      await MediaAsset.updateOne(
        { _id: asset._id, status: MEDIA_STATUS.PROCESSING },
        { $set: { ...evidence, status: MEDIA_STATUS.READY, 'meta.processingError': null } },
      );
      const finishedAt = new Date();
      await MediaProcessingJob.updateOne(
        { _id: job._id, claimedBy: workerId },
        { $set: { status: 'completed', finishedAt, expiresAt: new Date(finishedAt.getTime() + RETENTION_MS), claimedBy: null, leaseExpiresAt: null } },
      );
      return { assetId: String(asset._id), status: 'completed' };
    } catch (error) {
      const finalAttempt = job.attempts >= MAX_ATTEMPTS;
      const finishedAt = new Date();
      await Promise.all([
        MediaProcessingJob.updateOne(
          { _id: job._id, claimedBy: workerId },
          { $set: {
            status: finalAttempt ? 'failed' : 'queued', claimedBy: null, leaseExpiresAt: null,
            errorCode: 'MEDIA_PROCESSING_FAILED', errorMessage: safeError(error),
            ...(finalAttempt ? { finishedAt, expiresAt: new Date(finishedAt.getTime() + RETENTION_MS) } : {}),
          } },
        ),
        MediaAsset.updateOne(
          { _id: job.assetId, status: MEDIA_STATUS.PROCESSING },
          { $set: { ...(finalAttempt ? { status: MEDIA_STATUS.FAILED } : {}), 'meta.processingError': safeError(error) } },
        ),
      ]);
      return { assetId: String(job.assetId), status: finalAttempt ? 'failed' : 'queued' };
    }
  }

  async probeOne() {
    const dueBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const asset = await MediaAsset.findOne({
      status: MEDIA_STATUS.READY,
      $or: [{ 'health.checkedAt': null }, { 'health.checkedAt': { $lte: dueBefore } }],
    }).sort({ 'health.checkedAt': 1, createdAt: 1 });
    if (!asset) return null;
    const result = await provider.verify({ key: asset.key, expectedSize: asset.sizeBytes, contentType: asset.detectedMimeType || asset.mimeType });
    const healthy = result.ok;
    const failures = healthy ? 0 : Number(asset.health?.consecutiveFailures || 0) + 1;
    // Require two consecutive failures before declaring storefront media broken;
    // transient object-store errors remain observable without causing flicker.
    const status = healthy ? 'healthy' : failures >= 2 ? 'broken' : (asset.health?.status || 'unknown');
    asset.health = { status, checkedAt: new Date(), consecutiveFailures: failures, error: healthy ? null : safeError(result.reason) };
    await asset.save();
    await ProductImage.updateMany({ mediaAssetId: asset._id, isDeleted: { $ne: true } }, { $set: { healthStatus: status } });
    return { assetId: String(asset._id), status };
  }

  async processImage(asset, buffer) {
    const metadata = await sharp(buffer, { animated: false, limitInputPixels: MAX_PIXELS }).metadata();
    if (!metadata.width || !metadata.height) throw new Error('Image dimensions could not be determined');
    if (metadata.width * metadata.height > MAX_PIXELS) throw new Error(`Image exceeds ${MAX_PIXELS} decoded pixels`);
    const widths = [...new Set(RENDITION_WIDTHS.filter((width) => width <= metadata.width).concat(Math.min(metadata.width, RENDITION_WIDTHS[0])))].sort((a, b) => a - b);
    const base = asset.key.slice(0, Math.max(0, asset.key.length - path.extname(asset.key).length));
    const renditions = [];
    for (const width of widths) {
      for (const format of ['webp', 'avif']) {
        const pipeline = sharp(buffer, { animated: false, limitInputPixels: MAX_PIXELS }).rotate().resize({ width, withoutEnlargement: true });
        // Encoding is sequential to cap per-worker native memory.
        // eslint-disable-next-line no-await-in-loop
        const output = await (format === 'webp' ? pipeline.webp({ quality: 82, effort: 4 }) : pipeline.avif({ quality: 58, effort: 4 })).toBuffer({ resolveWithObject: true });
        const key = `${base}/renditions/${output.info.width}.${format}`;
        // Object writes are sequential for deterministic memory and provider pressure.
        // eslint-disable-next-line no-await-in-loop
        await provider.putBuffer(key, output.data, { contentType: `image/${format}` });
        renditions.push({
          format, width: output.info.width, height: output.info.height, sizeBytes: output.data.length,
          key, url: provider.getPublicUrl(key), checksumSha256: crypto.createHash('sha256').update(output.data).digest('hex'),
        });
      }
    }
    return { width: metadata.width, height: metadata.height, aspectRatio: Number((metadata.width / metadata.height).toFixed(6)), renditions };
  }
}

export default new MediaProcessingService();
