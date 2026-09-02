/**
 * StorageProvider — object-store abstraction for media uploads.
 *
 *   provider: 'local' | 's3'   (config.storage.provider)
 *
 * The client flow is IDENTICAL for both:
 *   1. backend signs an upload (returns uploadUrl/method/headers)
 *   2. client PUTs bytes straight to that URL (never through the API)
 *   3. backend verifies the object (size/type) on confirm
 *
 * s3    → presigned PUT via AWS SDK v3; public-read objects; HeadObject verify.
 * local → PUT through the authenticated `/media/upload` route; file on disk,
 *         served via express static; verify = stat + magic-byte sniff.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Compact magic-byte sniff for the types we accept (no dependency).
 * Returns the detected extension or null when the buffer doesn't match.
 */
export function sniffMagic(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = Buffer.from(bytes);
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  // GIF
  if (b.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  // WebP: RIFF....WEBP
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  // AVIF / ISO-BMFF (mp4/mov): ....ftyp<brand>
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'avif';
    if (brand === 'qt  ') return 'mov';
    return 'mp4'; // isom / mp42 / avc1 / M4V ...
  }
  return null;
}

class LocalProvider {
  constructor(cfg) {
    this.root = cfg.localDir;
    this.publicPath = cfg.localPublicPath;
    fs.mkdirSync(this.root, { recursive: true });
  }

  absolute(key) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) throw new Error('Invalid key path');
    return p;
  }

  /** The client PUTs to this authenticated API route with the raw bytes. */
  async signUpload({ key }) {
    return {
      uploadUrl: `/api/v1/media/upload?key=${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: {},
      via: 'local',
    };
  }

  getPublicUrl(key) {
    return `${this.publicPath}/${key}`;
  }

  /** Write a raw buffer (already parsed by express.raw) to disk. */
  async writeBuffer(key, buffer) {
    const abs = this.absolute(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, buffer);
    const stat = fs.statSync(abs);
    return stat.size;
  }

  /** Verify: size + magic bytes against the claimed content type. */
  async verify({ key, expectedSize, contentType }) {
    const abs = this.absolute(key);
    if (!fs.existsSync(abs)) return { ok: false, reason: 'missing' };
    const stat = fs.statSync(abs);
    if (stat.size !== Number(expectedSize)) {
      return { ok: false, reason: `size mismatch: ${stat.size} != ${expectedSize}` };
    }
    const head = fs.readFileSync(abs).subarray(0, 16);
    const sniffed = sniffMagic(head);
    const claimed = (contentType || '').split('/')[1]?.split('+')[0]?.toLowerCase();
    if (!sniffed || (claimed && !claimed.includes(sniffed) && !sniffed.includes(claimed))) {
      return { ok: false, reason: `magic bytes (${sniffed || 'unknown'}) do not match content-type (${contentType})` };
    }
    return { ok: true };
  }

  async remove(key) {
    try {
      fs.unlinkSync(this.absolute(key));
    } catch { /* already gone */ }
    return { removed: true };
  }
}

class S3Provider {
  constructor(cfg) {
    this.cfg = cfg;
    const { bucket, region, accessKeyId, secretAccessKey, publicBaseUrl } = cfg;
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined,
    });
    this.baseUrl = publicBaseUrl || `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  async signUpload({ key, contentType, size, expiresIn }) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size, // S3 rejects uploads that exceed this
      ACL: 'public-read',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    const uploadUrl = await getSignedUrl(this.client, cmd, { expiresIn });
    return { uploadUrl, method: 'PUT', headers: { 'content-type': contentType }, via: 's3' };
  }

  getPublicUrl(key) {
    return `${this.baseUrl}/${key}`;
  }

  async verify({ key, expectedSize, contentType }) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (Number(head.ContentLength) !== Number(expectedSize)) {
        return { ok: false, reason: `size mismatch: ${head.ContentLength} != ${expectedSize}` };
      }
      if (contentType && head.ContentType && head.ContentType !== contentType) {
        return { ok: false, reason: `content-type mismatch: ${head.ContentType} != ${contentType}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.name === 'NotFound' ? 'missing' : err.message };
    }
  }

  async remove(key) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch { /* best-effort */ }
    return { removed: true };
  }
}

export function createStorageProvider(cfg) {
  if (cfg.provider === 's3') {
    if (!cfg.s3.bucket) throw new Error('STORAGE_PROVIDER=s3 requires S3_BUCKET');
    return new S3Provider(cfg.s3);
  }
  return new LocalProvider(cfg);
}

export default createStorageProvider;
