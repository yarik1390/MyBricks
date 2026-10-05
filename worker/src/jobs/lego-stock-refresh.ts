import type { Env } from '../types';
import { checkLegoStock, legoStockUpdate, normalizeLegoStockResult } from '../lib/lego-stock';
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
    return { processed: 0, updated: 0, failed: 0, no_data: 0, partial: 0, limit: 0, skipped: 'ScrapingAnt, Bright Data, and Firecrawl disabled or unconfigured' };
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
  if (!hasScrapingAnt && !hasBrightData && remaining < 5) return { processed: 0, updated: 0, failed: 0, no_data: 0, partial: 0, limit: 0, skipped: 'firecrawl daily ceiling reached' };
  const effLimit = (hasScrapingAnt || hasBrightData) ? limit : Math.min(limit, Math.floor(remaining / 5));

  // Owned/wishlisted sets first; when that pool runs dry, keep going catalog-wide
  // over active retail sets. This makes the lane the authoritative retail-price +
  // stock-truth source after pricesAPI was removed (2026-08) instead of only a
  // per-user checker.
  const { results } = await env.DB.prepare(`
    SELECT candidates.set_num FROM (
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
    ) candidates LEFT JOIN set_market_ext ext ON ext.set_num=candidates.set_num
    WHERE ext.lego_attempted_at IS NULL OR ext.lego_attempted_at < datetime('now',
      CASE ext.lego_attempt_status WHEN 'partial' THEN '-1 day' ELSE '-1 hour' END)
    ORDER BY (ext.lego_attempted_at IS NOT NULL), ext.lego_attempted_at, prio DESC, candidates.set_num
    LIMIT ?
  `).bind(effLimit).all<{ set_num: string }>();

  if (!results.length) return { processed: 0, updated: 0, failed: 0, no_data: 0, partial: 0, limit: effLimit };

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let no_data = 0;
  let partial = 0;
  const stmts: D1PreparedStatement[] = [];

  // A catalog-wide limit of 200 cannot run serially within a scheduled Worker
  // invocation. Use the account-wide Firecrawl concurrency ceiling because any
  // ScrapingAnt/Bright Data miss can fall through to Firecrawl.
  for (let i = 0; i < results.length; i += FIRECRAWL_MAX_CONCURRENCY) {
    const batch = results.slice(i, i + FIRECRAWL_MAX_CONCURRENCY);
    const outs = await Promise.all(batch.map(async ({ set_num }) => {
      try {
        return { set_num, stock: normalizeLegoStockResult(await checkLegoStock(set_num, env)), failed: false };
      } catch {
        return { set_num, stock: null, failed: true };
      }
    }));

    for (const out of outs) {
      processed++;
      const observedStock = out.stock?.in_stock != null || out.stock?.availability != null;
      const status = out.failed ? 'error' : out.stock === null ? 'unknown' : observedStock ? 'ok' : 'partial';
      // Null mixes transport and extraction misses; it is NOT verified absence.
      // A short retry rotates the queue without pretending an observation.
      await env.DB.prepare(`INSERT INTO set_market_ext (set_num,lego_attempted_at,lego_attempt_status)
        VALUES (?1,datetime('now'),?2) ON CONFLICT(set_num) DO UPDATE SET
        lego_attempted_at=excluded.lego_attempted_at,lego_attempt_status=excluded.lego_attempt_status`)
        .bind(out.set_num, status).run();
      if (out.failed) { failed++; continue; }
      const { set_num, stock } = out;
      if (stock === null) { no_data++; continue; }
      // Retirement/price-only observations must not rejuvenate existing stock.
      if (!observedStock || stock.retiring_soon == null) partial++;
      stmts.push(legoStockUpdate(env.DB, set_num, stock));
    }
  }

  for (let i = 0; i < stmts.length; i += 90) {
    const writes = await env.DB.batch(stmts.slice(i, i + 90));
    updated += writes.reduce((sum, write) => sum + (write.meta.changes ?? 0), 0);
  }

  return { processed, updated, failed, no_data, partial, limit: effLimit };
}
