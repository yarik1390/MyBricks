import type { Env } from '../types';
import { fetchPartPricing } from '../lib/bricklink';
import { reserveQuota } from '../lib/api-quota';

/**
 * Fill the shared part_prices cache (BrickLink NEW sold price guide) for the
 * parts that matter most — those appearing in the MOST owned/wishlisted +
 * high-value sets that we don't yet have a fresh price for. Pricing the
 * most-shared parts first lifts part-out coverage across many sets per call.
 *
 * Budget: 1 BrickLink call/part, reserved up front via the shared daily ledger
 * (reserveQuota grants min(limit, remaining)), so it can never starve the
 * set-valuation BrickLink budget — it simply does less on a busy day. No
 * Firecrawl credits. Parts are cached for ~90 days here (KV for a week); a
 * priced part is reused by every set that contains it.
 */
export async function runPartPriceBackfill(env: Env, options: { limit?: number } = {}) {
  if (!env.BRICKLINK_CONSUMER_KEY) {
    return { processed: 0, priced: 0, limit: 0, skipped: 'bricklink not configured' };
  }

  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 300)
    : 150;

  // Reserve a slice of today's BrickLink budget (1 call/part). reserveQuota is
  // the sole BrickLink meter (no per-call spend), so booking up front here is
  // correct and shares the cap with set valuations without starving them.
  const grant = (await reserveQuota(env, { bricklink: limit })).bricklink ?? 0;
  if (grant <= 0) return { processed: 0, priced: 0, limit, skipped: 'bricklink budget spent' };

  // Most-shared unpriced/stale non-spare parts across the sets that matter.
  // uses = how many target sets contain the part → pricing it lifts coverage
  // broadly. Restricted to owned/wishlisted + modern catalog (year>=2000).
  const { results } = await env.DB.prepare(`
    SELECT sp.part_num, sp.color_id, COUNT(*) AS uses
    FROM set_parts sp
    JOIN lego_sets ls ON ls.set_num = sp.set_num
    LEFT JOIN part_prices pp ON pp.part_num = sp.part_num AND pp.color_id = sp.color_id
    WHERE sp.is_spare = 0
      AND (pp.cached_at IS NULL OR pp.cached_at < datetime('now', '-90 days'))
      AND (
        EXISTS (SELECT 1 FROM user_collection uc WHERE uc.set_num = sp.set_num AND uc.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM user_wishlist uw WHERE uw.set_num = sp.set_num)
        OR ls.year >= 2000
      )
    GROUP BY sp.part_num, sp.color_id
    ORDER BY uses DESC, sp.part_num ASC
    LIMIT ?
  `).bind(grant).all<{ part_num: string; color_id: number; uses: number }>();

  if (!results.length) return { processed: 0, priced: 0, limit: grant };

  let processed = 0;
  let priced = 0;
  const stmts: D1PreparedStatement[] = [];

  // Light concurrency so a run drains without serializing ~1s calls one-by-one.
  const concurrency = 4;
  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (r) => ({
      r,
      px: await fetchPartPricing(r.part_num, r.color_id, env).catch(() => null),
    })));
    for (const { r, px } of outs) {
      processed++;
      if (px && px.price_new != null) {
        stmts.push(env.DB.prepare(
          `INSERT INTO part_prices (part_num, color_id, price_new, qty_new, cached_at)
           VALUES (?1, ?2, ?3, ?4, datetime('now'))
           ON CONFLICT(part_num, color_id) DO UPDATE SET
             price_new=?3, qty_new=?4, cached_at=datetime('now')`,
        ).bind(r.part_num, r.color_id, px.price_new, px.qty_new));
        priced++;
      } else {
        // Stamp cached_at even on a miss (no guide data / 404) so an unpriceable
        // part isn't re-fetched — and re-charged — every run.
        stmts.push(env.DB.prepare(
          `INSERT INTO part_prices (part_num, color_id, cached_at)
           VALUES (?1, ?2, datetime('now'))
           ON CONFLICT(part_num, color_id) DO UPDATE SET cached_at=datetime('now')`,
        ).bind(r.part_num, r.color_id));
      }
    }
  }

  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return { processed, priced, limit: grant };
}
