// Bump VERSION on every deploy that changes cached assets.
const VERSION = 'v290';
const STATIC_CACHE = `brickvault-static-${VERSION}`;
const API_CACHE = `brickvault-api-${VERSION}`;
// Cross-origin product images live in their own UNVERSIONED, bounded cache:
// unversioned so an app update doesn't re-download hundreds of set photos,
// bounded (FIFO, see trimImgCache) so a heavy catalog browser can't grow it
// until the browser evicts the whole origin — app shell included.
const IMG_CACHE = 'brickvault-img-v1';
// Raised from 300 so browsing the catalog online leaves far more set images
// available offline (FIFO-bounded, ~104KB each → ~73MB ceiling). Paired with a
// gentle first-launch prewarm (lib/image-prewarm.js) of the top sets.
const IMG_CACHE_MAX = 700;
// The bundled offline seed catalog is large (~11 MB) and changes rarely, so it
// lives in its own UNVERSIONED cache — a service-worker VERSION bump must NOT
// force web users to re-download it. Filled on-demand (cache-first), not
// precached. The native app serves it straight from the APK bundle regardless.
const DATA_CACHE = 'brickvault-data-v1';
const STATIC_ASSETS = [
  '/',
  '/app.css',
  '/skin-premium.css',
  '/skin-gold.css',
  '/skin-modular.css',
  '/skin-vivid.css',
  '/skin-kids.css',
  '/theme-init.js',
  '/manifest.json',
  '/privacy.html',
  '/terms.html',
  '/icon.svg',
  '/env.js',
  '/js/app.js',
  '/js/theme.js',
  '/js/state.js',
  '/js/icons.js',
  '/js/utils.js',
  '/js/api.js',
  '/js/router.js',
  '/js/route-meta.js',
  '/js/lib/pure-core.js',
  '/js/lib/pure.js',
  '/js/lib/seed-catalog.js',
  '/js/lib/image-prewarm.js',
  '/js/lib/native-auth.js',
  '/js/lib/native-back.js',
  '/js/lib/native-barcode.js',
  '/js/lib/native-net.js',
  '/js/lib/native-push.js',
  '/js/lib/native-share.js',
  '/js/lib/morphdom.js',
  '/js/lib/local-ai.js',
  '/js/components/sheet.js',
  '/js/components/lightbox.js',
  '/js/components/skeleton.js',
  '/js/components/trust.js',
  '/js/components/scanner.js',
  '/js/components/scanner-lazy.js',
  '/js/components/advisor.js',
  '/js/components/advisor-lazy.js',
  '/js/components/flip-calc.js',
  '/js/components/onboarding.js',
  '/js/components/contribute.js',
  '/js/views/login.js',
  '/js/views/me.js',
  '/js/views/me-shared.js',
  '/js/views/me-integrations.js',
  '/js/views/me-data.js',
  '/js/views/me-contributions.js',
  '/js/views/me-admin.js',
  '/js/views/me-admin-config.js',
  '/js/views/portfolio.js',
  '/js/views/portfolio-social.js',
  '/js/views/portfolio-wishlist.js',
  '/js/views/portfolio-detail.js',
  '/js/views/portfolio-detail-market.js',
  '/js/views/catalog.js',
  '/js/views/minifigs.js',
  '/js/views/build.js',
  '/js/views/kids.js',
  '/js/lib/kids-xp.js',
  '/js/lib/revenuecat-native.js'
];

self.addEventListener('install', e => {
  // Per-asset caching (not addAll) so one renamed/404 asset can't fail the WHOLE
  // install and silently pin users to the previous version. Each miss is logged
  // but non-fatal; the fetch handler still network-first's anything uncached.
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => Promise.all(
      STATIC_ASSETS.map(url =>
        c.add(url).catch(err => console.warn('[sw] precache skipped', url, err && err.message))
      )
    ))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== STATIC_CACHE && k !== API_CACHE && k !== IMG_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// FIFO bound for the image cache: Cache Storage keys() returns entries in
// insertion order, so dropping from the front evicts the oldest images first.
function trimImgCache() {
  return caches.open(IMG_CACHE).then(c =>
    c.keys().then(keys => {
      if (keys.length <= IMG_CACHE_MAX) return;
      return Promise.all(keys.slice(0, keys.length - IMG_CACHE_MAX).map(k => c.delete(k)));
    })
  ).catch(() => {});
}

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
// large immutable assets like product images. Writes to IMG_CACHE are trimmed
// so the image cache stays bounded.
function cacheFirst(request, cacheName) {
  return caches.match(request).then(cached => {
    const fetched = fetch(request).then(r => {
      if (r && r.ok) {
        const clone = r.clone();
        caches.open(cacheName).then(c => c.put(request, clone))
          .then(() => { if (cacheName === IMG_CACHE) return trimImgCache(); });
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

  // Proxied catalog images: /api/img serves immutable image bytes — the one
  // API path that belongs in the image cache (offline images, fewer Worker
  // hits). Must precede the blanket /api/ bypass below.
  if (url.pathname === '/api/img') {
    e.respondWith(cacheFirst(request, IMG_CACHE));
    return;
  }

  // Bundled offline seed catalog — large + rarely-changing, so cache-first in
  // its own unversioned cache (never re-downloaded on a VERSION bump).
  if (url.origin === self.location.origin && url.pathname === '/data/seed-catalog.json') {
    e.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }

  // API — bypass the SW entirely. The API runs on a separate origin
  // (brickvault-api.*.workers.dev), so this must come BEFORE the cross-origin
  // branch below or every data request gets served cache-first (stale). Fetch
  // natively so no cache/SW state can serve stale data or break a request.
  if (url.pathname.startsWith('/api/')) return;

  // Cross-origin (e.g. Rebrickable CDN images, fonts) — cache-first, opaque OK.
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      return;
    }
    // AI model downloads are multi-GB — cloning them into Cache Storage OOMs
    // mobile devices (they stream straight to OPFS instead). Let the browser
    // fetch natively, bypassing the SW cache entirely.
    if (/(^|\.)huggingface\.co$|(^|\.)hf\.co$/.test(url.hostname) ||
        url.pathname.endsWith('.bin') || url.pathname.endsWith('.task') ||
        url.pathname.endsWith('.litertlm')) {
      return;
    }
    e.respondWith(cacheFirst(request, IMG_CACHE));
    return;
  }

  // Navigations get the precached app shell as a last resort, so an offline
  // deep link / first visit shows the app instead of a browser error page.
  if (request.mode === 'navigate') {
    e.respondWith(
      networkFirst(request, STATIC_CACHE)
        .then(r => (r && r.ok) ? r : caches.match('/').then(shell => shell || r))
    );
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
  let data = { title: 'BricksVault', body: 'New alert', url: '/' };
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
