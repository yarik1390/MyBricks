import type { Env } from '../types';
import { ebaySoldCompsEnabled } from '../lib/pricing-flags';
import {
  buildEbayAskUpdate,
  buildEbaySoldUpdate,
  ebaySoldHasValue,
  fetchEbayActiveListings,
  fetchEbaySoldPrices,
  isEbayAccessError,
} from '../lib/ebay';
import { reserveQuota } from '../lib/api-quota';
import { recomputeBlendedValues } from '../lib/market-sources';
import { isIntegrationBlocked, recordIntegrationHealth, setIntegrationBlock } from '../lib/integration-health';
import { sourceEnabled } from '../lib/source-config';

export async function runEbayBackfill(env: Env, options: { limit?: number } = {}) {
  if (!(await sourceEnabled(env, 'ebay'))) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'ebay disabled in source tuning' };
  }
  // eBay sold comps are disabled unless EBAY_SOLD_COMPS_ENABLED is set.
  if (!ebaySoldCompsEnabled(env)) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'ebay sold comps disabled' };
  }
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 2)
    : 1;
  // Circuit breaker: skip the whole backfill while a previous access-denied
  // block is still active.
  if (await isIntegrationBlocked(env, 'ebay')) {
    return { processed: 0, updated: 0, limit, skipped: 'ebay access blocked' };
  }
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name
    FROM lego_sets ls
    WHERE (
      (ls.ebay_new_value IS NULL AND (ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-7 days')))
      OR (ls.ebay_used_value IS NULL AND (ls.ebay_used_cached_at IS NULL OR ls.ebay_used_cached_at < datetime('now', '-7 days')))
    )
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc
        WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw
        WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.ebay_new_cached_at, '2000-01-01') ASC,
      COALESCE(ls.ebay_used_cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string }>();

  // Account the eBay spend in the daily ledger (advisory at backfill sizes).
  await reserveQuota(env, { ebay: results.length });

  let updated = 0;
  let processed = 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  for (const set of results) {
    processed++;
    const prices = await fetchEbaySoldPrices(set.set_num, set.name, env, { recordHealth: false })
      .catch((err) => {
        health.fail++;
        health.lastError = (err as Error)?.message || String(err);
        return null;
      });
    if (prices?.status === 'error' || prices?.status === 'unauthorized') {
      health.fail++;
      health.lastError = prices.error || prices.status;
    } else if (prices?.status && prices.status !== 'unconfigured') {
      health.ok++;
    }
    const stmt = buildEbaySoldUpdate(env.DB, set.set_num, prices);
    if (stmt) {
      await stmt.run();
      if (ebaySoldHasValue(prices)) updated++;
    }
    if (prices?.status === 'unauthorized' || isEbayAccessError(prices?.error)) {
      await setIntegrationBlock(env, 'ebay', 6);
      break;
    }
  }

  await recordIntegrationHealth(env, 'ebay', health);

  return { processed, updated, limit };
}

// Browse-API ASK backfill: refresh the eBay active-listing ask price + count for
// sets whose ask is missing/stale, prioritized owned/wishlist then retired (where
// secondary-market value lives) then oldest. Basic OAuth scope only — fully
// independent of the disabled sold-comps path — so it grows the free ask signal
// that feeds the blended value. Bounded by `limit`; the eBay daily quota is wide
// open. Fails open per set and honors a Browse access denial by stopping early.
export async function runEbayAskBackfill(env: Env, options: { limit?: number } = {}) {
  if (!(await sourceEnabled(env, 'ebay'))) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'ebay disabled in source tuning' };
  }
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 40;
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name
    FROM lego_sets ls
    WHERE ls.ebay_ask_cached_at IS NULL OR ls.ebay_ask_cached_at < datetime('now', '-14 days')
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.retired, 0) DESC,
      COALESCE(ls.ebay_ask_cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string }>();
  if (!results.length) return { processed: 0, updated: 0, limit };

  // Advisory ledger entry (eBay budget is far above any ask batch).
  await reserveQuota(env, { ebay: results.length });

  let updated = 0;
  let processed = 0;
  let browseDenied = false;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  for (const set of results) {
    if (browseDenied) break;
    processed++;
    const listings = await fetchEbayActiveListings(set.set_num, set.name, env, { recordHealth: false })
      .catch((err) => { health.fail++; health.lastError = (err as Error)?.message || String(err); return null; });
    if (listings && !listings.error) {
      health.ok++;
      const stmt = buildEbayAskUpdate(env.DB, set.set_num, listings);
      if (stmt) { stmts.push(stmt); if (listings.ask_value != null) updated++; }
    } else if (listings?.error) {
      health.fail++;
      health.lastError = listings.error;
      if (isEbayAccessError(listings.error)) browseDenied = true;
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  await recordIntegrationHealth(env, 'ebay', health);
  // Refresh the persisted blend so newly-collected ask prices feed blended_value.
  await recomputeBlendedValues(env.DB, results.map(r => r.set_num));

  return { processed, updated, limit };
}
