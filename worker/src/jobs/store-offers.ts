import type { Env } from '../types';
import { firecrawlScrape, FirecrawlRateLimitedError } from '../lib/firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { sourceEnabled } from '../lib/source-config';
import { quotaRemaining, spendQuota } from '../lib/api-quota';
import { recomputeBlendedValues } from '../lib/market-sources';
import {
  STORES, STORE_EXTRACT_SCHEMA, STORE_OFFER_MAX_AGE_DAYS,
  pickOffer, storeExtractPrompt, storeSearchUrl, syncBestStoreOffer,
  type ExtractedProduct,
} from '../lib/store-offers';

/**
 * Refresh Walmart and Target prices for the sets people care about: current
 * (not retired) sets that someone wishlisted or owns, oldest check first, then
 * retiring-soon sets. Each store lookup is one Firecrawl structured extraction
 * of the store's search page (5 credits), metered by the 'stores' quota.
 *
 * Also clears live-offer data older than STORE_OFFER_MAX_AGE_DAYS, so an offer
 * that is no longer re-checked stops driving deal calls and alerts.
 */
export async function runStoreOffers(
  env: Env,
  options: { limit?: number } = {},
): Promise<{ processed: number; found: number; cleared: number; skipped?: string }> {
  const stale = await clearStaleOffers(env.DB);
  const cleared = stale.length;
  if (stale.length) await recomputeBlendedValues(env.DB, stale).catch(() => 0);
  if (!firecrawlEnabled(env) || !(await sourceEnabled(env, 'firecrawl'))) {
    return { processed: 0, found: 0, cleared, skipped: 'Firecrawl disabled' };
  }
  const remaining = await quotaRemaining(env, 'stores');
  const limit = Math.min(Math.max(1, Math.floor(Number(options.limit) || 20)), Math.floor(remaining / STORES.length));
  if (limit <= 0) return { processed: 0, found: 0, cleared, skipped: 'daily store cap reached' };

  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, COALESCE(NULLIF(ls.retail_price, 0), ls.brickset_msrp) AS msrp,
           (SELECT MIN(checked_at) FROM store_offers o WHERE o.set_num = ls.set_num) AS last_checked
      FROM lego_sets ls
     WHERE COALESCE(ls.retired, 0) = 0 AND ls.year >= CAST(strftime('%Y', 'now') AS INTEGER) - 3
       AND (ls.set_num IN (SELECT set_num FROM user_wishlist)
            OR ls.set_num IN (SELECT set_num FROM user_collection WHERE deleted_at IS NULL)
            OR ls.lego_retiring_soon = 1)
     ORDER BY CASE WHEN last_checked IS NULL THEN 0 ELSE 1 END, last_checked ASC,
              CASE WHEN ls.set_num IN (SELECT set_num FROM user_wishlist) THEN 0 ELSE 1 END, ls.set_num
     LIMIT ?
  `).bind(limit).all<{ set_num: string; msrp: number | null; last_checked: string | null }>();

  let processed = 0;
  let found = 0;
  const touched: string[] = [];
  for (const set of results || []) {
    if (set.last_checked && Date.parse(`${set.last_checked.replace(' ', 'T')}Z`) > Date.now() - 20 * 3600_000) continue;
    const r = await checkSetStores(env, set.set_num, set.msrp);
    processed += r.processed;
    found += r.found;
    if (r.processed) touched.push(set.set_num);
    if (r.stopped) break;
  }
  // Refresh the persisted deal call (catalog "deals" filter, deal alerts).
  if (touched.length) await recomputeBlendedValues(env.DB, touched).catch(() => 0);
  return { processed, found, cleared };
}

/**
 * Look the set up at every store (in parallel, one quota unit and one Firecrawl
 * extraction each) and store what was found: a price, or "checked, not listed".
 * A provider failure keeps the previous row. `stopped` means the daily cap or a
 * Firecrawl rate limit cut the check short.
 */
export async function checkSetStores(
  env: Env,
  setNum: string,
  msrp: number | null,
): Promise<{ processed: number; found: number; stopped: boolean }> {
  let stopped = false;
  const lookups = await Promise.all(STORES.map(async (store) => {
    if (!(await spendQuota(env, 'stores', 1))) { stopped = true; return null; }
    try {
      const res = await firecrawlScrape<{ products?: ExtractedProduct[] }>({
        url: storeSearchUrl(store, setNum),
        formats: ['json'],
        jsonOptions: { schema: STORE_EXTRACT_SCHEMA, prompt: storeExtractPrompt(setNum) },
        waitFor: 2000,
        timeoutMs: 30_000,
        throwOnRateLimit: true,
      }, env);
      return { store, products: res ? (res.data?.products ?? []) : null };
    } catch (err) {
      if (err instanceof FirecrawlRateLimitedError) stopped = true;
      return { store, products: null };
    }
  }));
  let processed = 0;
  let found = 0;
  for (const l of lookups) {
    if (!l) continue;
    processed++;
    if (l.products == null) continue; // provider failure: keep the previous row
    const offer = pickOffer(l.products, setNum, msrp);
    if (offer) {
      found++;
      await env.DB.prepare(
        `INSERT INTO store_offers (set_num, store, price, in_stock, url, title, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(set_num, store) DO UPDATE SET price = excluded.price, in_stock = excluded.in_stock,
           url = excluded.url, title = excluded.title, checked_at = excluded.checked_at`,
      ).bind(setNum, l.store, offer.price, offer.in_stock ? 1 : 0, offer.url, offer.title).run();
    } else {
      // Checked and not listed: record it so the set isn't re-checked tomorrow
      // and a previous price can't linger as if it were current.
      await env.DB.prepare(
        `INSERT INTO store_offers (set_num, store, price, in_stock, url, title, checked_at)
         VALUES (?, ?, NULL, 0, NULL, NULL, datetime('now'))
         ON CONFLICT(set_num, store) DO UPDATE SET price = NULL, in_stock = 0, url = NULL, title = NULL,
           checked_at = excluded.checked_at`,
      ).bind(setNum, l.store).run();
    }
  }
  if (processed) await syncBestStoreOffer(env.DB, setNum);
  return { processed, found, stopped };
}

async function clearStaleOffers(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    `UPDATE set_market_ext SET pa_lowest_offer = NULL, pa_in_stock = NULL, pa_best_merchant = NULL, pa_offer_count = NULL
      WHERE pa_lowest_offer IS NOT NULL AND (pa_cached_at IS NULL OR pa_cached_at < datetime('now', ?))
      RETURNING set_num`,
  ).bind(`-${STORE_OFFER_MAX_AGE_DAYS} days`).all<{ set_num: string }>().catch(() => ({ results: [] as { set_num: string }[] }));
  return (results || []).map((r) => r.set_num);
}
