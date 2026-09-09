/**
 * Bloomy Storefront — Service Worker (PWA Phase 7.1)
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS): stale-while-revalidate
 *   - API calls: network-first (fall back to cache on offline)
 *   - Images: cache-first (30-day expiry)
 *   - Fonts: cache-first (365-day expiry)
 *
 * The service worker is registered only in production builds.
 * In development, Vite's HMR needs a live connection.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `bloomy-${CACHE_VERSION}`;
const API_CACHE = `bloomy-api-${CACHE_VERSION}`;
const IMAGE_CACHE = `bloomy-images-${CACHE_VERSION}`;

const APP_SHELL = [
  '/',
  '/index.html',
];

// ─── Install: pre-cache the app shell ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ───
self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE_NAME, API_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: route-based strategies ───
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET
  if (request.method !== 'GET') return;

  // Same-origin API calls → network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Images → cache-first
  if (request.destination === 'image' || /\.(jpg|jpeg|png|webp|avif|svg|gif)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, 30 * 24 * 60 * 60 * 1000));
    return;
  }

  // Fonts → cache-first (long-lived)
  if (request.destination === 'font' || /\.(woff2?|ttf|otf)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, CACHE_NAME, 365 * 24 * 60 * 60 * 1000));
    return;
  }

  // App shell (HTML navigation) → stale-while-revalidate
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
    return;
  }

  // Everything else (JS, CSS) → stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
});

// ─── Strategies ───

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('{"error":"offline"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request, cacheName, maxAge) {
  const cached = await caches.match(request);
  if (cached) {
    // Check if stale
    const date = cached.headers.get('sw-cached-at');
    if (date && Date.now() - Number(date) > maxAge) {
      // Stale — revalidate in background
      fetch(request).then((r) => {
        if (r.ok) {
          const headers = new Headers(r.headers);
          headers.set('sw-cached-at', String(Date.now()));
          caches.open(cacheName).then((c) => c.put(request, new Response(r.clone().body, { headers })));
        }
      }).catch(() => {});
    }
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set('sw-cached-at', String(Date.now()));
      const cache = await caches.open(cacheName);
      cache.put(request, new Response(response.clone().body, { headers }));
    }
    return response;
  } catch {
    return new Response('', { status: 504 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}
