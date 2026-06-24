import type { Env } from '../types';
import { ALLOWED_IMG_HOSTS, imageR2Key } from '../lib/img-proxy';

/**
 * Pre-warm the R2 image cache so even FIRST views are instant (the /api/img
 * proxy otherwise fills lazily on first view). Fetches each set's Rebrickable
 * image and stores it under the SAME R2 key the proxy reads, prioritizing the
 * sets users actually look at (owned/wishlisted) then the high-value head.
 *
 * ToS + politeness: Rebrickable explicitly permits caching Set/Part/Minifig
 * images, but forbids automated traffic — so this is deliberately gentle
 * (bounded limit/run, low concurrency, one daily pass) and ONLY touches
 * cdn.rebrickable.com. Each set is stamped (img_prewarmed_at) once attempted so
 * the queue advances and we never re-hammer the same images; the lazy proxy
 * backstops anything skipped/failed.
 */
export async function runImagePrewarm(
  env: Env,
  options: { limit?: number; concurrency?: number } = {},
) {
  if (!env.PHOTO_BUCKET) return { processed: 0, cached: 0, limit: 0, skipped: 'R2 not configured' };

  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 300)
    : 100;

  // Rebrickable-only, never-prewarmed, owned/wishlisted first then high-value.
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.image_url
    FROM lego_sets ls
    WHERE ls.img_prewarmed_at IS NULL
      AND ls.image_url LIKE 'https://cdn.rebrickable.com/%'
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(NULLIF(ls.blended_value, 0), ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; image_url: string }>();

  if (!results.length) return { processed: 0, cached: 0, limit };

  let processed = 0;
  let cached = 0;
  const stamps: D1PreparedStatement[] = [];
  const bucket = env.PHOTO_BUCKET;

  // Low concurrency to stay polite to the source (not bulk automation).
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (r) => {
      // Defensive ToS host re-check — only Rebrickable.
      let host = '';
      try { host = new URL(r.image_url).hostname; } catch { return { set_num: r.set_num, ok: false }; }
      if (!ALLOWED_IMG_HOSTS.has(host)) return { set_num: r.set_num, ok: false };
      try {
        const key = await imageR2Key(r.image_url);
        // Skip if already cached (e.g. lazily filled by a prior view).
        if (await bucket.head(key).catch(() => null)) return { set_num: r.set_num, ok: true };
        const resp = await fetch(r.image_url, { headers: { Accept: 'image/*' } });
        if (!resp.ok) return { set_num: r.set_num, ok: false };
        const contentType = resp.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) return { set_num: r.set_num, ok: false };
        await bucket.put(key, await resp.arrayBuffer(), { httpMetadata: { contentType } });
        return { set_num: r.set_num, ok: true };
      } catch {
        return { set_num: r.set_num, ok: false };
      }
    }));
    for (const { set_num, ok } of outs) {
      processed++;
      if (ok) cached++;
      // Stamp regardless: catalog images are immutable and the lazy proxy
      // backstops any miss, so a one-time attempt is enough — and stamping
      // advances the queue instead of re-hammering the same sets.
      stamps.push(env.DB.prepare(
        `UPDATE lego_sets SET img_prewarmed_at=datetime('now') WHERE set_num=?`,
      ).bind(set_num));
    }
  }

  for (let i = 0; i < stamps.length; i += 90) await env.DB.batch(stamps.slice(i, i + 90));
  return { processed, cached, limit };
}
