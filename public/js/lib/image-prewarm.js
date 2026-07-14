// First-launch image prewarm: proactively cache the top sets' images so they
// show OFFLINE even before the user has browsed to them. Reuses the bundled
// seed catalog (already contains proxied /api/img URLs) — we just fetch a
// bounded, throttled slice through the service worker, which stores them in its
// image cache (cache-first). Everything else caches naturally as it's viewed.
//
// Cost-aware and gentle: runs ONCE per install, only when online and NOT on a
// metered / data-saver connection, low concurrency, capped count. R2 egress is
// free and the Cloudflare edge cache shares these popular images across users,
// so the only real cost is the user's own first-launch bandwidth — hence the
// wifi/unmetered gate.

// v2: prewarm the GRID THUMBNAILS (via the Transformations zone, ~15KB each)
// instead of the full images (~100KB) — so the same wifi budget warms ~3× more
// sets and it's exactly the variant the catalog grid requests.
const DONE_FLAG = 'bv_img_prewarm_v2';
const MAX_IMAGES = 250;  // ~250 × ~15KB ≈ 4MB one-time, wifi only
const CONCURRENCY = 4;

export async function prewarmTopImages() {
  try {
    if (localStorage.getItem(DONE_FLAG)) return;
    // @capacitor/network gives a real wifi/cellular answer in the Android
    // WebView (navigator.connection is missing there); falls back to web APIs.
    const { isUnmetered } = await import('./native-net.js');
    if (!(await isUnmetered())) return;

    const [{ loadSeedCatalog }, { thumbImg }] = await Promise.all([
      import('./seed-catalog.js'),
      import('../utils.js'),
    ]);
    const seed = await loadSeedCatalog();
    if (!seed?.sets?.length) return;

    // Seed is already ordered by value DESC, so the head is the iconic set list.
    // Warm the thumbnail variant the grid actually shows.
    const urls = seed.sets
      .slice(0, MAX_IMAGES)
      .map((s) => thumbImg(s.image_url))
      .filter((u) => typeof u === 'string' && u.includes('/api/img'));

    // Mark done up-front so a mid-run reload doesn't restart the whole batch.
    localStorage.setItem(DONE_FLAG, String(Date.now()));

    let i = 0;
    const worker = async () => {
      while (i < urls.length) {
        const url = urls[i++];
        // GET so the SW's cache-first handler stores it in the image cache.
        // no-store on OUR fetch is wrong (we WANT it cached) — default cache mode
        // lets the SW intercept and persist. Ignore failures; natural browsing
        // and the lazy proxy backstop anything skipped.
        try { await fetch(url, { mode: 'cors' }); } catch { /* ignore */ }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch { /* best-effort — never let prewarm affect the app */ }
}
