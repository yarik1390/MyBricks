import type { Env } from '../types';
import { fetchEbaySoldViaBrightData } from '../lib/brightdata';
import { configuredKeys, pickKey } from '../lib/brightdata-keys';
import { fetchEbaySoldViaFirecrawl } from '../lib/ebay-firecrawl';
import { brightDataSoldEnabled, firecrawlEnabled } from '../lib/pricing-flags';
import { quotaRemaining, reserveQuota } from '../lib/api-quota';
import { recordIntegrationHealth } from '../lib/integration-health';
import { recomputeBlendedValues } from '../lib/market-sources';
import { sourceEnabled } from '../lib/source-config';

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
  if (!(await sourceEnabled(env, 'ebay'))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'ebay disabled in source tuning' };
  }
  // Prefer Bright Data when a token is configured: it has its own dedicated budget
  // (5000/key/mo) so it doesn't compete with Firecrawl, which is reserved for the
  // BrickEconomy enrichment. Fall back to Firecrawl only when no token is set.
  const useBrightData = brightDataSoldEnabled(env) && await sourceEnabled(env, 'brightdata');
  const useFirecrawl = !useBrightData && firecrawlEnabled(env) && await sourceEnabled(env, 'firecrawl');
  // Rescue lane: Bright Data fails ~71% of eBay scrapes (blocks / short bodies).
  // When it's the primary and Firecrawl is also configured, a set whose BD
  // scrape errors gets ONE Firecrawl retry in the same wave before it's
  // negative-cached — converting most of that failure rate into coverage at
  // ~5 credits a set. Firecrawl self-meters its credits inside firecrawlScrape.
  const fcRescue = useBrightData && firecrawlEnabled(env) && await sourceEnabled(env, 'firecrawl');
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
  // over-report. Bright Data has no in-scrape meter; it books AFTER the
  // negative-cache filter below, so KV-skipped sets never debit the ledger.
  let capLimit: number;
  if (useFirecrawl) {
    const remaining = await quotaRemaining(env, 'firecrawl');
    if (remaining < 5) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'firecrawl daily ceiling reached' };
    capLimit = Math.min(limit, Math.floor(remaining / 5));
  } else {
    // Confirm a live (non-exhausted) key exists BEFORE any selection work, so a
    // fully-exhausted/broken pool doesn't debit the api_quota ledger for a run
    // that will make zero HTTP calls (which inflated the admin usage panel).
    const live = await pickKey(env);
    if (!live) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'brightdata: all keys exhausted this month' };
    capLimit = limit;
  }

  // Over-select 2x, then drop sets in the KV negative cache (recent no-data /
  // divergence / provider error). Without this, the freshness ordering below
  // pins perennial failures to the queue front forever: they never get an
  // ebay_new_cached_at stamp (deliberately — stamping absent data would make it
  // look fresh to the blend), so they'd out-sort every new candidate each run.
  const { results: candidates } = await env.DB.prepare(`
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
  `).bind(capLimit * 2).all<{ set_num: string; name: string; bl_new_value: number | null; current_value: number | null }>();

  const kv = env.CACHE_KV;
  const skipKey = (setNum: string) => `ebay-sold:skip:${setNum}`;
  const filtered: typeof candidates = [];
  for (let i = 0; i < candidates.length && filtered.length < capLimit; i += 20) {
    const wave = candidates.slice(i, i + 20);
    const skips = kv
      ? await Promise.all(wave.map((s) => kv.get(skipKey(s.set_num)).catch(() => null)))
      : wave.map(() => null);
    for (let j = 0; j < wave.length && filtered.length < capLimit; j++) {
      if (!skips[j]) filtered.push(wave[j]);
    }
  }
  if (!filtered.length) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: candidates.length ? 'all candidates negative-cached' : undefined };

  // Reserve Bright Data quota for what will ACTUALLY be scraped.
  let results = filtered;
  let effLimit = filtered.length;
  if (!useFirecrawl) {
    effLimit = (await reserveQuota(env, { brightdata: filtered.length })).brightdata ?? 0;
    if (effLimit <= 0) return { processed: 0, updated: 0, rejected: 0, limit, skipped: 'brightdata quota spent' };
    results = filtered.slice(0, effLimit);
  }

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 8));
  let updated = 0;
  let processed = 0;
  let rejected = 0;
  let rescued = 0;
  // Per-run rescue budget: each rescue adds a Firecrawl scrape (~5 credits and
  // ~20s to an already-failing wave), so cap it to keep the invocation inside
  // its window — the negative cache means unrescued failures retry in 2 days.
  let rescuesLeft = fcRescue ? 40 : 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  const touched: string[] = [];

  // Negative-cache writes. A KV key — NOT an ebay_new_cached_at stamp — because
  // stamping would make absent data look fresh to the blend's freshness checks.
  // no_data / divergence get a long cooldown; provider errors a short one.
  const negCache = (setNum: string, reason: 'no_data' | 'diverged' | 'err') =>
    kv?.put(skipKey(setNum), reason, { expirationTtl: (reason === 'err' ? 2 : 14) * 86_400 }).catch(() => {});

  // Incremental persistence: flush accumulated writes + re-blend as we go, so a
  // dying invocation (the "stale: invocation ended" cron_runs rows) keeps every
  // completed wave instead of losing the whole run's work.
  const flush = async () => {
    if (!stmts.length && !touched.length) return;
    const s = stmts.splice(0);
    const t = touched.splice(0);
    for (let j = 0; j < s.length; j += 90) await env.DB.batch(s.slice(j, j + 90));
    if (t.length) await recomputeBlendedValues(env.DB, t);
  };

  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (set) => {
      const fetcher = useFirecrawl
        ? fetchEbaySoldViaFirecrawl(set.set_num, set.name, env)
        : fetchEbaySoldViaBrightData(set.set_num, set.name, env);
      const primary = await fetcher
        .catch((e) => ({ status: 'error' as const, new_value: null, new_count: 0, error: (e as Error)?.message }));
      let r = primary;
      if (primary.status === 'error' && rescuesLeft > 0) {
        rescuesLeft--;
        const fr = await fetchEbaySoldViaFirecrawl(set.set_num, set.name, env).catch(() => null);
        if (fr && (fr.status === 'ok' || fr.status === 'no_data')) r = fr;
      }
      return { set, primary, r };
    }));
    for (const { set, primary, r } of outs) {
      processed++;
      // Integration health tracks the PRIMARY provider's attempt — a rescue
      // masking Bright Data's failure in the health panel would hide the very
      // signal that says its keys/proxies are degrading.
      if (primary.status === 'ok' || primary.status === 'no_data') health.ok++;
      else { health.fail++; if (primary.error) health.lastError = primary.error; }
      if (r !== primary) rescued++;

      if (r.status === 'no_data') await negCache(set.set_num, 'no_data');
      else if (r.status !== 'ok') await negCache(set.set_num, 'err');

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
          await negCache(set.set_num, 'diverged');
          stmts.push(env.DB.prepare(`
            INSERT INTO pricing_anomalies (
              anomaly_key, set_num, condition, source, anomaly_type, severity,
              detail_json, status, first_seen_at, last_seen_at
            ) VALUES (?1, ?2, 'new_sealed', 'ebay_sold', 'value_divergence', 'warning', ?3, 'open', datetime('now'), datetime('now'))
            ON CONFLICT(anomaly_key) DO UPDATE SET
              detail_json=excluded.detail_json, status='open', last_seen_at=datetime('now'), resolved_at=NULL
          `).bind(
            `ebay_sold:${set.set_num}:value_divergence`,
            set.set_num,
            JSON.stringify({ observed: r.new_value, reference: ref }),
          ));
        }
      }
    }
    if (stmts.length >= 90) await flush();
  }

  await flush();
  // Firecrawl self-records each scrape attempt inside firecrawlScrape, so only
  // the Bright Data path (which doesn't self-record) needs the aggregate write —
  // writing it for Firecrawl too would double-count and clobber the real error.
  if (!useFirecrawl) await recordIntegrationHealth(env, 'brightdata', health);
  return { processed, updated, rejected, rescued, limit: effLimit };
}
