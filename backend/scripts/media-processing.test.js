import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { sniffMagic } from '../src/services/storageProvider.service.js';
import MediaAsset from '../src/models/mediaAsset.model.js';
import MediaProcessingJob from '../src/models/mediaProcessingJob.model.js';
import mediaProcessingService from '../src/services/mediaProcessing.service.js';
import config from '../src/config/index.js';

const png = await sharp({ create: { width: 900, height: 600, channels: 4, background: '#d946ef' } }).png().toBuffer();
const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).webp().toBuffer();
assert.equal(sniffMagic(png), 'png');
assert.equal(sniffMagic(jpeg), 'jpeg');
assert.equal(sniffMagic(webp), 'webp');
assert.equal(sniffMagic(Buffer.from('not an image at all')), null);
assert.equal(sniffMagic(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(12).fill(0)])), 'webm');

const evidence = await mediaProcessingService.processImage({ key: 'test/media-pipeline/sample.png' }, png);
assert.equal(evidence.width, 900);
assert.equal(evidence.height, 600);
assert.equal(evidence.aspectRatio, 1.5);
assert.deepEqual([...new Set(evidence.renditions.map((row) => row.format))].sort(), ['avif', 'webp']);
assert(evidence.renditions.every((row) => row.url && row.key && /^[a-f0-9]{64}$/.test(row.checksumSha256)));
assert(evidence.renditions.every((row) => row.width <= 900));

assert(MediaAsset.schema.path('checksumSha256'));
assert(MediaAsset.schema.path('renditions'));
assert(MediaAsset.schema.path('provenance.sourceType'));
assert(MediaProcessingJob.schema.indexes().some(([keys, options]) => keys.assetId === 1 && options.unique));
assert(MediaProcessingJob.schema.indexes().some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
fs.rmSync(path.join(config.storage.localDir, 'test'), { recursive: true, force: true });

console.log('media processing tests passed');
