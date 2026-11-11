import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { edgeCached } from '../lib/edge-cache';

// Public, user-independent data for search engines: the list of set numbers
// behind the paginated sitemap (worker/functions/sitemaps). One keyed scan per
// shard per day per colo, cached at the edge — no user data, no auth.
export const SITEMAP_PAGE_SIZE = 10_000;
const DAY = 86_400;

export const seoRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Only real, buildable sets (named, with pieces) are worth a page. */
const SET_FILTER = "name IS NOT NULL AND name <> '' AND pieces > 0";

seoRoute.get('/sitemap-sets', (c) => edgeCached(c, DAY, async () => {
  const page = Math.max(1, Math.min(100, parseInt(c.req.query('page') || '1', 10) || 1));
  const [countRow, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM lego_sets WHERE ${SET_FILTER}`).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT set_num, substr(COALESCE(cached_at, created_at), 1, 10) AS updated
         FROM lego_sets WHERE ${SET_FILTER}
        ORDER BY set_num LIMIT ?1 OFFSET ?2`,
    ).bind(SITEMAP_PAGE_SIZE, (page - 1) * SITEMAP_PAGE_SIZE).all<{ set_num: string; updated: string | null }>(),
  ]);
  const total = Number(countRow?.n) || 0;
  const res = c.json({
    page,
    pages: Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE)),
    total,
    sets: rows.results ?? [],
  });
  res.headers.set('Cache-Control', `public, max-age=3600, s-maxage=${DAY}`);
  return res;
}));
