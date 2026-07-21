import type { Env } from '../types';
import { fetchStockXMarket, fetchStockXViaFirecrawl } from '../lib/stockx';
import { pickKey } from '../lib/brightdata-keys';
import { firecrawlEnabled, stockxEnabled } from '../lib/pricing-flags';
import { quotaRemaining, reserveQuota } from '../lib/api-quota';
import { recordIntegrationHealth } from '../lib/integration-health';
import { sourceEnabled } from '../lib/source-config';
import { pricingWritesAllowed } from '../lib/pricing-budget';

/**
 * StockX lowest-ask enrichment (Firecrawl-preferred, Bright Data fallback).
 *
 * Populates set_market_ext.stockx_ask for sets that ALREADY have a BrickLink/
 * BrickEconomy value, accepting the scraped ask only when it's within 3x of that
 * existing value — so a wrong-item StockX match can never land as a lone source.
 * OFF by default (stockxEnabled): a slow, fragile scrape that must be validated
 * before it feeds anything. Currently COLLECT-ONLY — stockx_ask is stored for
 * review and is NOT yet wired into the blend (a deliberate follow-up once the data
 * proves out).
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

  // Candidates: sets with a corroborating value and a stale/absent StockX ask.
  // Owned/wishlist first, then oldest cache. Over-select 2x for the neg-cache drop.
  const { results: candidates } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name, ls.bl_new_value, ls.current_value
    FROM lego_sets ls
    LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE COALESCE(ls.bl_new_value, ls.current_value) IS NOT NULL
      -- StockX only lists collectible/sealed sets (mostly retired, higher value),
      -- so target those and skip the long tail of cheap current sets it won't
      -- carry — keeps the limited Bright Data budget on sets that can return data.
      AND (ls.retired = 1 OR COALESCE(ls.bl_new_value, ls.current_value) >= 150)
      AND (ext.stockx_cached_at IS NULL OR ext.stockx_cached_at < datetime('now', '-30 days'))
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ext.stockx_cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(capLimit * 2).all<{ set_num: string; name: string; bl_new_value: number | null; current_value: number | null }>();

  const kv = env.CACHE_KV;
  const skipKey = (setNum: string) => `stockx:skip:${setNum}`;
  const filtered: typeof candidates = [];
  for (let i = 0; i < candidates.length && filtered.length < capLimit; i += 20) {
    const wave = candidates.slice(i, i + 20);
    const skips = kv ? await Promise.all(wave.map((s) => kv.get(skipKey(s.set_num)).catch(() => null))) : wave.map(() => null);
    for (let j = 0; j < wave.length && filtered.length < capLimit; j++) if (!skips[j]) filtered.push(wave[j]);
  }
  if (!filtered.length) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: candidates.length ? 'all candidates negative-cached' : undefined };

  // Firecrawl self-meters its credits per scrape, so nothing to reserve here — only
  // the Bright Data path books the stockx ledger for what will actually be scraped.
  let results = filtered;
  let effLimit = filtered.length;
  if (!useFirecrawl) {
    effLimit = (await reserveQuota(env, { stockx: filtered.length })).stockx ?? 0;
    if (effLimit <= 0) return { processed: 0, updated: 0, rejected: 0, limit, skipped: 'stockx quota spent' };
    results = filtered.slice(0, effLimit);
  }

  const negCache = (setNum: string, reason: 'no_data' | 'diverged' | 'err') =>
    kv?.put(skipKey(setNum), reason, { expirationTtl: (reason === 'err' ? 2 : 14) * 86_400 }).catch(() => {});

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 5));
  let processed = 0;
  let updated = 0;
  let rejected = 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  const flush = async () => {
    const s = stmts.splice(0);
    for (let j = 0; j < s.length; j += 90) await env.DB.batch(s.slice(j, j + 90));
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

      if (r.status === 'no_data') { await negCache(set.set_num, 'no_data'); continue; }
      if (r.status !== 'ok' || r.ask == null) { await negCache(set.set_num, 'err'); continue; }

      // Corroboration gate: accept only within 3x of the existing value.
      const ref = set.bl_new_value ?? set.current_value ?? null;
      const ok = ref == null ? true : (r.ask >= ref / 3 && r.ask <= ref * 3);
      if (ok) {
        stmts.push(env.DB.prepare(
          `INSERT INTO set_market_ext (set_num, stockx_ask, stockx_cached_at)
           VALUES (?1, ?2, datetime('now'))
           ON CONFLICT(set_num) DO UPDATE SET stockx_ask=excluded.stockx_ask, stockx_cached_at=datetime('now')`,
        ).bind(set.set_num, r.ask));
        updated++;
      } else {
        rejected++;
        await negCache(set.set_num, 'diverged');
      }
    }
    if (stmts.length >= 90) await flush();
  }
  await flush();
  await recordIntegrationHealth(env, 'stockx', health);
  return { processed, updated, rejected, limit: effLimit };
}
