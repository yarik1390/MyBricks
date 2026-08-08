import type { Env } from '../types';
import { fetchBrickEconomyViaFirecrawl } from '../lib/brickeconomy-firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { quotaRemaining } from '../lib/api-quota';
import { sourceEnabled } from '../lib/source-config';

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
  if (!(await sourceEnabled(env, 'brickeconomy'))) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'brickeconomy disabled in source tuning' };
  }
  if (!(await sourceEnabled(env, 'firecrawl'))) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'firecrawl disabled in source tuning' };
  }
  if (!firecrawlEnabled(env)) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'firecrawl disabled or no key' };
  }

  const requestedLimit = Number(options.limit);
  // Cap at 200 for the manual bootstrap. Measured steady-state: 40 sets took 148s
  // at concurrency 5 (~3.7s/set), so the hourly slots pass 60 (~220s) to stay
  // clear of the invocation wall — the 5-minute run at 200 is what killed the
  // eBay job, and this one now runs 48x a day.
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 40;

  // Size the batch to the remaining daily credits WITHOUT reserving (the
  // per-scrape guard in firecrawlScrape is the sole real-credit meter). Use the
  // worst-case 5-credit json cost as the divisor so we never overshoot the cap.
  //
  // RESERVE: this job now runs 48x a day and, during the catch-up sweep, wants
  // ~14,400 of the 16,000 daily ceiling. It also runs at :25 and :50 of EVERY
  // hour, so it reaches the shared Firecrawl ledger before the jobs scheduled
  // later in the day do — measured burn is ~740 credits/hour, which exhausts the
  // ceiling around 20:00 and would leave the 21:00 and 00:00 eBay-sold runs with
  // nothing. That lane is Firecrawl-primary precisely because Bright Data is
  // down, so starving it is the worst possible trade.
  //
  // So BrickEconomy stops at a floor rather than at zero, leaving the rest of the
  // day's Firecrawl consumers (Brickset, LEGO stock, minifigs, eBay-sold rescue —
  // ~2,400/day between them) their budget. BrickEconomy is the one job here that
  // loses nothing by deferring: an unswept set just comes due again tomorrow.
  const reserve = Math.max(0, Number(env.FIRECRAWL_RESERVE_CREDITS ?? 3000) || 0);
  const remaining = await quotaRemaining(env, 'firecrawl');
  const spendable = Number.isFinite(remaining) ? remaining - reserve : remaining;
  if (spendable < 5) {
    return {
      processed: 0, updated: 0, limit: 0,
      skipped: `firecrawl budget floor reached (${remaining} left, ${reserve} reserved for other jobs)`,
    };
  }
  const effLimit = Math.min(limit, Math.floor(spendable / 5));

  // Select by FRESHNESS (never-scraped or >90d stale), NOT by "be_value_new IS
  // NULL". A scrape that yields no usable value still stamps be_cached_at (see
  // the miss path below); gating on be_value_new IS NULL would re-select — and
  // re-charge 5cr for — those un-populatable sets every single run, burning the
  // daily credit ceiling while the bootstrap never advances past them. The
  // ORDER BY still prioritizes never-valued sets, so real values fill first.
  // TWO cadences, because the catalog splits cleanly in two:
  //   - 15,154 sets that HAVE yielded BrickEconomy data. This is the app's widest
  //     price source and 98.8% of it was stale, so it refreshes on a ~weekly gate
  //     (BRICKECONOMY_REFRESH_DAYS, default 7).
  //   - ~7,700 sets that have never yielded a value. BrickEconomy simply has no
  //     page-worth of data for them; re-asking weekly would burn ~38,000 Firecrawl
  //     credits a week for nothing, so they stay on the old 90-day gate.
  // The refresh gate — not the cron cadence — is the real credit governor here:
  // once the whole set is inside the window, only ~1/7th of it comes due per day.
  const refreshDays = Math.min(Math.max(Number(env.BRICKECONOMY_REFRESH_DAYS) || 7, 1), 365);
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num
    FROM lego_sets ls
    WHERE (
        ls.be_cached_at IS NULL
        OR (ls.be_value_new IS NOT NULL AND ls.be_cached_at < datetime('now', '-${refreshDays} days'))
        OR (ls.be_value_new IS NULL AND ls.be_cached_at < datetime('now', '-90 days'))
      )
      AND ls.year >= 2000
    ORDER BY
      -- Never tried first, then the weekly refresh of sets that actually carry
      -- data, and only then the known-empty tail. (Was "be_value_new IS NULL
      -- first", which under the split cadence would have front-loaded exactly
      -- the sets BrickEconomy has nothing for.)
      CASE
        WHEN ls.be_cached_at IS NULL THEN 0
        WHEN ls.be_value_new IS NOT NULL THEN 1
        ELSE 2
      END,
      -- Uncorrelated IN, not a pair of correlated EXISTS. SQLite materializes
      -- this subquery into one transient index instead of re-running two
      -- lookups per candidate row: measured 342,756 -> 38,171 rows read for an
      -- identical result set. That matters now the job runs 48x a day.
      CASE WHEN ls.set_num IN (
        SELECT set_num FROM user_collection WHERE deleted_at IS NULL
        UNION SELECT set_num FROM user_wishlist
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
    const outs = await Promise.all(batch.map(async ({ set_num }) => {
      try {
        return { set_num, scrape: await fetchBrickEconomyViaFirecrawl(set_num, env), failed: false };
      } catch {
        return { set_num, scrape: null, failed: true };
      }
    }));

    for (const { set_num, scrape, failed } of outs) {
      processed++;
      // Provider failures remain immediately retryable. Only a successful
      // scrape with no usable values earns the 90-day negative-data stamp.
      if (failed) continue;
      if (!scrape) {
        // A successful scrape found no usable BrickEconomy data. Stamp the
        // negative result so the set is not re-scraped every run.
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
