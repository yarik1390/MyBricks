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

const DONE_FLAG = 'bv_img_prewarm_v1';
const MAX_IMAGES = 80;   // ~80 × ~100KB ≈ 8MB one-time, wifi only
const CONCURRENCY = 3;

// Skip on metered or data-saver connections; proceed when the API is unknown
// (older browsers) since most first launches are on wifi.
function connectionAllowsPrewarm() {
  const c = navigator.connection || navigator.webkitConnection;
  if (!c) return true;
  if (c.saveData) return false;
  if (c.effectiveType && /(^|\b)(slow-2g|2g|3g)\b/.test(c.effectiveType)) return false;
  return true;
}

export async function prewarmTopImages() {
  try {
    if (!navigator.onLine) return;
    if (localStorage.getItem(DONE_FLAG)) return;
    if (!connectionAllowsPrewarm()) return;

    const { loadSeedCatalog } = await import('./seed-catalog.js');
    const seed = await loadSeedCatalog();
    if (!seed?.sets?.length) return;

    // Seed is already ordered by value DESC, so the head is the iconic set list.
    const urls = seed.sets
      .slice(0, MAX_IMAGES)
      .map((s) => s.image_url)
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
