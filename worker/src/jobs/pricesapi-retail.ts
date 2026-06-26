import type { Env } from '../types';
import { pricesApiSearch } from '../lib/pricesapi';
import { pricesapiEnabled } from '../lib/pricing-flags';
import { recomputeBlendedValues } from '../lib/market-sources';
import { quotaRemaining, spendQuota } from '../lib/api-quota';
import { getSourceConfig, sourceEnabled } from '../lib/source-config';

/**
 * Refresh the pricesAPI.io live-retail layer (pa_* in set_market_ext) for the
 * sets that benefit most: owned/wishlisted first, then retiring-soon / high-value.
 *
 * pricesAPI is cron-only because cold calls run 30–90s. We therefore go SMALL and
 * SEQUENTIAL: the free tier is 6 calls/min per key, and a handful of 90s calls
 * already fills a cron invocation. The daily 'pricesapi' quota cap plus the
 * per-key monthly pool (lib/pricesapi-keys) bound total spend.
 *
 * Writing pa_* and re-running the blend refreshes the deal signal / stock truth
 * (computeDealSignal reads the pa_* fields via the set_market_ext JOIN).
 */
export async function runPricesApiRetail(
  env: Env,
  options: { limit?: number } = {},
): Promise<{ processed: number; updated: number; limit: number; skipped?: string }> {
  if (!pricesapiEnabled(env)) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'pricesAPI disabled (set PRICESAPI_API_KEYS + PRICESAPI_ENABLED=1)' };
  }
  // Admin kill-switch (source-tuning console) — overrides the env opt-in.
  if (!(await sourceEnabled(env, 'pricesapi'))) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'pricesAPI disabled in admin source tuning' };
  }

  const requested = Number(options.limit);
  // Cap at 10; cold-call latency means even this can take several minutes.
  const wantLimit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 10) : 6;

  // Respect the daily budget — don't even select if we have nothing to spend.
  const remaining = await quotaRemaining(env, 'pricesapi');
  if (remaining <= 0) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'daily pricesapi cap reached' };
  }
  const limit = Math.min(wantLimit, remaining);

  const refreshDays = Math.max(1, Math.round((await getSourceConfig(env)).pricesapi.refreshDays ?? 7));
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name
    FROM lego_sets ls
    LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE (ext.pa_cached_at IS NULL OR ext.pa_cached_at < datetime('now', '-${refreshDays} days'))
      AND ls.year >= 2018
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      CASE WHEN ls.lego_retiring_soon = 1 OR ls.retirement_risk_score >= 70 THEN 0 ELSE 1 END,
      COALESCE(NULLIF(ls.blended_value, 0), ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string }>();

  if (!results.length) return { processed: 0, updated: 0, limit };

  let processed = 0;
  let updated = 0;
  let consecutiveMisses = 0;
  const touched: string[] = [];

  for (const set of results) {
    // Charge the daily budget before the call; stop cleanly when it's spent.
    if (!(await spendQuota(env, 'pricesapi', 1))) break;
    processed++;

    const baseNum = set.set_num.replace(/-\d+$/, '');
    const result =
      (await pricesApiSearch(`LEGO ${baseNum}`, env)) ??
      (set.name ? await pricesApiSearch(`LEGO ${set.name}`, env) : null);

    if (!result) {
      // Stamp pa_cached_at so a no-coverage set isn't retried every run; preserve
      // any previously stored pa_* values.
      await env.DB.prepare(
        `INSERT INTO set_market_ext (set_num, pa_cached_at) VALUES (?1, datetime('now'))
         ON CONFLICT(set_num) DO UPDATE SET pa_cached_at = datetime('now')`,
      ).bind(set.set_num).run();
      // Bail if the provider looks down/drained (many cold nulls in a row waste budget).
      if (++consecutiveMisses >= 3) break;
      continue;
    }
    consecutiveMisses = 0;

    await env.DB.prepare(
      `INSERT INTO set_market_ext
         (set_num, pa_retail_value, pa_lowest_offer, pa_in_stock, pa_best_merchant, pa_offer_count, pa_market, pa_cached_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
       ON CONFLICT(set_num) DO UPDATE SET
         pa_retail_value = ?2, pa_lowest_offer = ?3, pa_in_stock = ?4,
         pa_best_merchant = ?5, pa_offer_count = ?6, pa_market = ?7, pa_cached_at = datetime('now')`,
    ).bind(
      set.set_num,
      result.retail_value,
      result.lowest_offer,
      result.in_stock ? 1 : 0,
      result.best_merchant,
      result.offer_count,
      result.market,
    ).run();
    touched.push(set.set_num);
    updated++;
  }

  // Refresh blend/deal-signal for touched sets so the deal CTA + alerts reflect
  // the new live-retail prices.
  if (touched.length) await recomputeBlendedValues(env.DB, touched);

  return { processed, updated, limit };
}
