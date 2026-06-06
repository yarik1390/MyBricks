// Bump VERSION on every deploy that changes cached assets.
const VERSION = 'v44';
const STATIC_CACHE = `brickvault-static-${VERSION}`;
const API_CACHE = `brickvault-api-${VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/app.css',
  '/theme-init.js',
  '/manifest.json',
  '/icon.svg',
  '/env.js',
  '/js/app.js',
  '/js/state.js',
  '/js/icons.js',
  '/js/utils.js',
  '/js/api.js',
  '/js/router.js',
  '/js/components/sheet.js',
  '/js/components/scanner.js',
  '/js/components/advisor.js',
  '/js/views/login.js',
  '/js/views/me.js',
  '/js/views/portfolio.js',
  '/js/views/catalog.js',
  '/js/views/minifigs.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== STATIC_CACHE && k !== API_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first: try the network, fall back to cache (for offline). Always
// refreshes the cache with the latest response so updates land immediately.
function networkFirst(request, cacheName) {
  return fetch(request)
    .then(r => {
      if (r && r.ok) {
        const clone = r.clone();
        caches.open(cacheName).then(c => c.put(request, clone));
      }
      return r;
    })
    .catch(() => caches.match(request));
}

// Cache-first: serve from cache, fetch in the background to refresh. Good for
// large immutable assets like product images.
function cacheFirst(request, cacheName) {
  return caches.match(request).then(cached => {
    const fetched = fetch(request).then(r => {
      if (r && r.ok) {
        const clone = r.clone();
        caches.open(cacheName).then(c => c.put(request, clone));
      }
      return r;
    }).catch(() => cached);
    return cached || fetched;
  });
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cross-origin (e.g. Rebrickable CDN images, fonts) — cache-first, opaque OK.
  if (url.origin !== self.location.origin) {
    e.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // API — bypass the SW entirely. Let the browser fetch natively so no
  // cache/SW state can ever break a data request (network-first via the SW
  // could resolve to undefined when both network and cache miss, surfacing
  // as a confusing "Failed to fetch"). The app handles its own errors.
  if (url.pathname.startsWith('/api/')) return;

  // App shell (HTML / JS / CSS) — network-first so code updates always reach
  // users on their next visit instead of being pinned to a stale cache.
  e.respondWith(networkFirst(request, STATIC_CACHE));
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
