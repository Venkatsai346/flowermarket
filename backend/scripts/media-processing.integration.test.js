import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { MongoMemoryServer } from 'mongodb-memory-server';
import config from '../src/config/index.js';
import MediaAsset from '../src/models/mediaAsset.model.js';
import mediaService from '../src/services/media.service.js';
import mediaProcessingService from '../src/services/mediaProcessing.service.js';
import { MEDIA_PURPOSE, MEDIA_STATUS, MEDIA_TYPE } from '../src/constants/enums.js';
import { up as createMediaIndexes } from '../src/migrations/011_media_ingestion_pipeline.js';

const oid = (suffix) => new mongoose.Types.ObjectId(`66f00000000000000000${suffix}`);
const tenantId = oid('0001');
const otherTenantId = oid('0002');
const actorId = oid('0003');
const buffer = await sharp({ create: { width: 900, height: 900, channels: 4, background: '#16a34a' } }).png().toBuffer();

let mongod = null;
let mongoUri = process.env.MONGODB_URI || null;
if (!mongoUri) {
  try {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri();
  } catch (error) {
    if (error?.name === 'DownloadError' || error?.code === 'ECONNRESET') {
      console.log('media processing integration: SKIP (local mongod unavailable; CI uses MongoDB service)');
      process.exit(0);
    }
    throw error;
  }
}

try {
  await mongoose.connect(mongoUri, { dbName: 'media-processing-durable' });
  const db = mongoose.connection.db;
  await db.dropDatabase();
  await createMediaIndexes(db);
  const key = `${tenantId}/product_image/test/source.png`;
  const asset = await MediaAsset.create({
    tenantId, uploadedBy: actorId, purpose: MEDIA_PURPOSE.PRODUCT_IMAGE, type: MEDIA_TYPE.IMAGE,
    mimeType: 'image/png', extension: 'png', sizeBytes: buffer.length, key, url: `/media/local/${key}`,
    status: MEDIA_STATUS.PENDING,
  });
  await mediaService.writeLocal({ key, buffer });
  const confirmed = await mediaService.confirm({ assetId: asset._id, tenantId });
  assert.equal(confirmed.status, MEDIA_STATUS.PROCESSING);
  for (let index = 0; index < 50; index += 1) {
    // Sequential bounded polling is safe if the API kick already claimed the only job.
    // eslint-disable-next-line no-await-in-loop
    await mediaProcessingService.processAvailable({ workerId: 'media-integration', maxJobs: 1 });
    // eslint-disable-next-line no-await-in-loop
    const current = await MediaAsset.findById(asset._id).lean();
    if (current.status === MEDIA_STATUS.READY) break;
    // The native encoder may belong to the API kick; bounded polling yields to it.
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const ready = await MediaAsset.findById(asset._id).lean();
  assert.equal(ready.status, MEDIA_STATUS.READY);
  assert.equal(ready.detectedMimeType, 'image/png');
  assert.equal(ready.width, 900);
  assert.equal(ready.height, 900);
  assert.match(ready.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(ready.renditions.length, 4);
  assert(ready.renditions.every((row) => fs.existsSync(path.resolve(config.storage.localDir, row.key))));
  await assert.rejects(() => mediaService.get({ assetId: asset._id, tenantId: otherTenantId }), (error) => error.code === 'MEDIA_NOT_FOUND');

  const duplicateKey = `${tenantId}/product_image/test/duplicate.png`;
  const duplicate = await MediaAsset.create({
    tenantId, uploadedBy: actorId, purpose: MEDIA_PURPOSE.PRODUCT_IMAGE, type: MEDIA_TYPE.IMAGE,
    mimeType: 'image/png', extension: 'png', sizeBytes: buffer.length, key: duplicateKey, url: `/media/local/${duplicateKey}`,
    status: MEDIA_STATUS.PROCESSING,
  });
  await mediaService.writeLocal({ key: duplicateKey, buffer });
  await mediaProcessingService.enqueue({ assetId: duplicate._id, tenantId });
  await mediaProcessingService.processAvailable({ workerId: 'media-integration', maxJobs: 1 });
  const deduped = await MediaAsset.findById(duplicate._id).lean();
  assert.equal(String(deduped.duplicateOf), String(asset._id));

  console.log('media processing integration passed');
} finally {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  fs.rmSync(path.join(config.storage.localDir, String(tenantId)), { recursive: true, force: true });
}
