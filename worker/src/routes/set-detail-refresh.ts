import type { Env } from '../types';
import { fetchSetPricing, fetchUsedPricing } from '../lib/bricklink';
import { buildEbayAskUpdate, fetchEbayActiveListings } from '../lib/ebay';
import { beDetailsFromRow } from '../lib/brickeconomy-stored';
import { independentRetailAnchor, isPlausibleMarketValue, plausibleAskValue } from '../lib/valuation';
import { persistBlendedValue } from '../lib/market-sources';

// Context shape used by the detail refresh — typed by what we actually touch
// (env + waitUntil) rather than importing Hono's full Context.
type RefreshCtx = {
  env: Env;
  executionCtx: { waitUntil(p: Promise<unknown>): void };
};

// On-demand background price refresh for the set-detail page. When a set's stored
// valuation is stale/missing, fan out to the configured providers (BrickEconomy
// stored value + BrickLink live, or BrickLink-primary) plus a stale eBay ask, and
// persist via c.executionCtx.waitUntil so the detail response is never blocked.
// Nothing runs without a BrickLink key or unless the set actually needs a refresh.
export function scheduleSetDetailRefresh(c: RefreshCtx, activeSet: Record<string, unknown>): void {
    const isBulk = (activeSet.valuation_method === 'formula_bulk');
    const askStale = !activeSet.ebay_ask_cached_at
      || Date.now() - new Date(activeSet.ebay_ask_cached_at as string).getTime() > 7 * 24 * 3600 * 1000;
    const needsRefresh = isBulk
      || !activeSet.valuation_expires_at
      || new Date(activeSet.valuation_expires_at as string) < new Date();

    if (needsRefresh) {
      // BrickEconomy values come from the stored be_* columns — never fetched.
      const be = beDetailsFromRow(activeSet);
      if (be?.current_value_new != null && c.env.BRICKLINK_CONSUMER_KEY) {
        // A plausible stored BE value wins; BrickLink + eBay ask still refresh live
        // for the price strip + cross-validation. When there's no stored BE
        // value the BrickLink-primary branch below handles the set instead.
        const refreshPromise = Promise.all([
          fetchSetPricing(activeSet.set_num as string, c.env).catch(() => null),
          fetchUsedPricing(activeSet.set_num as string, c.env).catch(() => null),
          askStale ? fetchEbayActiveListings(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null) : Promise.resolve(null),
        ]).then(async ([blp, u, askListings]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          const askStmt = buildEbayAskUpdate(c.env.DB, activeSet.set_num as string, askListings);
          if (askStmt) supplementStmts.push(askStmt);

          if (be && be.current_value_new !== null
              && isPlausibleMarketValue(be.current_value_new, { retailPrice: independentRetailAnchor(activeSet), pieces: activeSet.pieces as number, corroborators: [plausibleAskValue(activeSet), blp?.current_value, activeSet.bl_new_value as number] })) {
            const defaultYr = activeSet.retired ? 0.15 : 0.10;
            const yr = (be.rolling_growth_12months != null)
              ? Math.min(0.25, Math.max(0.02, be.rolling_growth_12months / 100))
              : defaultYr;
            const forecast_2y = be.forecast_value_new_2_years ?? Math.round(be.current_value_new * Math.pow(1 + yr, 2) * 100) / 100;
            // Stored 5-year forecast when present, else a growth-rate estimate.
            const forecast_5y = be.forecast_value_new_5_years ?? Math.round(be.current_value_new * Math.pow(1 + yr, 5) * 100) / 100;

            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, used_value=COALESCE(?, ?, used_value),
                bl_new_value=COALESCE(?, bl_new_value),
                bl_new_qty=COALESCE(?, bl_new_qty),
                bl_used_qty=COALESCE(?, bl_used_qty),
                bl_cached_at=CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE bl_cached_at END,
                retail_price=CASE WHEN LOWER(COALESCE(subtheme, '')) = 'magazine gift' THEN retail_price ELSE COALESCE(?, retail_price) END,
                forecast_2y=?, forecast_5y=?,
                valuation_method='brickeconomy',
                valuation_expires_at=datetime('now', '+1 day'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(
              be.current_value_new,
              u?.used_value ?? null, be.current_value_used,
              blp?.current_value ?? null,
              blp?.lot_count ?? null,
              u?.lot_count ?? null,
              blp?.current_value ?? u?.used_value ?? null,
              be.retail_price_us,
              forecast_2y, forecast_5y,
              activeSet.set_num
            ));
          } else {
            // Stored BE value implausible — persist BrickLink data regardless.
            if (blp?.current_value) {
              supplementStmts.push(c.env.DB.prepare(
                `UPDATE lego_sets SET bl_new_value=?, bl_new_qty=COALESCE(?, bl_new_qty), bl_cached_at=datetime('now') WHERE set_num=?`
              ).bind(blp.current_value, blp.lot_count ?? null, activeSet.set_num));
            }
            if (u?.used_value) {
              supplementStmts.push(c.env.DB.prepare(
                `UPDATE lego_sets SET used_value=?, bl_used_qty=COALESCE(?, bl_used_qty), bl_cached_at=datetime('now') WHERE set_num=?`
              ).bind(u.used_value, u.lot_count ?? null, activeSet.set_num));
            }
          }

          if (supplementStmts.length) await c.env.DB.batch(supplementStmts);
          await persistBlendedValue(c.env.DB, activeSet.set_num as string);
        }).catch(err => console.error('[bg-brickeconomy-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      } else if (c.env.BRICKLINK_CONSUMER_KEY) {
        const refreshPromise = Promise.all([
          fetchSetPricing(activeSet.set_num as string, c.env).catch(() => null),
          fetchUsedPricing(activeSet.set_num as string, c.env).catch(() => null),
          askStale ? fetchEbayActiveListings(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null) : Promise.resolve(null),
        ]).then(async ([p, u, askListings]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          const askStmt = buildEbayAskUpdate(c.env.DB, activeSet.set_num as string, askListings);
          if (askStmt) supplementStmts.push(askStmt);
          if (u) {
            supplementStmts.push(c.env.DB.prepare(`UPDATE lego_sets SET used_value=?, bl_used_qty=COALESCE(?, bl_used_qty), bl_cached_at=datetime('now') WHERE set_num=?`).bind(u.used_value, u.lot_count ?? null, activeSet.set_num));
          }
          if (p) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(p.current_value * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(p.current_value * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, bl_new_value=?, bl_new_qty=?, bl_cached_at=datetime('now'),
                forecast_2y=?, forecast_5y=?,
                valuation_method='market',
                valuation_expires_at=datetime('now', '+1 day'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(p.current_value, p.current_value, p.lot_count, forecast_2y, forecast_5y, activeSet.set_num));
          }
          if (supplementStmts.length) {
            await c.env.DB.batch(supplementStmts);
          }
          await persistBlendedValue(c.env.DB, activeSet.set_num as string);
        }).catch(err => console.error('[bg-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      }
    }
}
