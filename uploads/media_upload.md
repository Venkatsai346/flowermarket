# Media upload — images & videos from device → AWS S3 (backend + web console)

> Owner: Product platform + frontend teams. Status: **✅ SHIPPED** (backend + web console; E2E green through the Vite proxy).
> Web-only (mobile parked). Builds on the established patterns: provider abstraction
> (like billing/notifications/payments), data-as-data registry, audited writes, exact
> contract mapping, full regression (9/9 + smoke-media green).

## 1. Goal

Let operators upload **images and videos from their device** and use them across the
console — product master images, category images, brand logos, storefront logo/banner —
with a single, secure, reusable pipeline.

**The world-class pattern: presigned URLs.** The backend signs a short-lived PUT URL;
the browser uploads the file **directly to the object store** (never through the API —
no memory/bandwidth cost, no timeout), then confirms. The client never sees AWS
credentials. A `local` provider mirrors the same flow in dev so the sandbox demo works
with zero AWS config.

## 2. Architecture

```
device file ──presign──▶ POST /api/v1/media/presign {filename, contentType, size, purpose}
                          │ creates mediaAssets row (status=pending), returns
                          │ {uploadUrl, method, headers, assetId, expiresIn}
                          ▼
browser ──PUT──▶ uploadUrl          (S3: presigned PUT to bucket   | local: PUT /media/upload)
                          │  uploads bytes with progress, direct to store
                          ▼
browser ──confirm──▶ POST /media/:id/confirm
                          │  provider.verify (S3: HeadObject size+type | local: stat + magic bytes)
                          ▼
                 status=ready → url usable in any form (masters, categories, brands, storefront)
```

- `storageProvider` = `s3 | local` (config `STORAGE_PROVIDER`). Client flow identical for
  both — the abstraction is the contract.
- `mediaAssets` collection = the registry (every object audited, tenant-scoped, reusable
  by the gallery picker).
- Keys are namespaced `{tenantId}/{purpose}/{YYYYMM}/{uuid}.{ext}` — no traversal, no
  collisions, tenant-isolated.

## 3. Security & limits

- **Sign-time validation**: purpose → allowed content-types (images: jpeg/png/webp/gif/
  avif; videos: mp4/webm/mov/quicktime) and size caps (images ≤ 10 MB, videos ≤ 250 MB).
  S3 presign pins `Content-Type` + `Content-Length` so the store rejects violations.
- **Confirm-time verification**: S3 → `HeadObject` (size + type match); local → file stat
  + **magic-byte sniff** (JPEG/PNG/GIF/WebP/AVIF/MP4/MOV) — no dependency, real
  hardening.
- **Auth**: every `/media/*` call requires Bearer; assets are tenant-scoped (list/detail/
  delete/confirm check `tenantId`). The local upload route is authenticated + key-prefixed
  to the caller's tenant. S3 uploads carry no app credentials (the URL is the credential).
- **Deletion**: soft (status `deleted`) + fire-and-forget `provider.remove(key)`.

## 4. API surface (`/api/v1/media`, authenticated)

| Endpoint | Body/query | Returns |
| --- | --- | --- |
| `POST /media/presign` | `{filename, contentType, size, purpose}` | `{asset, uploadUrl, method, headers, expiresIn}` |
| `PUT /media/upload?key=` (local only) | raw bytes | `{ok, size}` |
| `POST /media/:id/confirm` | — | asset (status ready) |
| `GET /media` | `purpose, type, status, page, limit` | paginated list (gallery) |
| `GET /media/:id` | — | asset detail |
| `DELETE /media/:id` | — | `{deleted: true}` |

Enums: `MEDIA_TYPE` image|video · `MEDIA_STATUS` pending|ready|failed|deleted ·
`MEDIA_PURPOSE` product_image|category_image|brand_logo|store_logo|store_banner|
product_video|other.

## 5. Frontend (web console)

- `MediaUploader` — drag-drop + file picker, XHR upload **with progress bar**, preview,
  typed error mapping (413 = too large, 403 = rejected type).
- `MediaPickerModal` — gallery grid from `GET /media` + inline upload + select → returns
  the public URL (reused everywhere).
- `ImageField` — preview + "Upload from device" + URL-paste fallback + clear. Wired into:
  - Product masters: **MasterFormModal** images section (upload appends an image row) and
    **MasterDetailModal** add-image form (upload fills the URL).
  - **CategoryModal** imageUrl, **BrandModal** logoUrl, **BrandingPage** logoUrl/bannerUrl.
- Shared package gains the `media` endpoint group (mobile reuses it later, per plan).

## 6. Config / setup (S3)

`.env`: `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, optional `S3_PUBLIC_BASE_URL` (defaults to the bucket's
`https://{bucket}.s3.{region}.amazonaws.com`). Bucket must allow **public-read** for
storefront objects and have a **CORS** rule allowing PUT from the console origin
(document the exact policy in the plan's appendix).

## 7. QA matrix (`scripts/smoke-media.test.js`)

1. Presign happy path → 200, asset pending, uploadUrl present.
2. PUT bytes to uploadUrl (local) → 200; confirm → ready; `GET /media/:id` shows public url.
3. List scoped: assets of tenant A invisible to tenant B (tenant isolation).
4. Validation: bad extension 400; oversized image 400; video in image purpose 400;
   unauthenticated 401.
5. Magic-byte guard: rename a text file to `.jpg` → confirm fails → status failed.
6. Delete → status deleted + gone from list.
7. Regression: all 9 prior suites green.

## 8. Acceptance criteria

- An operator can upload an image/video from their device in any wired form, watch
  progress, and see it appear (preview + persisted URL) — S3 in prod, local in dev,
  identical UX.
- Every upload is registered in `mediaAssets` (tenant, purpose, size, type, status) and
  reusable via the gallery picker.
- All security limits verified (type/size/magic-bytes/tenant isolation/auth).
- Backend regression 9/9 + smoke-media green; `vite build` clean; E2E through the Vite
  proxy.

## 9. Non-goals (this pass)

- No multipart/resumable uploads (single PUT ≤ 250 MB; multipart is the mobile/video
  follow-up), no transcoding/thumbnails, no malware scan integration, no CDN/CloudFront
  wiring (documented as a prod step).
