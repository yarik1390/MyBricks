import type { Env } from '../types';
import { checkLegoStock } from '../lib/lego-stock';
import { quotaRemaining } from '../lib/api-quota';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { sourceEnabled } from '../lib/source-config';
import { brightDataEnabled } from '../lib/brightdata-keys';
import { scrapingAntEnabled } from '../lib/scrapingant';
import { FIRECRAWL_MAX_CONCURRENCY } from '../lib/firecrawl';

/**
 * Proactively refresh LEGO.com stock + retirement status. Phase-2 lean scope:
 * only ACTIVE (non-retired) sets that are OWNED or WISHLISTED, on a 14-day cycle
 * — the sets users actually track for availability/retirement. The broad catalog
 * is left to the formula retirement-risk model so the ongoing Firecrawl credit
 * footprint stays within budget (~25k/mo). Prioritises: never-checked first,
 * then retiring_soon, then stalest.
 *
 * Writes: lego_in_stock, lego_retiring_soon, lego_availability, lego_checked_at,
 * and (when Firecrawl returns a price) retail_price if the fetched value differs.
 */
export async function runLegoStockRefresh(env: Env, options: { limit?: number } = {}) {
  const hasScrapingAnt = (await sourceEnabled(env, 'scrapingant')) && scrapingAntEnabled(env);
  const hasBrightData = (await sourceEnabled(env, 'brightdata')) && brightDataEnabled(env);
  const hasFirecrawl = (await sourceEnabled(env, 'firecrawl')) && firecrawlEnabled(env);
  if (!hasScrapingAnt && !hasBrightData && !hasFirecrawl) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'ScrapingAnt, Bright Data, and Firecrawl disabled or unconfigured' };
  }

  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 100;

  // Size to remaining daily credits WITHOUT reserving — the per-scrape guard in
  // firecrawlScrape is the sole real-credit meter (5cr/json extract). Reserving up
  // front here would double-count against that guard and make the admin Firecrawl
  // credits panel over-report.
  const remaining = await quotaRemaining(env, 'firecrawl');
  if (!hasScrapingAnt && !hasBrightData && remaining < 5) return { processed: 0, updated: 0, limit: 0, skipped: 'firecrawl daily ceiling reached' };
  const effLimit = (hasScrapingAnt || hasBrightData) ? limit : Math.min(limit, Math.floor(remaining / 5));

  // Owned/wishlisted sets first; when that pool runs dry, keep going catalog-wide
  // over active retail sets. This makes the lane the authoritative retail-price +
  // stock-truth source after pricesAPI was removed (2026-08) instead of only a
  // per-user checker.
  const { results } = await env.DB.prepare(`
    SELECT set_num FROM (
      SELECT ls.set_num, COALESCE(ls.lego_retiring_soon, 0) AS prio
      FROM lego_sets ls
      WHERE ls.retired = 0
        AND (ls.lego_checked_at IS NULL OR ls.lego_checked_at < datetime('now', '-14 days'))
        AND (
          EXISTS (SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num)
        )
      UNION ALL
      SELECT ls2.set_num, 0 AS prio
      FROM lego_sets ls2
      WHERE ls2.retired = 0
        AND (ls2.lego_checked_at IS NULL OR ls2.lego_checked_at < datetime('now', '-90 days'))
        AND ls2.retail_price IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM user_collection uc2 WHERE uc2.set_num = ls2.set_num AND uc2.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM user_wishlist uw2 WHERE uw2.set_num = ls2.set_num)
    )
    ORDER BY prio DESC, set_num
    LIMIT ?
  `).bind(effLimit).all<{ set_num: string }>();

  if (!results.length) return { processed: 0, updated: 0, limit: effLimit };

  let processed = 0;
  let updated = 0;
  const stmts: D1PreparedStatement[] = [];

  // A catalog-wide limit of 200 cannot run serially within a scheduled Worker
  // invocation. Use the account-wide Firecrawl concurrency ceiling because any
  // ScrapingAnt/Bright Data miss can fall through to Firecrawl.
  for (let i = 0; i < results.length; i += FIRECRAWL_MAX_CONCURRENCY) {
    const batch = results.slice(i, i + FIRECRAWL_MAX_CONCURRENCY);
    const outs = await Promise.all(batch.map(async ({ set_num }) => ({
      set_num,
      stock: await checkLegoStock(set_num, env).catch(() => null),
    })));

    for (const { set_num, stock } of outs) {
      processed++;
      if (stock === null) {
        // Leave lego_checked_at untouched — retry next run.
        continue;
      }
      const inStockVal = stock.in_stock === null ? null : (stock.in_stock ? 1 : 0);
      const retiringSoonVal = stock.retiring_soon ? 1 : 0;

      // Persist the fine-grained availability status the scrape already returns
      // (in_stock | out_of_stock | pre_order | back_order | coming_soon | sold_out
      // | retiring) — previously fetched then dropped. COALESCE keeps the prior
      // value when a scrape doesn't surface a status.
      const availabilityVal = stock.availability ?? null;
      if (stock.retail_price_usd != null && stock.retail_price_usd > 0) {
        stmts.push(env.DB.prepare(
          `UPDATE lego_sets SET lego_in_stock=?, lego_retiring_soon=?, lego_checked_at=datetime('now'),
           lego_availability=COALESCE(?, lego_availability),
           retail_price=COALESCE(?, retail_price) WHERE set_num=?`,
        ).bind(inStockVal, retiringSoonVal, availabilityVal, stock.retail_price_usd, set_num));
      } else {
        stmts.push(env.DB.prepare(
          `UPDATE lego_sets SET lego_in_stock=?, lego_retiring_soon=?, lego_checked_at=datetime('now'),
           lego_availability=COALESCE(?, lego_availability) WHERE set_num=?`,
        ).bind(inStockVal, retiringSoonVal, availabilityVal, set_num));
      }
      updated++;
    }
  }

  for (let i = 0; i < stmts.length; i += 90) {
    await env.DB.batch(stmts.slice(i, i + 90));
  }

  return { processed, updated, limit: effLimit };
}
