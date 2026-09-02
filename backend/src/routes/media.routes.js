import { Router } from 'express';
import express from 'express';
import MediaController from '../controllers/media.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  presignSchema,
  mediaListQuerySchema,
  mediaIdParamSchema,
} from '../utils/validators/media.validators.js';

const router = Router();

/**
 * /media — image/video uploads (authenticated).
 *
 *  POST /media/presign      → {asset, uploadUrl, method, headers, expiresIn}
 *  PUT  /media/upload?key=  → local provider only; raw bytes to disk
 *  POST /media/:id/confirm  → verify in store → status ready
 *  GET  /media              → gallery (tenant-scoped)
 *  GET  /media/:id · DELETE /media/:id
 */
router.use(authenticate);

router.post('/presign', validate(presignSchema), MediaController.presign);

// raw-body route (like the payment webhooks) so the browser can PUT bytes
// without them being parsed as JSON. Must be mounted before any body parsing
// that would consume the stream — router-level raw handles it here.
router.put(
  '/upload',
  express.raw({ type: '*/*', limit: '300mb' }),
  MediaController.uploadLocal
);

router.get('/', validate(mediaListQuerySchema, 'query'), MediaController.list);
router.get('/:id', validate(mediaIdParamSchema, 'params'), MediaController.get);
router.post('/:id/confirm', validate(mediaIdParamSchema, 'params'), MediaController.confirm);
router.delete('/:id', validate(mediaIdParamSchema, 'params'), MediaController.remove);

export default router;
