import type { Env } from '../types';
import { fetchStockXMarket, fetchStockXViaFirecrawl } from '../lib/stockx';
import { pickKey } from '../lib/brightdata-keys';
import { firecrawlEnabled, stockxEnabled } from '../lib/pricing-flags';
import { quotaRemaining, reserveQuota } from '../lib/api-quota';
import { recordIntegrationHealth } from '../lib/integration-health';
import { sourceEnabled } from '../lib/source-config';
import { pricingWritesAllowed } from '../lib/pricing-budget';
import { recomputeBlendedValues } from '../lib/market-sources';

/**
 * StockX lowest-ask enrichment (Firecrawl-preferred, Bright Data fallback).
 *
 * Populates set_market_ext.stockx_ask for sets that ALREADY have a BrickLink/
 * BrickEconomy value, accepting the scraped ask only when it's within 3x of that
 * existing value — so a wrong-item StockX match can never land as a lone source.
 * OFF by default (stockxEnabled): a slow, fragile scrape validated before it fed
 * anything. stockx_ask is wired into the v3 blend as a corroborating new-sealed
 * ASKING signal (its own 'stockx' provider family) — with any sold family it only
 * nudges the range/confidence, never the sold headline; a lone StockX ask reads as
 * asking_only. On a new ask this job re-blends the touched set so it folds in.
 *
 * PROVIDER: prefers Firecrawl (enhanced proxy, ~5 credits/call) — its large credit
 * pool scales to a bulk backfill that Bright Data's small daily budget can't. Falls
 * back to Bright Data Web Unlocker only when no Firecrawl key is configured.
 * Bounded, negative-cached, health-recorded; never throws. Runs only from the
 * background cron — never a synchronous request.
 */
export async function runStockXEnrich(
  env: Env,
  options: { limit?: number; concurrency?: number } = {},
): Promise<{ processed: number; updated: number; rejected: number; limit: number; skipped?: string }> {
  if (!stockxEnabled(env)) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'StockX disabled (STOCKX_ENABLED=1 or the stockx flag to enable)' };
  }
  if (!(await sourceEnabled(env, 'stockx'))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'StockX disabled in source tuning' };
  }
  if (!(await pricingWritesAllowed(env.DB))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'D1 pricing write budget paused non-critical jobs' };
  }
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 60) : 20;

  // Prefer Firecrawl: its large credit pool scales past Bright Data's small daily
  // budget, making it the only viable engine for a bulk backfill. Fall back to
  // Bright Data only when no Firecrawl key reached the Worker.
  const useFirecrawl = firecrawlEnabled(env) && await sourceEnabled(env, 'firecrawl');

  // Budget sizing differs by engine:
  //  • Firecrawl self-meters credits inside firecrawlScrape (5cr/enhanced call), so
  //    size to remaining daily credits WITHOUT reserving here — a double reservation
  //    would make the admin Firecrawl credits panel over-report.
  //  • Bright Data has no in-scrape meter; confirm a live key exists first (so an
  //    exhausted pool never debits the stockx ledger), then reserve below.
  let capLimit: number;
  if (useFirecrawl) {
    const remaining = await quotaRemaining(env, 'firecrawl');
    if (remaining < 5) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'firecrawl daily ceiling reached' };
    capLimit = Math.min(limit, Math.floor(remaining / 5));
  } else {
    const live = await pickKey(env);
    if (!live) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'brightdata: all keys exhausted this month' };
    const remaining = await quotaRemaining(env, 'stockx');
    if (remaining <= 0) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'stockx daily cap reached' };
    capLimit = Math.min(limit, remaining);
  }

  // Candidates: modern, DESIRABLE sets with a corroborating value and a stale/
  // absent StockX ask. StockX's LEGO market is recent-era and only carries sets
  // worth chasing, so require year>=2000 and value>=$150 and work HIGHEST-VALUE
  // first. (The old ordering by set_num ASC front-loaded 1970s-90s promo junk —
  // Gears, minifig packs, "Special Offer" — that StockX has never listed, burning
  // an entire batch on guaranteed no-data misses.) Owned/wishlist first, then value.
  //
  // Skip logic is the stockx_cached_at stamp ALONE (written on every outcome below,
  // ask or no ask). That column feeds ONLY this job's freshness gate, never the
  // blend, so stamping absent data is safe — and it's the whole skip mechanism:
  // a stamped set drops out of this query for 30 days. An earlier KV neg-cache was
  // removed because it created a wall the SQL couldn't see past — sets neg-cached
  // but not yet stamped kept sorting to the top (never-cached = '2000-01-01') and
  // no over-select was reliably large enough to reach fresh candidates behind them.
  const { results: candidates } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name, ls.bl_new_value, ls.current_value
    FROM lego_sets ls
    LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE COALESCE(ls.bl_new_value, ls.current_value) >= 150
      AND ls.year >= 2000
      AND (ext.stockx_cached_at IS NULL OR ext.stockx_cached_at < datetime('now', '-30 days'))
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.bl_new_value, ls.current_value) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(capLimit).all<{ set_num: string; name: string; bl_new_value: number | null; current_value: number | null }>();
  if (!candidates.length) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: undefined };

  // Firecrawl self-meters its credits per scrape, so nothing to reserve here — only
  // the Bright Data path books the stockx ledger for what will actually be scraped.
  let results = candidates;
  let effLimit = candidates.length;
  if (!useFirecrawl) {
    effLimit = (await reserveQuota(env, { stockx: candidates.length })).stockx ?? 0;
    if (effLimit <= 0) return { processed: 0, updated: 0, rejected: 0, limit, skipped: 'stockx quota spent' };
    results = candidates.slice(0, effLimit);
  }

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 8));
  let processed = 0;
  let updated = 0;
  let rejected = 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  const touched: string[] = []; // sets that got a new ask → re-blend so it folds in
  const flush = async () => {
    const s = stmts.splice(0);
    const t = touched.splice(0);
    for (let j = 0; j < s.length; j += 90) await env.DB.batch(s.slice(j, j + 90));
    // StockX ask is a corroborating asking signal in the v3 blend; re-blend the
    // touched sets so the newly stored ask is reflected (it can only nudge the
    // range/confidence when a sold family exists, never move the sold headline).
    if (t.length) await recomputeBlendedValues(env.DB, t);
  };

  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (set) => ({
      set,
      r: await (useFirecrawl ? fetchStockXViaFirecrawl(set.set_num, set.name, env) : fetchStockXMarket(set.set_num, set.name, env))
        .catch((e) => ({ status: 'error' as const, ask: null, url: null, error: (e as Error)?.message })),
    })));
    for (const { set, r } of outs) {
      processed++;
      if (r.status === 'ok' || r.status === 'no_data') health.ok++;
      else { health.fail++; if (r.error) health.lastError = r.error; }

      // Stamp stockx_cached_at (ask left NULL) on every miss — no_data, provider
      // error, OR a diverged wrong-item match — so the set drops out of the query
      // for 30 days. Stamping errors too (vs retrying) is deliberate: it keeps a
      // one-time bulk sweep bounded and terminating; the daily cron re-checks after
      // 30 days. The ask INSERT below stamps cached_at on a hit the same way.
      const stampMiss = () =>
        stmts.push(env.DB.prepare(
          `INSERT INTO set_market_ext (set_num, stockx_cached_at) VALUES (?1, datetime('now'))
           ON CONFLICT(set_num) DO UPDATE SET stockx_cached_at=datetime('now')`,
        ).bind(set.set_num));

      if (r.status !== 'ok' || r.ask == null) { stampMiss(); continue; }

      // Corroboration gate: accept only within 3x of the existing value.
      const ref = set.bl_new_value ?? set.current_value ?? null;
      const ok = ref == null ? true : (r.ask >= ref / 3 && r.ask <= ref * 3);
      if (ok) {
        stmts.push(env.DB.prepare(
          `INSERT INTO set_market_ext (set_num, stockx_ask, stockx_cached_at)
           VALUES (?1, ?2, datetime('now'))
           ON CONFLICT(set_num) DO UPDATE SET stockx_ask=excluded.stockx_ask, stockx_cached_at=datetime('now')`,
        ).bind(set.set_num, r.ask));
        touched.push(set.set_num);
        updated++;
      } else {
        // Wrong-item match — stamp it too (re-scraping yields the same bad match).
        rejected++;
        stampMiss();
      }
    }
    // Flush every wave (not just at ≥90) so a long backfill run that gets cut
    // short by the invocation window still persists all completed waves.
    await flush();
  }
  await flush();
  await recordIntegrationHealth(env, 'stockx', health);
  return { processed, updated, rejected, limit: effLimit };
}
