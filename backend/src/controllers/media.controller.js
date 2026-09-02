import mediaService from '../services/media.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { badRequest } from '../utils/ApiError.js';

/**
 * MediaController — image/video upload pipeline.
 * Presign → (client PUTs to the object store) → confirm → ready.
 */
class MediaController {
  /** POST /media/presign — sign an upload + register the pending asset. */
  presign = asyncHandler(async (req, res) => {
    const result = await mediaService.presign({
      userId: req.auth.userId,
      tenantId: req.tenantId,
      filename: req.body.filename,
      contentType: req.body.contentType,
      size: req.body.size,
      purpose: req.body.purpose,
    });
    res.status(201).json(success(result, { message: 'Upload signed' }));
  });

  /** PUT /media/upload?key= — local provider only; streams raw bytes to disk. */
  uploadLocal = asyncHandler(async (req, res) => {
    const size = Number(req.headers['content-length']) || 0;
    if (!size) throw badRequest('Content-Length required', 'CONTENT_LENGTH_REQUIRED');
    await mediaService.uploadLocal({
      key: req.query.key,
      tenantId: req.tenantId,
      contentType: req.headers['content-type'],
      size,
    });
    const written = await mediaService.writeLocal({ key: req.query.key, buffer: req.body });
    res.status(200).json(success({ ok: true, size: written }, { message: 'Upload stored' }));
  });

  /** POST /media/:id/confirm — verify the object in the store, mark ready. */
  confirm = asyncHandler(async (req, res) => {
    const asset = await mediaService.confirm({ assetId: req.params.id, tenantId: req.tenantId });
    res.status(200).json(success(asset, { message: 'Upload verified' }));
  });

  /** GET /media — gallery list (tenant-scoped). */
  list = asyncHandler(async (req, res) => {
    const result = await mediaService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Media fetched', meta: result.meta }));
  });

  /** GET /media/:id */
  get = asyncHandler(async (req, res) => {
    const asset = await mediaService.get({ assetId: req.params.id, tenantId: req.tenantId });
    res.status(200).json(success(asset, { message: 'Media fetched' }));
  });

  /** DELETE /media/:id */
  remove = asyncHandler(async (req, res) => {
    const result = await mediaService.remove({
      assetId: req.params.id,
      tenantId: req.tenantId,
      actorId: req.auth.userId,
    });
    res.status(200).json(success(result, { message: 'Media deleted' }));
  });
}

export default new MediaController();
