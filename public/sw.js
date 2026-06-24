// Bump VERSION on every deploy that changes cached assets.
const VERSION = 'v175';
const STATIC_CACHE = `brickvault-static-${VERSION}`;
const API_CACHE = `brickvault-api-${VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/app.css',
  '/skin-premium.css',
  '/theme-init.js',
  '/manifest.json',
  '/icon.svg',
  '/env.js',
  '/js/app.js',
  '/js/theme.js',
  '/js/state.js',
  '/js/icons.js',
  '/js/utils.js',
  '/js/api.js',
  '/js/router.js',
  '/js/lib/pure.js',
  '/js/lib/morphdom.js',
  '/js/lib/local-ai.js',
  '/js/components/sheet.js',
  '/js/components/skeleton.js',
  '/js/components/trust.js',
  '/js/components/scanner.js',
  '/js/components/scanner-lazy.js',
  '/js/components/advisor.js',
  '/js/components/advisor-lazy.js',
  '/js/components/flip-calc.js',
  '/js/components/onboarding.js',
  '/js/views/login.js',
  '/js/views/me.js',
  '/js/views/me-shared.js',
  '/js/views/me-integrations.js',
  '/js/views/me-data.js',
  '/js/views/me-admin.js',
  '/js/views/portfolio.js',
  '/js/views/portfolio-social.js',
  '/js/views/portfolio-wishlist.js',
  '/js/views/portfolio-detail.js',
  '/js/views/catalog.js',
  '/js/views/minifigs.js',
  '/js/views/build.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(STATIC_ASSETS))
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
    // On a network failure fall back to cache; if that misses too (e.g. a
    // cache-busted probe URL like /manifest.json?_=ts), return a real error
    // Response so respondWith() never receives `undefined` (which would break
    // the request rather than surface a clean network error to the caller).
    .catch(() => caches.match(request).then(c => c || Response.error()));
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

  // API — bypass the SW entirely. The API runs on a separate origin
  // (brickvault-api.*.workers.dev), so this must come BEFORE the cross-origin
  // branch below or every data request gets served cache-first (stale). Fetch
  // natively so no cache/SW state can serve stale data or break a request.
  if (url.pathname.startsWith('/api/')) return;

  // Cross-origin (e.g. Rebrickable CDN images, fonts) — cache-first, opaque OK.
  if (url.origin !== self.location.origin) {
    // AI model downloads are multi-GB — cloning them into Cache Storage OOMs
    // mobile devices (they stream straight to OPFS instead). Let the browser
    // fetch natively, bypassing the SW cache entirely.
    if (/(^|\.)huggingface\.co$|(^|\.)hf\.co$/.test(url.hostname) ||
        url.pathname.endsWith('.bin') || url.pathname.endsWith('.task') ||
        url.pathname.endsWith('.litertlm')) {
      return;
    }
    e.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // App shell (HTML / JS / CSS) — network-first so code updates always reach
  // users on their next visit instead of being pinned to a stale cache.
  e.respondWith(networkFirst(request, STATIC_CACHE));
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', e => {
  let data = { title: 'Brickvault', body: 'New alert', url: '/' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  // Payload urls are hash routes ("#/catalog/123-1") or app paths ("/").
  const target = self.location.origin + (url.startsWith('#') ? '/' + url : url.startsWith('/') ? url : '/' + url);
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'navigate', url });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
