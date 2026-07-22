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
 * Corroborating-only eBay-sold scrape (Firecrawl or Bright Data).
 *
 * Only targets sets that ALREADY have a BrickLink (or BrickEconomy) value, and
 * only accepts a scraped median that is within 3x of that existing value. So the
 * eBay-sold figure is always cross-checked and can never become a noisy SOLE
 * source — the collision-prone long-tail failure found in Phase-0 validation
 * (e.g. Darth Maul) is structurally excluded (no BrickLink/BE -> not a candidate).
 * Writes ebay_new_value so a corroborated set with BrickLink + eBay-sold reaches
 * high-confidence blend.
 *
 * PROVIDER: steady-state prefers Bright Data (its own budget) with a Firecrawl
 * rescue; `preferFirecrawl:true` (the fast-backfill lane) makes Firecrawl primary
 * to bypass Bright Data's ~70% eBay failure rate. ANTI-STALL: a miss stamps
 * set_market_ext.ebay_sold_attempted_at (14-day cooldown, SQL-visible) instead of
 * a KV neg-cache the candidate query couldn't see — so the sweep can't wall itself.
 */
export async function runEbaySoldScrape(
  env: Env,
  options: { limit?: number; concurrency?: number; preferFirecrawl?: boolean } = {},
) {
  if (!(await sourceEnabled(env, 'ebay'))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'ebay disabled in source tuning' };
  }
  const canFirecrawl = firecrawlEnabled(env) && await sourceEnabled(env, 'firecrawl');
  const canBrightData = brightDataSoldEnabled(env) && await sourceEnabled(env, 'brightdata');
  // preferFirecrawl (the fast-backfill lane) forces Firecrawl as the PRIMARY engine,
  // bypassing Bright Data's ~70%-failure bottleneck to build coverage quickly.
  // Steady-state (preferFirecrawl false): Bright Data is primary (its own dedicated
  // 5000/key/mo budget) with a Firecrawl RESCUE on failure; falls all the way back to
  // Firecrawl-primary only when no Bright Data token is configured.
  const useFirecrawl = options.preferFirecrawl ? canFirecrawl : (!canBrightData && canFirecrawl);
  const useBrightData = !useFirecrawl && canBrightData;
  const fcRescue = useBrightData && canFirecrawl;
  if (!useFirecrawl && !useBrightData) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'neither firecrawl nor brightdata configured' };
  }
  // Hardening: outside the backfill lane, Bright Data is the PREFERRED scraper. If we
  // fell back to Firecrawl only because no Bright Data token reached the Worker — and
  // it wasn't deliberately paused via BRIGHTDATA_SOLD_ENABLED — surface it on the admin
  // integrations panel and in logs instead of silently degrading. (In preferFirecrawl
  // mode the Firecrawl-primary path is intentional, so no warning.)
  if (
    useFirecrawl &&
    !options.preferFirecrawl &&
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

  // Candidates need a stale/absent SUCCESS (ebay_new_cached_at, which feeds the
  // blend) AND a stale/absent ATTEMPT (ext.ebay_sold_attempted_at). The attempt
  // marker — written on every MISS below — is the whole anti-stall mechanism:
  // a miss drops out of the queue for 14 days instead of perpetually re-sorting to
  // the front (the old KV neg-cache couldn't be seen by SQL, so the freshness sort
  // pinned failures to the front and no over-select could reach past the wall —
  // the "all candidates negative-cached" stall). Order least-recently-attempted
  // first so the sweep is monotonic; fetch exactly the batch (no over-select needed).
  const { results: candidates } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name, ls.bl_new_value, ls.current_value
    FROM lego_sets ls
    LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE (ls.bl_new_value IS NOT NULL OR ls.valuation_method = 'brickeconomy')
      AND (ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-30 days'))
      AND (ext.ebay_sold_attempted_at IS NULL OR ext.ebay_sold_attempted_at < datetime('now', '-14 days'))
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ext.ebay_sold_attempted_at, ls.ebay_new_cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(capLimit).all<{ set_num: string; name: string; bl_new_value: number | null; current_value: number | null }>();
  if (!candidates.length) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: undefined };

  // Reserve Bright Data quota for what will ACTUALLY be scraped.
  let results = candidates;
  let effLimit = candidates.length;
  if (!useFirecrawl) {
    effLimit = (await reserveQuota(env, { brightdata: candidates.length })).brightdata ?? 0;
    if (effLimit <= 0) return { processed: 0, updated: 0, rejected: 0, limit, skipped: 'brightdata quota spent' };
    results = candidates.slice(0, effLimit);
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

  // Stamp the attempt marker on a MISS so the set drops out of the candidate query
  // for 14 days (see the query above). A SQL column — NOT ebay_new_cached_at, which
  // is success-only and feeds the blend — so absent data never looks fresh to the
  // blend while still being skipped by the scrape queue. Batched with the writes.
  const stampAttempt = (setNum: string) =>
    stmts.push(env.DB.prepare(
      `INSERT INTO set_market_ext (set_num, ebay_sold_attempted_at) VALUES (?1, datetime('now'))
       ON CONFLICT(set_num) DO UPDATE SET ebay_sold_attempted_at=datetime('now')`,
    ).bind(setNum));

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

      // Any non-success (no_data / provider error) → stamp the attempt so it
      // cools down for 14 days instead of jamming the queue front.
      if (r.status !== 'ok' || r.new_value == null) stampAttempt(set.set_num);

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
          // Wrong-item / polluted scrape — stamp the attempt (cooldown) too.
          rejected++;
          stampAttempt(set.set_num);
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
