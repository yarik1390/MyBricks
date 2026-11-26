import type { Env } from '../types';
import { buildEbayAskUpdate, fetchEbayActiveListings } from '../lib/ebay';
import { persistBlendedValue } from '../lib/market-sources';

// Context shape used by the detail refresh — typed by what we actually touch
// (env + waitUntil) rather than importing Hono's full Context.
type RefreshCtx = {
  env: Env;
  executionCtx: { waitUntil(p: Promise<unknown>): void };
};

// On-demand background top-up for the set-detail page: refresh a stale eBay
// ask when the set's stored valuation has expired, persisted via waitUntil so
// the detail response is never blocked.
//
// BrickLink is deliberately NOT called from here (2026-11-26). This route
// serves guests and the public /s/:set pages that search engines crawl from
// the sitemap, and ~22k of ~29k sets have an expired valuation, so every
// uncached view of a stale set fired two BrickLink calls (each with retries)
// that no budget counted. Sets with no BrickLink sales were never stamped, so
// the next view fired them again. That pushed the account past BrickLink's
// daily limit and BrickLink blocked the Store API. The valuation crons own
// BrickLink, inside the call ledger (lib/api-quota.ts); the signed-in
// "Revalue" button is the only on-demand BrickLink path, and it is metered.
export function scheduleSetDetailRefresh(c: RefreshCtx, activeSet: Record<string, unknown>): void {
  const isBulk = (activeSet.valuation_method === 'formula_bulk');
  const askStale = !activeSet.ebay_ask_cached_at
    || Date.now() - new Date(activeSet.ebay_ask_cached_at as string).getTime() > 7 * 24 * 3600 * 1000;
  const needsRefresh = isBulk
    || !activeSet.valuation_expires_at
    || new Date(activeSet.valuation_expires_at as string) < new Date();
  if (!needsRefresh || !askStale) return;

  const setNum = activeSet.set_num as string;
  const refreshPromise = fetchEbayActiveListings(setNum, activeSet.name as string, c.env, { upc: activeSet.upc as string | null })
    .catch(() => null)
    .then(async (askListings) => {
      const askStmt = buildEbayAskUpdate(c.env.DB, setNum, askListings);
      if (!askStmt) return;
      await askStmt.run();
      await persistBlendedValue(c.env.DB, setNum);
    })
    .catch(err => console.error('[bg-ask-refresh] failed:', err));
  c.executionCtx.waitUntil(refreshPromise);
}
