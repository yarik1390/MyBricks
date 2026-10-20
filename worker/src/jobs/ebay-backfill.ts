import type { Env } from '../types';
import {
  buildEbayAskUpdate,
  fetchEbayActiveListings,
  isEbayAccessError,
} from '../lib/ebay';
import { reserveQuota } from '../lib/api-quota';
import { recomputeBlendedValues } from '../lib/market-sources';
import { recordIntegrationHealth } from '../lib/integration-health';
import { sourceEnabled } from '../lib/source-config';

// Browse-API ASK backfill: refresh the eBay active-listing ask price + count for
// sets whose ask is missing/stale, prioritized owned/wishlist then retired (where
// secondary-market value lives) then oldest. Basic OAuth scope only, so it
// grows the free ask signal that feeds the blended value. Bounded by `limit`;
// the eBay daily quota is wide open. Fails open per set and honors a Browse access denial by stopping early.
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

  // Browse performs one provider call per set. Respect the exact grant so a
  // ledger outage/exhaustion makes zero calls and a partial grant is a hard cap.
  const grants = await reserveQuota(env, { ebay: results.length });
  const grantedResults = results.slice(0, Math.min(results.length, grants.ebay ?? 0));

  let updated = 0;
  let processed = 0;
  let browseDenied = false;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  for (const set of grantedResults) {
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
  await recomputeBlendedValues(env.DB, grantedResults.map(r => r.set_num));

  return { processed, updated, limit };
}
