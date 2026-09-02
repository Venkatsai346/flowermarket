/**
 * Browser upload helper — presign → direct PUT (with progress) → confirm.
 *
 * Works for both providers:
 *  - local: uploadUrl is same-origin (/api/v1/media/upload?key=…) → we attach
 *    the session's Authorization + x-tenant-id headers (the route is authed).
 *  - s3:    uploadUrl is a presigned S3 URL → we send ONLY content-type (the
 *    presigned URL is the credential; no app headers, no CORS preflight issue).
 */
import { useAuthStore } from '@flower-market/shared';
import { api } from '../api.js';

export const MEDIA_PURPOSE = {
  productImage: 'product_image',
  categoryImage: 'category_image',
  brandLogo: 'brand_logo',
  storeLogo: 'store_logo',
  storeBanner: 'store_banner',
  productVideo: 'product_video',
};

export function isSameOrigin(url) {
  return url.startsWith('/');
}

function putWithProgress(url, { method = 'PUT', file, headers = {}, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else {
        let msg = `Upload failed (HTTP ${xhr.status})`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j?.message) msg = j.message;
        } catch { /* not json */ }
        const err = new Error(msg);
        err.status = xhr.status;
        err.code = xhr.status === 413 ? 'MEDIA_TOO_LARGE' : 'UPLOAD_FAILED';
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    if (signal) signal.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/**
 * Upload a File from the device: presign → PUT → confirm.
 * Returns the ready asset { id, url, type, purpose, sizeBytes, … }.
 */
export async function uploadFile({ file, purpose, onProgress, signal }) {
  const presign = await api.media.presign({
    filename: file.name || 'upload',
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    purpose,
  });
  const { uploadUrl, method, headers } = presign.data;

  const h = { ...(headers || {}) };
  if (isSameOrigin(uploadUrl)) {
    const s = useAuthStore.getState();
    if (s.accessToken) h.authorization = `Bearer ${s.accessToken}`;
    if (s.user?.tenantId) h['x-tenant-id'] = s.user.tenantId;
  }
  if (!h['content-type']) h['content-type'] = file.type || 'application/octet-stream';

  await putWithProgress(uploadUrl, { method: method || 'PUT', file, headers: h, onProgress, signal });

  const confirm = await api.media.confirm(presign.data.asset.id);
  return confirm.data;
}

/** Human error for upload failures (size / type / network). */
export const uploadErrorText = (e) => {
  if (e?.code === 'MEDIA_TOO_LARGE') return 'File is too large (max 10 MB images / 250 MB videos).';
  if (e?.status === 403) return 'This file type is not allowed here.';
  if (e?.message) return e.message;
  return 'Upload failed. Please try again.';
};
