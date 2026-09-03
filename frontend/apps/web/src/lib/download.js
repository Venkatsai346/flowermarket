/**
 * Browser download helper for the shared client's `raw`/`download` response.
 *
 * The shared client intentionally leaves raw responses unconsumed so a page can
 * decide whether the file is small (Blob in memory) or large (streamed). This
 * helper does the small-file path and, crucially, keeps every CSV/template
 * download on the authenticated `api.*` path — no component ever calls fetch.
 */
import { ApiError } from '@flower-market/shared';

/** Extract a safe filename from `content-disposition`, RFC 5987 preferred. */
export function filenameFromHeaders(headers, fallback = 'download') {
  const h = headers || {};
  const disposition = String(
    h['content-disposition'] ?? h['Content-Disposition'] ?? ''
  );

  const star = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (star) return sanitizeFilename(decodeURIComponent(star.replace(/\+/g, ' ')));

  const quoted = disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1];
  if (quoted) return sanitizeFilename(quoted);

  const plain = disposition.match(/filename\s*=\s*([^;]+)/i)?.[1];
  if (plain) return sanitizeFilename(plain.trim());

  return sanitizeFilename(fallback || 'download');
}

/** Keep filenames safe for the OS while preserving a human-friendly label. */
export function sanitizeFilename(name = '') {
  const cleaned = String(name)
    .split(/[\\/]/)
    .pop()
    .replace(/[\x00-\x1f]/g, '')
    .trim();
  return cleaned || 'download';
}

function responseFromResult(result) {
  if (result instanceof Response) return result;
  if (result?.data instanceof Response) return result.data;
  throw new ApiError('Download response did not contain a browser Response', {
    status: 0,
    code: 'INVALID_DOWNLOAD_RESPONSE',
  });
}

function responseHeaders(result) {
  return result && typeof result === 'object' && !(result instanceof Response)
    ? result.headers
    : null;
}

/** Create an object URL and trigger the browser's native save flow. */
export function triggerBlobDownload(blob, filename) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking the blob URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeNameForHeader(headers, fallback) {
  return sanitizeFilename(filenameFromHeaders(headers, fallback));
}

/**
 * Resolve the RawApiResponse from the shared client into a downloadable Blob.
 * Returns `{ blob, filename, size, type }`.
 */
export async function downloadToFile(result, fallbackName = 'download') {
  const res = responseFromResult(result);
  if (!res.ok) {
    throw new ApiError(`Download failed (${res.status})`, {
      status: res.status,
      code: 'DOWNLOAD_FAILED',
    });
  }

  const headers = responseHeaders(result);
  const filename = sanitizeNameForHeader(headers, fallbackName);
  const blob = await res.blob();

  return {
    blob,
    filename,
    size: blob.size,
    type: blob.type || 'application/octet-stream',
  };
}

/**
 * One-call helper for list pages: `saveDownload(await api.admin.exportOrders(q), 'orders.csv')`.
 * Returns the file metadata for downstream toasts / analytics.
 */
export async function saveDownload(result, fallbackName = 'download') {
  const file = await downloadToFile(result, fallbackName);
  triggerBlobDownload(file.blob, file.filename);
  return file;
}

export default saveDownload;
