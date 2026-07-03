import type { Env } from '../types';
import { fetchSetPricing, fetchUsedPricing } from '../lib/bricklink';
import {
  buildEbayAskUpdate,
  buildEbaySoldUpdate,
  ebaySoldNewValue,
  fetchEbayActiveListings,
  fetchEbaySoldPrices,
  type EbaySoldPrices,
} from '../lib/ebay';
import { beDetailsFromRow } from '../lib/brickeconomy-firecrawl';
import { isPlausibleMarketValue } from '../lib/valuation';
import { persistBlendedValue } from '../lib/market-sources';
import { callGeminiValuation } from '../lib/gemini';

// Context shape used by the detail refresh — typed by what we actually touch
// (env + request header + waitUntil) rather than importing Hono's full Context.
type RefreshCtx = {
  req: { header(name: string): string | undefined };
  env: Env;
  executionCtx: { waitUntil(p: Promise<unknown>): void };
};

// Collapse an eBay sold-price result into a supplement UPDATE statement. Shared by
// the set-detail on-demand refresh and the POST /:setnum/revalue handler.
export function pushEbaySoldUpdate(
  stmts: D1PreparedStatement[],
  db: D1Database,
  setNum: string,
  prices: EbaySoldPrices | null | undefined,
) {
  const stmt = buildEbaySoldUpdate(db, setNum, prices);
  if (stmt) stmts.push(stmt);
}

// On-demand background price refresh for the set-detail page. When a set's stored
// valuation is stale/missing, fan out to the configured providers (BrickEconomy
// stored value + BrickLink live, or BrickLink-primary, or a BYOK-Gemini estimate,
// or eBay-sold only) and persist via c.executionCtx.waitUntil so the detail
// response is never blocked. Fully gated: no BrickLink key + no Gemini key => the
// eBay-sold-only branch; nothing runs unless the set actually needs a refresh.
export function scheduleSetDetailRefresh(c: RefreshCtx, activeSet: Record<string, unknown>): void {
    const geminiKey = c.req.header('X-Gemini-Key');
    const isBulk = (activeSet.valuation_method === 'formula_bulk');
    const missingEbaySoldComps =
      (!activeSet.ebay_new_value && !activeSet.ebay_new_cached_at)
      || (!activeSet.ebay_used_value && !activeSet.ebay_used_cached_at);
    const askStale = !activeSet.ebay_ask_cached_at
      || Date.now() - new Date(activeSet.ebay_ask_cached_at as string).getTime() > 7 * 24 * 3600 * 1000;
    const needsRefresh = isBulk
      || !activeSet.valuation_expires_at
      || new Date(activeSet.valuation_expires_at as string) < new Date()
      || missingEbaySoldComps;

    if (needsRefresh) {
      // BrickEconomy values come from the stored be_* columns (Firecrawl-
      // populated by the brickeconomy-enrich cron) — no on-demand API call.
      const be = beDetailsFromRow(activeSet);
      if (be?.current_value_new != null && c.env.BRICKLINK_CONSUMER_KEY) {
        // A plausible stored BE value wins; BrickLink + eBay still refresh live
        // for the price strip + cross-validation. When there's no stored BE
        // value the BrickLink-primary branch below handles the set instead.
        const refreshPromise = Promise.all([
          fetchSetPricing(activeSet.set_num as string, c.env).catch(() => null),
          fetchUsedPricing(activeSet.set_num as string, c.env).catch(() => null),
          fetchEbaySoldPrices(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null),
          askStale ? fetchEbayActiveListings(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null) : Promise.resolve(null),
        ]).then(async ([blp, u, ebayPrices, askListings]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          pushEbaySoldUpdate(supplementStmts, c.env.DB, activeSet.set_num as string, ebayPrices);
          const askStmt = buildEbayAskUpdate(c.env.DB, activeSet.set_num as string, askListings);
          if (askStmt) supplementStmts.push(askStmt);

          if (be && be.current_value_new !== null
              && isPlausibleMarketValue(be.current_value_new, { retailPrice: activeSet.retail_price as number, pieces: activeSet.pieces as number, corroborators: [activeSet.ebay_ask_value as number, blp?.current_value, activeSet.bl_new_value as number] })) {
            const defaultYr = activeSet.retired ? 0.15 : 0.10;
            const yr = (be.rolling_growth_12months != null)
              ? Math.min(0.25, Math.max(0.02, be.rolling_growth_12months / 100))
              : defaultYr;
            const forecast_2y = be.forecast_value_new_2_years ?? Math.round(be.current_value_new * Math.pow(1 + yr, 2) * 100) / 100;
            // Real 5-year forecast from the BrickEconomy scrape when present (the
            // old API never exposed it), else a growth-rate estimate.
            const forecast_5y = be.forecast_value_new_5_years ?? Math.round(be.current_value_new * Math.pow(1 + yr, 5) * 100) / 100;

            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, used_value=COALESCE(?, ?, used_value),
                bl_new_value=COALESCE(?, bl_new_value),
                bl_new_qty=COALESCE(?, bl_new_qty),
                bl_used_qty=COALESCE(?, bl_used_qty),
                bl_cached_at=CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE bl_cached_at END,
                retail_price=COALESCE(?, retail_price),
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
            // Stored BE value implausible — persist BL/eBay cross-source data regardless.
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
          fetchEbaySoldPrices(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null),
          askStale ? fetchEbayActiveListings(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null) : Promise.resolve(null),
        ]).then(async ([p, u, ebayPrices, askListings]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          pushEbaySoldUpdate(supplementStmts, c.env.DB, activeSet.set_num as string, ebayPrices);
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
      } else if (geminiKey) {
        const refreshPromise = Promise.all([
          callGeminiValuation(activeSet.set_num as string, activeSet.name as string, geminiKey, c.env).catch(() => null),
          fetchEbaySoldPrices(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null)
        ]).then(async ([gemVal, ebayPrices]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          pushEbaySoldUpdate(supplementStmts, c.env.DB, activeSet.set_num as string, ebayPrices);
          const ebayVal = ebaySoldNewValue(ebayPrices);
          if (gemVal && isPlausibleMarketValue(gemVal.current_value, { retailPrice: activeSet.retail_price as number, pieces: activeSet.pieces as number, corroborators: [activeSet.ebay_ask_value as number, ebayVal, activeSet.bl_new_value as number] })) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(gemVal.current_value * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(gemVal.current_value * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, used_value=?, forecast_2y=?, forecast_5y=?,
                valuation_method='ai',
                valuation_expires_at=datetime('now', '+12 hours'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(gemVal.current_value, gemVal.used_value, forecast_2y, forecast_5y, activeSet.set_num));
          } else if (ebayVal !== null) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(ebayVal * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(ebayVal * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, forecast_2y=?, forecast_5y=?,
                valuation_method='ebay_sold',
                valuation_expires_at=datetime('now', '+7 days'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(ebayVal, forecast_2y, forecast_5y, activeSet.set_num));
          }
          if (supplementStmts.length) {
            await c.env.DB.batch(supplementStmts);
          }
          await persistBlendedValue(c.env.DB, activeSet.set_num as string);
        }).catch(err => console.error('[bg-gemini-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      } else {
        const refreshPromise = fetchEbaySoldPrices(activeSet.set_num as string, activeSet.name as string, c.env).then(async (ebayPrices) => {
          const ebayVal = ebaySoldNewValue(ebayPrices);
          const yr = activeSet.retired ? 0.15 : 0.10;
          const hasVal = (ebayVal !== null && ebayVal !== undefined);
          const forecast_2y = hasVal ? Math.round(ebayVal * Math.pow(1 + yr, 2) * 100) / 100 : null;
          const forecast_5y = hasVal ? Math.round(ebayVal * Math.pow(1 + yr, 5) * 100) / 100 : null;
          const supplementStmts: D1PreparedStatement[] = [];
          pushEbaySoldUpdate(supplementStmts, c.env.DB, activeSet.set_num as string, ebayPrices);
          if (hasVal) {
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value = COALESCE(?, current_value),
                forecast_2y = COALESCE(?, forecast_2y),
                forecast_5y = COALESCE(?, forecast_5y),
                valuation_method = 'ebay_sold',
                valuation_expires_at = datetime('now', '+7 days'),
                cached_at = datetime('now')
              WHERE set_num=?
            `).bind(ebayVal, forecast_2y, forecast_5y, activeSet.set_num));
          }
          if (supplementStmts.length) await c.env.DB.batch(supplementStmts);
          await persistBlendedValue(c.env.DB, activeSet.set_num as string);
        }).catch(err => console.error('[bg-ebay-sold-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      }
    }
}
