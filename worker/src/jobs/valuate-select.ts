import type { Env } from '../types';
import { DEFAULT_CRON_BUDGET, packBatch, reserveQuota, type PackProfile } from '../lib/api-quota';
import { brickOwlEnabled } from '../lib/pricing-flags';

// One row of the valuation due-set query (the shape runValuateSets iterates).
export interface DueSetRow {
  set_num: string; name: string; theme: string | null; year: number; pieces: number;
  minifigs: number; retired: number; retail_price: number | null; brickset_msrp: number | null;
  ebay_ask_value: number | null;
  bl_nodata_at: string | null; be_value_new: number | null; be_value_used: number | null;
  be_forecast_2y: number | null; be_forecast_5y: number | null; be_retail: number | null;
  be_growth_12m: number | null; ask_stale: number;
}

// 90-day BrickLink no-data backoff: a set stamped bl_nodata_at (sold guide had
// <5 lots) is skipped so the ~5,000/day budget goes to sets that have data.
// Shared by the up-front reserve AND the per-set loop so the two never drift.
export function blBackedOffAt(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = String(v);
  const ts = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ts) && ts > Date.now() - 90 * 86400000;
}

export interface SelectDueSetsConfig {
  scope: 'owned' | 'all';
  options: {
    limit?: number; includeFresh?: boolean; prioritizeValue?: boolean; formulaHead?: boolean;
    minValue?: number; subrequestBudget?: number; onProgress?: unknown;
  };
  includeSupplemental: boolean;
  includeEbay: boolean;
  includeEbaySold: boolean;
  includeAiFallback: boolean;
}

// Select the batch of sets due for (re)valuation and reserve today's external-API
// budget for them up front. Returns the rows plus the packed limit. Extracted from
// runValuateSets so the (large) query/predicate/reserve preamble is isolated and the
// main routine reads as the per-set valuation loop it is.
export async function selectDueSets(
  env: Env,
  cfg: SelectDueSetsConfig,
): Promise<{ results: DueSetRow[]; limit: number }> {
  const { scope, options, includeSupplemental, includeEbay, includeEbaySold, includeAiFallback } = cfg;

  const requestedLimit = Number(options.limit);
  // Default raised from the old hand-tuned 4: the invocation packer below is
  // now the real safety limit, sizing each batch to the subrequest budget.
  const requested = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 250)
    : 12;
  const packProfile: PackProfile = {
    // BrickEconomy is no longer a per-set subrequest — its values are read from
    // the be_* columns (populated by the brickeconomy-enrich Firecrawl cron), so
    // the packer treats every set as BrickLink-primary.
    brickEconomy: false,
    supplemental: includeSupplemental,
    ebay: includeEbay,
    aiFallback: includeAiFallback && !!(env.GEMINI_API_KEY || env.OPENAI_API_KEY),
    progressWrites: !!options.onProgress,
  };
  const requestedBudget = Number(options.subrequestBudget);
  const subrequestBudget = Number.isFinite(requestedBudget) && requestedBudget > 0
    ? requestedBudget
    : DEFAULT_CRON_BUDGET;
  const limit = packBatch(requested, subrequestBudget, packProfile);
  const duePredicate = `(
    ls.valuation_method = 'formula_bulk'
    OR ls.valuation_expires_at IS NULL
    OR ls.valuation_expires_at < datetime('now')
    OR ls.cached_at IS NULL
  )`;
  const scopePredicate = scope === 'owned'
    ? `AND (
        ls.set_num IN (SELECT DISTINCT set_num FROM user_collection WHERE deleted_at IS NULL)
        OR ls.set_num IN (SELECT DISTINCT set_num FROM user_wishlist)
      )`
    : '';
  const freshnessPredicate = options.includeFresh ? '' : `AND ${duePredicate}`;
  // High-value mode: restrict to real (non-formula) market values worth at
  // least minValue, and order the most valuable first so the catalog head
  // stays fresh rather than the oldest-expiry rotation used for coverage.
  const prioritizeValue = options.prioritizeValue === true;
  const formulaHead = options.formulaHead === true;
  const minValueFloor = Number.isFinite(Number(options.minValue)) && Number(options.minValue) > 0
    ? Math.floor(Number(options.minValue))
    : 0;
  const valuePredicate = prioritizeValue
    ? `AND ls.valuation_method NOT IN ('formula_bulk', 'local')
      AND COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) >= ${minValueFloor}`
    : formulaHead
    ? `AND ls.valuation_method IN ('formula_bulk', 'local')
      AND COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) >= ${minValueFloor}
      AND (ls.cached_at IS NULL OR ls.cached_at < datetime('now', '-3 days'))`
    : '';
  const valueOrder = (prioritizeValue || formulaHead)
    ? `COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) DESC,`
    : '';

  // Prioritize overdue/formula rows first, then rotate through the oldest
  // cached valuations. With scope='all' this steadily covers the whole catalog.
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT ls.set_num, ls.name, ls.theme, ls.year, ls.pieces, ls.minifigs, ls.retired,
      ls.retail_price, ls.brickset_msrp, ls.ebay_ask_value, sme.bl_nodata_at,
      ls.be_value_new, ls.be_value_used, ls.be_forecast_2y, ls.be_forecast_5y, ls.be_retail, ls.be_growth_12m,
      (ls.ebay_ask_cached_at IS NULL OR ls.ebay_ask_cached_at < datetime('now', '-7 days')) AS ask_stale
    FROM lego_sets ls
    LEFT JOIN set_market_ext sme ON sme.set_num = ls.set_num
    WHERE 1=1
      ${freshnessPredicate}
      ${valuePredicate}
      ${scopePredicate}
    ORDER BY
      CASE WHEN ls.set_num IN (SELECT set_num FROM user_collection WHERE deleted_at IS NULL)
             OR ls.set_num IN (SELECT set_num FROM user_wishlist) THEN 0 ELSE 1 END,
      CASE WHEN ${duePredicate} THEN 0 ELSE 1 END,
      ${valueOrder}
      COALESCE(ls.valuation_expires_at, ls.cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<DueSetRow>();

  // Reserve today's external-API budget for this batch up front (2-3 D1
  // round-trips total) for accounting/visibility; these budgets are far above
  // any single run. BrickEconomy is no longer reserved here — its values come
  // from the be_* columns (Firecrawl-populated by brickeconomy-enrich), not a
  // per-set API call, so the ~$1,000/mo BrickEconomy API is off the hot path.
  // BrickLink is reserved to match the two budget savers below: backed-off sets
  // cost 0, and only retired sets pay for the USED guide (modern sets skip it),
  // so the ledger reflects real spend instead of a flat 2/set over-count.
  const blReserve = results.reduce(
    (n, s) => (blBackedOffAt(s.bl_nodata_at) ? n : n + (s.retired ? 2 : 1)),
    0,
  );
  await reserveQuota(env, {
    bricklink: blReserve,
    // BrickOwl makes TWO calls per set (catalog/lookup + catalog/price_data), so
    // reserve 2/set — the flat results.length under-counted its usage by half.
    brickowl: (includeSupplemental && brickOwlEnabled(env)) ? results.length * 2 : 0,
    ebay: includeEbay ? results.length * (includeEbaySold ? 2 : 1) : 0,
  });

  return { results, limit };
}
