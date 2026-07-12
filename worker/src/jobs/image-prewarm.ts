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

  // Two queues, sets first: Rebrickable-only, never-prewarmed, owned/wishlisted
  // first then high-value. Any leftover capacity drains the minifig queue the
  // same way, so one pacing knob covers the whole ~44k-image catalog.
  const { results: setRows } = await env.DB.prepare(`
    SELECT ls.set_num AS id, ls.image_url
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
  `).bind(limit).all<{ id: string; image_url: string }>();

  const figLimit = limit - setRows.length;
  const figRows: { id: string; image_url: string }[] = [];
  if (figLimit > 0) {
    const { results } = await env.DB.prepare(`
      SELECT m.fig_num AS id, m.image_url
      FROM minifigs m
      WHERE m.img_prewarmed_at IS NULL
        AND m.image_url LIKE 'https://cdn.rebrickable.com/%'
      ORDER BY
        CASE WHEN EXISTS (
          SELECT 1 FROM user_minifigs um WHERE um.fig_num = m.fig_num
        ) THEN 0 ELSE 1 END,
        COALESCE(m.current_value, 0) DESC,
        m.fig_num ASC
      LIMIT ?
    `).bind(figLimit).all<{ id: string; image_url: string }>();
    figRows.push(...results);
  }

  const queue = [
    ...setRows.map((r) => ({ ...r, table: 'lego_sets' as const })),
    ...figRows.map((r) => ({ ...r, table: 'minifigs' as const })),
  ];
  if (!queue.length) return { processed: 0, cached: 0, limit };

  let processed = 0;
  let cached = 0;
  const stamps: D1PreparedStatement[] = [];
  const bucket = env.PHOTO_BUCKET;

  // Low concurrency to stay polite to the source (not bulk automation).
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (r) => {
      // Defensive ToS host re-check — only Rebrickable.
      let host = '';
      try { host = new URL(r.image_url).hostname; } catch { return { row: r, ok: false }; }
      if (!ALLOWED_IMG_HOSTS.has(host)) return { row: r, ok: false };
      try {
        const key = await imageR2Key(r.image_url);
        // Skip if already cached (e.g. lazily filled by a prior view).
        if (await bucket.head(key).catch(() => null)) return { row: r, ok: true };
        const resp = await fetch(r.image_url, { headers: { Accept: 'image/*' } });
        if (!resp.ok) return { row: r, ok: false };
        const contentType = resp.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) return { row: r, ok: false };
        await bucket.put(key, await resp.arrayBuffer(), { httpMetadata: { contentType } });
        return { row: r, ok: true };
      } catch {
        return { row: r, ok: false };
      }
    }));
    for (const { row, ok } of outs) {
      processed++;
      if (ok) cached++;
      // Stamp regardless: catalog images are immutable and the lazy proxy
      // backstops any miss, so a one-time attempt is enough — and stamping
      // advances the queue instead of re-hammering the same images.
      stamps.push(row.table === 'lego_sets'
        ? env.DB.prepare(`UPDATE lego_sets SET img_prewarmed_at=datetime('now') WHERE set_num=?`).bind(row.id)
        : env.DB.prepare(`UPDATE minifigs SET img_prewarmed_at=datetime('now') WHERE fig_num=?`).bind(row.id));
    }
  }

  for (let i = 0; i < stamps.length; i += 90) await env.DB.batch(stamps.slice(i, i + 90));
  return { processed, cached, limit, sets: setRows.length, minifigs: figRows.length };
}
