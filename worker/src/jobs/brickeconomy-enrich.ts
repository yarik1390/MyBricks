import type { Env } from '../types';
import { fetchBrickEconomyViaFirecrawl } from '../lib/brickeconomy-firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { quotaRemaining } from '../lib/api-quota';

/**
 * Populate BrickEconomy valuation data via Firecrawl structured extraction — a
 * cost-free replacement for the (~$1,000/mo) BrickEconomy API. Scrapes the
 * public set page into the be_* staging columns (current new/used value, the
 * real 2y + 5y forecasts, original retail, trailing-12m growth) for sets whose
 * be_cached_at is NULL or stale (>90 days).
 *
 * These columns are a STAGING area only: the valuation job (valuate-sets) reads
 * them and applies the existing isPlausibleMarketValue corroboration gate before
 * any figure is allowed to set current_value, so a hallucinated scrape can never
 * poison a valuation. Writing here is therefore unconditional (after the lib's
 * own numeric validation) — promotion is gated downstream.
 *
 * Prioritises: un-scraped sets first, then owned/wishlisted, then by value DESC
 * (the visible high-value head), so the sets that matter get covered first. The
 * json LLM extract costs 5 Firecrawl credits/scrape; the per-scrape credit guard
 * in firecrawlScrape is the hard ceiling (env-tunable for the one-time bootstrap).
 */
export async function runBrickEconomyEnrich(
  env: Env,
  options: { limit?: number; concurrency?: number } = {},
) {
  if (!firecrawlEnabled(env)) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'firecrawl disabled or no key' };
  }

  const requestedLimit = Number(options.limit);
  // Cap at 200: with concurrency 5 and ~15s/scrape that's ~10 min wall — safe
  // inside a scheduled invocation. The temporary bootstrap cron drives the high
  // limit; the steady-state daily cron passes a small one.
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 40;

  // Size the batch to the remaining daily credits WITHOUT reserving (the
  // per-scrape guard in firecrawlScrape is the sole real-credit meter). Use the
  // worst-case 5-credit json cost as the divisor so we never overshoot the cap.
  const remaining = await quotaRemaining(env, 'firecrawl');
  if (remaining < 5) return { processed: 0, updated: 0, limit: 0, skipped: 'firecrawl daily ceiling reached' };
  const effLimit = Math.min(limit, Math.floor(remaining / 5));

  const { results } = await env.DB.prepare(`
    SELECT ls.set_num
    FROM lego_sets ls
    WHERE (ls.be_value_new IS NULL OR ls.be_cached_at IS NULL OR ls.be_cached_at < datetime('now', '-90 days'))
      AND ls.year >= 2000
    ORDER BY
      CASE WHEN ls.be_value_new IS NULL THEN 0 ELSE 1 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(NULLIF(ls.blended_value, 0), ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(effLimit).all<{ set_num: string }>();

  if (!results.length) return { processed: 0, updated: 0, limit: effLimit };

  let processed = 0;
  let updated = 0;
  const stmts: D1PreparedStatement[] = [];

  // Scrape in small concurrent batches (default 5, matching ebay-sold-scrape) so
  // the bootstrap drains thousands of sets across invocations without serializing
  // ~15s scrapes one-by-one. The per-scrape credit guard in firecrawlScrape is
  // the hard ceiling regardless of concurrency.
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 8));
  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async ({ set_num }) => ({
      set_num,
      scrape: await fetchBrickEconomyViaFirecrawl(set_num, env).catch(() => null),
    })));

    for (const { set_num, scrape } of outs) {
      processed++;
      if (!scrape) {
        // No usable BrickEconomy data for this set (a real scrape error or a
        // clean empty/404 page). firecrawlScrape already recorded the attempt's
        // health (real ok/fail + error); a clean empty page counts as an OK
        // scrape there, not a failure. Just stamp be_cached_at so the set isn't
        // re-scraped (and re-charged) every run.
        stmts.push(env.DB.prepare(
          `UPDATE lego_sets SET be_cached_at=datetime('now') WHERE set_num=?`,
        ).bind(set_num));
        continue;
      }

      // Sparse update: only write the figures the scrape actually returned, so a
      // partial scrape never nulls out a previously-good column.
      const fields: string[] = [`be_cached_at=datetime('now')`];
      const binds: number[] = [];
      const maybe = (col: string, val: number | null) => {
        if (val != null) { fields.push(`${col}=?`); binds.push(val); }
      };
      maybe('be_value_new', scrape.current_value_new);
      maybe('be_value_used', scrape.current_value_used);
      maybe('be_forecast_2y', scrape.forecast_value_new_2_years);
      maybe('be_forecast_5y', scrape.forecast_value_new_5_years);
      maybe('be_retail', scrape.retail_price_us);
      maybe('be_growth_12m', scrape.rolling_growth_12months);

      stmts.push(env.DB.prepare(
        `UPDATE lego_sets SET ${fields.join(', ')} WHERE set_num=?`,
      ).bind(...binds, set_num));
      updated++;
    }

    // Flush incrementally so a long bootstrap run persists progress even if the
    // invocation is truncated at the wall-time limit (the credits are already
    // spent; this makes sure the columns get written).
    if (stmts.length >= 90) {
      await env.DB.batch(stmts.splice(0, stmts.length));
    }
  }

  if (stmts.length) await env.DB.batch(stmts);
  // No aggregate health write — firecrawlScrape records each scrape attempt
  // (real ok/fail + error message) inside the wrapper. Writing a batch tally
  // here would double-count and clobber the real error with "unknown error".
  return { processed, updated, limit: effLimit };
}
