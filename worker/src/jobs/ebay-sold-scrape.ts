import type { Env } from '../types';
import { fetchEbaySoldViaBrightData, type EbaySoldScrapeResult } from '../lib/brightdata';
import { configuredKeys, pickKey } from '../lib/brightdata-keys';
import { fetchEbaySoldViaFirecrawl } from '../lib/ebay-firecrawl';
import { brightDataSoldEnabled, firecrawlEnabled } from '../lib/pricing-flags';
import { quotaRemaining, reserveQuota } from '../lib/api-quota';
import { recordIntegrationHealth, integrationRecentlyHealthy } from '../lib/integration-health';
import { recomputeBlendedValues } from '../lib/market-sources';
import { recordPricingWrites } from '../lib/pricing-budget';
import { sourceEnabled } from '../lib/source-config';

/**
 * Corroborating-only eBay-sold scrape (Firecrawl or Bright Data).
 *
 * Only targets sets that ALREADY have a BrickLink (or BrickEconomy) value, and
 * only accepts a scraped median that is within 3x of that existing value. So the
 * eBay-sold figure is always cross-checked and can never become a noisy SOLE
 * source — the collision-prone long-tail failure found in Phase-0 validation
 * (e.g. Darth Maul) is structurally excluded (no BrickLink/BE -> not a candidate).
 * Writes condition-separated ebay_new_value and ebay_used_value observations so
 * the v3 blend can corroborate sealed and used values independently.
 *
 * PROVIDER: steady-state prefers Bright Data (its own budget) with a Firecrawl
 * rescue; `preferFirecrawl:true` (the fast-backfill lane) makes Firecrawl primary
 * to bypass Bright Data's ~70% eBay failure rate. ANTI-STALL: a miss stamps
 * condition-specific set_market_ext attempt markers (14-day cooldown, SQL-visible)
 * instead of a KV neg-cache the candidate query couldn't see, so neither sweep can
 * wall itself or starve the other condition.
 */
// Max sets per run when Firecrawl is the primary engine (5 concurrent × 8 waves
// at ~30s ≈ 4 min, comfortably inside the 3-hourly tick).
const FIRECRAWL_PRIMARY_MAX = 40;

export interface EbaySoldScrapeRun {
  // Index signature: the admin /jobs/:job handler hands run summaries around as
  // Record<string, unknown> before serialising them.
  [key: string]: unknown;
  processed: number;
  updated: number;
  rejected: number;
  limit: number;
  skipped?: string;
  newUpdated?: number;
  usedUpdated?: number;
  rescued?: number;
  /** Which scraper actually ran this batch. */
  engine?: 'firecrawl' | 'brightdata';
  /** Present when Bright Data was configured but routed around as unhealthy. */
  brightdata_breaker?: 'open';
}

export async function runEbaySoldScrape(
  env: Env,
  options: { limit?: number; concurrency?: number; preferFirecrawl?: boolean } = {},
): Promise<EbaySoldScrapeRun> {
  if (!(await sourceEnabled(env, 'ebay'))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'ebay disabled in source tuning' };
  }
  const canFirecrawl = firecrawlEnabled(env) && await sourceEnabled(env, 'firecrawl');
  const configuredBrightData = brightDataSoldEnabled(env) && await sourceEnabled(env, 'brightdata');
  // CIRCUIT BREAKER: Bright Data can be configured, funded and still totally
  // broken — it 502'd every call for six days while its key pool reported ~1,800
  // calls of headroom per key, so pickKey kept approving runs that wrote nothing
  // and died on the rescue path. If it has not succeeded once in 24h, stop
  // treating it as the primary and let Firecrawl carry the lane.
  const brightDataHealthy = configuredBrightData ? await integrationRecentlyHealthy(env, 'brightdata', 24) : false;
  const canBrightData = configuredBrightData && brightDataHealthy;
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
  // Breaker tripped (as opposed to "never configured") — say so in the logs and
  // the run summary so a silent provider outage reads as a routing decision.
  const brightDataTripped = configuredBrightData && !brightDataHealthy;
  if (brightDataTripped) {
    console.warn('[ebay-sold-scrape] Bright Data has not succeeded in 24h — running Firecrawl-primary.');
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
    // A Firecrawl scrape is ~20-40s against Bright Data's ~2s, so the batch size
    // tuned for Bright Data overruns the tick on this path — which is how runs
    // ended up killed before they could flush. Cap the wave count instead.
    capLimit = Math.min(limit, FIRECRAWL_PRIMARY_MAX, Math.floor(remaining / 5));
  } else {
    // Confirm a live (non-exhausted) key exists BEFORE any selection work, so a
    // fully-exhausted/broken pool doesn't debit the api_quota ledger for a run
    // that will make zero HTTP calls (which inflated the admin usage panel).
    const live = await pickKey(env);
    if (!live) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'brightdata: all keys exhausted this month' };
    capLimit = limit;
  }

  // New and used have independent success freshness and miss cooldowns. A miss
  // only stamps set_market_ext; it never stamps either blend-facing cached_at
  // column. This lets one scrape fill the much broader used market without an
  // absent condition masquerading as fresh evidence.
  const { results: candidates } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name, ls.bl_new_value, ls.used_value, ls.current_value,
      CASE WHEN (ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-30 days'))
        AND (ext.ebay_sold_attempted_at IS NULL OR ext.ebay_sold_attempted_at < datetime('now', '-14 days'))
        THEN 1 ELSE 0 END AS new_due,
      CASE WHEN (ls.ebay_used_cached_at IS NULL OR ls.ebay_used_cached_at < datetime('now', '-30 days'))
        AND (ext.ebay_used_attempted_at IS NULL OR ext.ebay_used_attempted_at < datetime('now', '-14 days'))
        THEN 1 ELSE 0 END AS used_due
    FROM lego_sets ls
    LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE (ls.bl_new_value IS NOT NULL OR ls.used_value IS NOT NULL OR ls.valuation_method = 'brickeconomy')
      AND (
        ((ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-30 days'))
          AND (ext.ebay_sold_attempted_at IS NULL OR ext.ebay_sold_attempted_at < datetime('now', '-14 days')))
        OR
        ((ls.ebay_used_cached_at IS NULL OR ls.ebay_used_cached_at < datetime('now', '-30 days'))
          AND (ext.ebay_used_attempted_at IS NULL OR ext.ebay_used_attempted_at < datetime('now', '-14 days')))
      )
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      -- HIGHEST-VALUE first: eBay sold listings exist for desirable sets; ordering by
      -- set_num front-loaded low-numbered vintage sets with no sold activity, wasting
      -- the scrape (Firecrawl credits) on guaranteed no-data misses.
      COALESCE(ls.bl_new_value, ls.current_value) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(capLimit).all<{
    set_num: string;
    name: string;
    bl_new_value: number | null;
    used_value: number | null;
    current_value: number | null;
    new_due: number;
    used_due: number;
  }>();
  if (!candidates.length) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: undefined };

  // Reserve Bright Data quota for what will ACTUALLY be scraped.
  let results = candidates;
  let effLimit = candidates.length;
  if (!useFirecrawl) {
    const plannedCalls = candidates.reduce((sum, set) => sum + Number(!!set.new_due) + Number(!!set.used_due), 0);
    let callsLeft = (await reserveQuota(env, { brightdata: plannedCalls })).brightdata ?? 0;
    if (callsLeft <= 0) return { processed: 0, updated: 0, rejected: 0, limit, skipped: 'brightdata quota spent' };
    results = [];
    for (const candidate of candidates) {
      if (callsLeft <= 0) break;
      const needed = Number(!!candidate.new_due) + Number(!!candidate.used_due);
      if (needed <= callsLeft) {
        results.push(candidate);
        callsLeft -= needed;
      } else {
        // At the edge of the daily budget, prioritize the missing used market.
        results.push({ ...candidate, new_due: candidate.used_due ? 0 : candidate.new_due, used_due: candidate.used_due ? 1 : 0 });
        callsLeft--;
      }
    }
    effLimit = results.length;
  }

  // Leave one of the Worker's six outbound connection slots free for provider
  // bookkeeping and rescue traffic. Each Bright Data set performs its condition
  // requests sequentially, so this also bounds the whole invocation to five.
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 5));
  let updated = 0;
  let newUpdated = 0;
  let usedUpdated = 0;
  let processed = 0;
  let rejected = 0;
  let rescued = 0;
  // Per-run rescue budget: each rescue adds a Firecrawl scrape (~5 credits and
  // ~20s to an already-failing wave), so cap it to keep the invocation inside
  // its window; the SQL attempt cooldown means unrescued failures retry in 14 days.
  let rescuesLeft = fcRescue ? 40 : 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  const touched: string[] = [];

  // Stamp the attempt marker on a MISS so the set drops out of the candidate query
  // for 14 days (see the query above). A SQL column — NOT ebay_new_cached_at, which
  // is success-only and feeds the blend — so absent data never looks fresh to the
  // blend while still being skipped by the scrape queue. Batched with the writes.
  const stampNewAttempt = (setNum: string) =>
    stmts.push(env.DB.prepare(
      `INSERT INTO set_market_ext (set_num, ebay_sold_attempted_at) VALUES (?1, datetime('now'))
       ON CONFLICT(set_num) DO UPDATE SET ebay_sold_attempted_at=datetime('now')`,
    ).bind(setNum));
  const stampUsedAttempt = (setNum: string) =>
    stmts.push(env.DB.prepare(
      `INSERT INTO set_market_ext (set_num, ebay_used_attempted_at) VALUES (?1, datetime('now'))
       ON CONFLICT(set_num) DO UPDATE SET ebay_used_attempted_at=datetime('now')`,
    ).bind(setNum));

  // Incremental persistence: flush accumulated writes + re-blend as we go, so a
  // dying invocation (the "stale: invocation ended" cron_runs rows) keeps every
  // completed wave instead of losing the whole run's work.
  const flush = async () => {
    if (!stmts.length && !touched.length) return;
    const s = stmts.splice(0);
    const t = touched.splice(0);
    for (let j = 0; j < s.length; j += 90) await env.DB.batch(s.slice(j, j + 90));
    await recordPricingWrites(env.DB, 'ebay-sold-scrape', s.length);
    if (t.length) await recomputeBlendedValues(env.DB, t);
  };

  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (set) => {
      const fetchOptions = { includeNew: !!set.new_due, includeUsed: !!set.used_due };
      const fetcher = useFirecrawl
        ? fetchEbaySoldViaFirecrawl(set.set_num, set.name, env, fetchOptions)
        : fetchEbaySoldViaBrightData(set.set_num, set.name, env, fetchOptions);
      const primary: EbaySoldScrapeResult = await fetcher
        .catch((e): EbaySoldScrapeResult => ({
          status: 'error',
          new_value: null,
          new_count: 0,
          used_value: null,
          used_count: 0,
          error: (e as Error)?.message,
        }));
      let r = primary;
      if ((primary.status === 'error' || primary.status === 'partial') && rescuesLeft > 0) {
        rescuesLeft--;
        const fr = await fetchEbaySoldViaFirecrawl(set.set_num, set.name, env, fetchOptions).catch(() => null);
        if (fr && (fr.status === 'ok' || fr.status === 'partial' || fr.status === 'no_data')) {
          const newValue = primary.new_value ?? fr.new_value;
          const usedValue = primary.used_value ?? fr.used_value;
          r = {
            ...primary,
            status: newValue != null || usedValue != null ? 'ok' : fr.status,
            new_value: newValue,
            new_count: primary.new_value != null ? primary.new_count : fr.new_count,
            new_last_sold: primary.new_value != null ? primary.new_last_sold : fr.new_last_sold,
            used_value: usedValue,
            used_count: primary.used_value != null ? primary.used_count : fr.used_count,
            used_last_sold: primary.used_value != null ? primary.used_last_sold : fr.used_last_sold,
            error: newValue != null || usedValue != null ? null : (fr.error ?? primary.error),
          };
        }
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

      const addAnomaly = (condition: 'new_sealed' | 'used_complete', observed: number, reference: number | null) => {
        const key = condition === 'new_sealed'
          ? `ebay_sold:${set.set_num}:value_divergence`
          : `ebay_sold_used:${set.set_num}:value_divergence`;
        stmts.push(env.DB.prepare(`
          INSERT INTO pricing_anomalies (
            anomaly_key, set_num, condition, source, anomaly_type, severity,
            detail_json, status, first_seen_at, last_seen_at
          ) VALUES (?1, ?2, ?3, 'ebay_sold', 'value_divergence', 'warning', ?4, 'open', datetime('now'), datetime('now'))
          ON CONFLICT(anomaly_key) DO UPDATE SET
            detail_json=excluded.detail_json, status='open', last_seen_at=datetime('now'), resolved_at=NULL
        `).bind(key, set.set_num, condition, JSON.stringify({ observed, reference })));
      };

      let acceptedNew: number | null = null;
      let acceptedUsed: number | null = null;
      if (set.new_due) {
        if (r.new_value != null) {
          const ref = set.bl_new_value ?? set.current_value ?? null;
          if (ref == null || (r.new_value >= ref / 3 && r.new_value <= ref * 3)) {
            acceptedNew = r.new_value;
            newUpdated++;
          } else {
            rejected++;
            stampNewAttempt(set.set_num);
            addAnomaly('new_sealed', r.new_value, ref);
          }
        } else {
          stampNewAttempt(set.set_num);
        }
      }

      if (set.used_due) {
        if (r.used_value != null) {
          const ref = set.used_value ?? set.bl_new_value ?? set.current_value ?? null;
          if (ref == null || (r.used_value >= ref / 3 && r.used_value <= ref * 3)) {
            acceptedUsed = r.used_value;
            usedUpdated++;
          } else {
            rejected++;
            stampUsedAttempt(set.set_num);
            addAnomaly('used_complete', r.used_value, ref);
          }
        } else {
          stampUsedAttempt(set.set_num);
        }
      }

      if (acceptedNew != null || acceptedUsed != null) {
        stmts.push(env.DB.prepare(`
          UPDATE lego_sets SET
            ebay_new_value=COALESCE(?1, ebay_new_value),
            ebay_new_qty=CASE WHEN ?1 IS NULL THEN ebay_new_qty ELSE ?2 END,
            ebay_new_cached_at=CASE WHEN ?1 IS NULL THEN ebay_new_cached_at ELSE datetime('now') END,
            ebay_new_last_sold=CASE WHEN ?1 IS NULL THEN ebay_new_last_sold ELSE COALESCE(?3, ebay_new_last_sold) END,
            ebay_used_value=COALESCE(?4, ebay_used_value),
            ebay_used_qty=CASE WHEN ?4 IS NULL THEN ebay_used_qty ELSE ?5 END,
            ebay_used_cached_at=CASE WHEN ?4 IS NULL THEN ebay_used_cached_at ELSE datetime('now') END,
            ebay_used_last_sold=CASE WHEN ?4 IS NULL THEN ebay_used_last_sold ELSE COALESCE(?6, ebay_used_last_sold) END
          WHERE set_num=?7
        `).bind(
          acceptedNew, r.new_count || 0, r.new_last_sold ?? null,
          acceptedUsed, r.used_count || 0, r.used_last_sold ?? null,
          set.set_num,
        ));
        touched.push(set.set_num);
        updated++;
      }
    }
    if (stmts.length >= 90) await flush();
  }

  await flush();
  // Firecrawl self-records each scrape attempt inside firecrawlScrape, so only
  // the Bright Data path (which doesn't self-record) needs the aggregate write —
  // writing it for Firecrawl too would double-count and clobber the real error.
  if (!useFirecrawl) await recordIntegrationHealth(env, 'brightdata', health);
  return {
    processed, updated, newUpdated, usedUpdated, rejected, rescued, limit: effLimit,
    engine: useFirecrawl ? 'firecrawl' : 'brightdata',
    ...(brightDataTripped ? { brightdata_breaker: 'open' } : {}),
  };
}
