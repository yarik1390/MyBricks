import type { Env } from '../types';
import { fetchEbaySoldViaBrightData } from '../lib/brightdata';
import { configuredKeys, pickKey } from '../lib/brightdata-keys';
import { fetchEbaySoldViaFirecrawl } from '../lib/ebay-firecrawl';
import { brightDataSoldEnabled, firecrawlEnabled } from '../lib/pricing-flags';
import { quotaRemaining, reserveQuota } from '../lib/api-quota';
import { recordIntegrationHealth } from '../lib/integration-health';
import { recomputeBlendedValues } from '../lib/market-sources';

/**
 * Corroborating-only eBay-sold scrape (Bright Data Web Unlocker).
 *
 * Only targets sets that ALREADY have a BrickLink (or BrickEconomy) value, and
 * only accepts a scraped median that is within 3x of that existing value. So the
 * eBay-sold figure is always cross-checked and can never become a noisy SOLE
 * source — the collision-prone long-tail failure found in Phase-0 validation
 * (e.g. Darth Maul) is structurally excluded (no BrickLink/BE -> not a candidate).
 *
 * Writes ebay_new_value so a corroborated set with BrickLink + eBay-sold reaches
 * high-confidence blend. Prefers Firecrawl (structured extraction) when available;
 * falls back to Bright Data Web Unlocker.
 */
export async function runEbaySoldScrape(
  env: Env,
  options: { limit?: number; concurrency?: number } = {},
) {
  // Prefer Bright Data when a token is configured: it has its own dedicated budget
  // (5000/key/mo) so it doesn't compete with Firecrawl, which is reserved for the
  // BrickEconomy enrichment. Fall back to Firecrawl only when no token is set.
  const useBrightData = brightDataSoldEnabled(env);
  const useFirecrawl = !useBrightData && firecrawlEnabled(env);
  if (!useFirecrawl && !useBrightData) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'neither firecrawl nor brightdata configured' };
  }
  // Hardening: Bright Data is the PREFERRED scraper (its own monthly budget;
  // Firecrawl is reserved for BrickEconomy enrichment). If we're only falling back
  // to Firecrawl because no Bright Data token reached the Worker — and it wasn't
  // deliberately paused via BRIGHTDATA_SOLD_ENABLED — surface it on the admin
  // integrations panel and in logs instead of silently degrading. This is exactly
  // the "token added as a CI secret but never uploaded to the Worker" failure mode.
  if (
    useFirecrawl &&
    configuredKeys(env).length === 0 &&
    !/^(0|false|no|off)$/i.test(String(env.BRIGHTDATA_SOLD_ENABLED ?? ''))
  ) {
    const reason = 'Bright Data token not configured (BRIGHTDATA_API_TOKEN/BRIGHTDATA_API_TOKENS missing in Worker env); eBay-sold scrape is falling back to Firecrawl.';
    console.warn(`[ebay-sold-scrape] ${reason}`);
    await recordIntegrationHealth(env, 'brightdata', { ok: 0, fail: 1, lastError: reason });
  }
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 20;
  // Firecrawl is metered by its own per-scrape guard (5cr/json extract) inside
  // firecrawlScrape, so size to remaining daily credits WITHOUT reserving — a
  // double reservation here would make the admin Firecrawl credits panel
  // over-report. Bright Data has no in-scrape meter, so it still books up front.
  let effLimit: number;
  if (useFirecrawl) {
    const remaining = await quotaRemaining(env, 'firecrawl');
    if (remaining < 5) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'firecrawl daily ceiling reached' };
    effLimit = Math.min(limit, Math.floor(remaining / 5));
  } else {
    // Confirm a live (non-exhausted) key exists BEFORE reserving the daily quota,
    // so a fully-exhausted/broken pool doesn't debit the api_quota ledger for a
    // run that will make zero HTTP calls (which inflated the admin usage panel).
    const live = await pickKey(env);
    if (!live) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'brightdata: all keys exhausted this month' };
    effLimit = (await reserveQuota(env, { brightdata: limit })).brightdata ?? 0;
    if (effLimit <= 0) return { processed: 0, updated: 0, rejected: 0, limit, skipped: 'brightdata quota spent' };
  }

  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name, ls.bl_new_value, ls.current_value
    FROM lego_sets ls
    WHERE (ls.bl_new_value IS NOT NULL OR ls.valuation_method = 'brickeconomy')
      AND (ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-30 days'))
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.ebay_new_cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(effLimit).all<{ set_num: string; name: string; bl_new_value: number | null; current_value: number | null }>();
  if (!results.length) return { processed: 0, updated: 0, rejected: 0, limit: effLimit };

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 8));
  let updated = 0;
  let processed = 0;
  let rejected = 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  const touched: string[] = [];

  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (set) => {
      const fetcher = useFirecrawl
        ? fetchEbaySoldViaFirecrawl(set.set_num, set.name, env)
        : fetchEbaySoldViaBrightData(set.set_num, set.name, env);
      const r = await fetcher
        .catch((e) => ({ status: 'error' as const, new_value: null, new_count: 0, error: (e as Error)?.message }));
      return { set, r };
    }));
    for (const { set, r } of outs) {
      processed++;
      if (r.status === 'ok' || r.status === 'no_data') health.ok++;
      else { health.fail++; if (r.error) health.lastError = r.error; }

      if (r.status === 'ok' && r.new_value != null) {
        // Corroboration gate: accept only if within 3x of the existing
        // BrickLink/BrickEconomy value, so a polluted scrape can't skew a blend.
        const ref = set.bl_new_value ?? set.current_value ?? null;
        const corroborated = ref == null ? true : (r.new_value >= ref / 3 && r.new_value <= ref * 3);
        if (corroborated) {
          stmts.push(env.DB.prepare(
            `UPDATE lego_sets SET ebay_new_value=?, ebay_new_qty=?, ebay_new_cached_at=datetime('now'),
             ebay_new_last_sold=COALESCE(?, ebay_new_last_sold) WHERE set_num=?`,
          ).bind(r.new_value, r.new_count, r.new_last_sold ?? null, set.set_num));
          touched.push(set.set_num);
          updated++;
        } else {
          rejected++;
          // Stamp cached_at so a divergent set isn't re-scraped every run.
          stmts.push(env.DB.prepare(
            `UPDATE lego_sets SET ebay_new_cached_at=datetime('now') WHERE set_num=?`,
          ).bind(set.set_num));
        }
      } else if (r.status === 'no_data') {
        stmts.push(env.DB.prepare(
          `UPDATE lego_sets SET ebay_new_cached_at=datetime('now') WHERE set_num=?`,
        ).bind(set.set_num));
      }
    }
  }

  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  if (touched.length) await recomputeBlendedValues(env.DB, touched);
  // Firecrawl self-records each scrape attempt inside firecrawlScrape, so only
  // the Bright Data path (which doesn't self-record) needs the aggregate write —
  // writing it for Firecrawl too would double-count and clobber the real error.
  if (!useFirecrawl) await recordIntegrationHealth(env, 'brightdata', health);
  return { processed, updated, rejected, limit: effLimit };
}
