import type { Env } from '../types';
import { DEFAULT_CRON_BUDGET, packBatch, reserveQuota, type PackProfile } from '../lib/api-quota';

// One row of the valuation due-set query (the shape runValuateSets iterates).
export interface DueSetRow {
  set_num: string; name: string; theme: string | null; year: number; pieces: number;
  minifigs: number; retired: number; retail_price: number | null; brickset_msrp: number | null;
  ebay_ask_value: number | null;
  bl_new_value: number | null; bl_new_qty: number | null; used_value: number | null;
  ebay_new_value: number | null; ebay_used_value: number | null;
  pc_new_value: number | null; pc_complete_value: number | null;
  bl_nodata_at: string | null; be_value_new: number | null; be_value_used: number | null;
  be_forecast_2y: number | null; be_forecast_5y: number | null; be_retail: number | null;
  be_growth_12m: number | null; ask_stale: number;
}

/**
 * Themes that are NOT priceable sets and must never consume a valuation budget.
 *
 * Measured against the catalogue: of 9,440 rows with no market evidence from any
 * source, Gear (3,493, average ONE piece) and Books (1,271, average seven) are
 * half of them. They are keyrings, apparel, stationery and paperbacks — no
 * pricing source carries them and no collector tracks them as an investment, so
 * every call spent on one is a call not spent on a real set. Service Packs
 * (spare-part bags) and Educational/Dacta (school kits) are the same story.
 *
 * They also made coverage look far worse than it is: excluding these drops the
 * "no real source" population by ~5,500 without changing a single real set.
 *
 * Kept OUT of this list deliberately: Duplo, System, Universal Building Set and
 * Promotional. Those are genuine buildable sets — old and thinly traded, but
 * real, and some carry four-figure values.
 */
export const NON_PRICEABLE_THEMES = [
  'Gear',
  'Books',
  'Service Packs',
  'Educational and Dacta',
  'LEGO Brand Store',
];

/** SQL fragment excluding the non-priceable themes. Shared so the valuation
 *  queue and any coverage metric cannot drift apart on what counts as a set. */
export const PRICEABLE_PREDICATE =
  `AND (ls.theme IS NULL OR ls.theme NOT IN (${NON_PRICEABLE_THEMES.map((t) => `'${t}'`).join(', ')}))`;

// 90-day BrickLink no-data backoff: a set stamped bl_nodata_at (sold guide had
// <5 lots) is skipped so the ~5,000/day budget goes to sets that have data.
// Shared by the up-front reserve AND the per-set loop so the two never drift.
export function blBackedOffAt(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = String(v);
  const ts = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ts) && ts > Date.now() - 90 * 86400000;
}

/**
 * Positive legacy values aimed at the sealed/new target. This deliberately does
 * not call them "usable": publication still depends on source freshness and
 * identity checks. Raw PriceCharting columns are also excluded because they can
 * predate the verified/quarantined mapping split in pricing_signals.
 */
export function hasPositiveLegacySealedValue(row: Record<string, unknown>): boolean {
  return [row.bl_new_value, row.be_value_new, row.ebay_new_value]
    .some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
}

/** Existing general valuation ordering. Keep this stable: prioritizeValue and
 * formula-head callers rely on the older due/value behavior. */
export const PRIORITY_ORDER_SQL = `
  CASE WHEN ls.set_num IN (SELECT set_num FROM user_collection WHERE deleted_at IS NULL) THEN 0
       WHEN ls.set_num IN (SELECT set_num FROM user_wishlist) THEN 1 ELSE 2 END,
  CASE WHEN ls.valuation_expires_at IS NOT NULL
             AND ls.valuation_expires_at < datetime('now', '-30 days') THEN 0 ELSE 1 END`;

/**
 * BrickLink-only refresh ordering. A row normally ranks by personal intent,
 * value, then newest set. Once its guide is seven days old it crosses a bounded
 * aging threshold and cannot be starved forever by newly eligible personal rows.
 */
export const BRICKLINK_REFRESH_ORDER_SQL = `
  CASE WHEN ls.bl_cached_at IS NULL OR ls.bl_cached_at < datetime('now', '-7 days') THEN 0 ELSE 1 END,
  CASE WHEN ls.set_num IN (SELECT set_num FROM user_collection WHERE deleted_at IS NULL) THEN 0
       WHEN ls.set_num IN (SELECT set_num FROM user_wishlist) THEN 1 ELSE 2 END,
  COALESCE(NULLIF(ls.blended_value, 0), ls.current_value, 0) DESC,
  COALESCE(ls.year, 0) DESC`;

export interface ValuationQuotaGrants {
  bricklink: number;
  ebay: number;
  gemini: number;
  openrouter: number;
  openai: number;
}

// model-refresh can publish at most three curated survivors plus three
// discovered text models. Reserve one more unit for the paid backstop.
export const OPENROUTER_CALLS_PER_SET = 7;

export interface SelectDueSetsConfig {
  scope: 'owned' | 'all';
  options: {
    limit?: number; includeFresh?: boolean; prioritizeValue?: boolean; formulaHead?: boolean;
    blStale?: boolean;
    minValue?: number; subrequestBudget?: number; onProgress?: unknown;
  };
  includeSupplemental: boolean;
  includeBrickLink?: boolean;
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
): Promise<{ results: DueSetRow[]; limit: number; grants: ValuationQuotaGrants }> {
  const {
    scope, options, includeSupplemental, includeEbay, includeEbaySold, includeAiFallback,
  } = cfg;
  const includeBrickLink = cfg.includeBrickLink !== false;

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
  // blStale supplies its own freshness criterion (BrickLink age), and its targets are
  // deliberately NOT "due" by the normal rule — that is exactly why they were starving.
  const freshnessPredicate = (options.includeFresh || options.blStale) ? '' : `AND ${duePredicate}`;
  // High-value mode: restrict to real (non-formula) market values worth at
  // least minValue, and order the most valuable first so the catalog head
  // stays fresh rather than the oldest-expiry rotation used for coverage.
  const prioritizeValue = options.prioritizeValue === true;
  const formulaHead = options.formulaHead === true;
  const minValueFloor = Number.isFinite(Number(options.minValue)) && Number(options.minValue) > 0
    ? Math.floor(Number(options.minValue))
    : 0;
  const blStale = options.blStale === true;
  // Begin at 22h so rows selected by the hourly lane have execution headroom
  // before BrickLink's 24h display gate. Selection alone makes no freshness
  // promise: only a successful downstream fetch advances bl_cached_at.
  const valuePredicate = blStale
    ? includeBrickLink
      ? `AND ls.bl_new_value IS NOT NULL
        AND (ls.bl_cached_at IS NULL OR ls.bl_cached_at < datetime('now', '-22 hours'))
        -- Filter before LIMIT: backed-off rows cannot fetch a guide and would
        -- otherwise repeatedly consume the dedicated refresh lane's slots.
        AND (sme.bl_nodata_at IS NULL OR julianday(sme.bl_nodata_at) IS NULL
             OR julianday(sme.bl_nodata_at) <= julianday('now', '-90 days'))`
      : 'AND 0=1'
    : prioritizeValue
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

  // The dedicated BL lane has a distinct contract; do not alter the general
  // prioritizeValue/formula-head order while tightening BL freshness.
  const priorityOrder = blStale ? BRICKLINK_REFRESH_ORDER_SQL : PRIORITY_ORDER_SQL;

  // Prioritize overdue/formula rows first, then rotate through the oldest
  // cached valuations. With scope='all' this steadily covers the whole catalog.
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT ls.set_num, ls.name, ls.theme, ls.year, ls.pieces, ls.minifigs, ls.retired,
      ls.retail_price, ls.brickset_msrp, ls.ebay_ask_value,
      ls.bl_new_value, ls.bl_new_qty, ls.used_value, ls.ebay_new_value, ls.ebay_used_value,
      ls.pc_new_value, ls.pc_complete_value, sme.bl_nodata_at,
      ls.be_value_new, ls.be_value_used, ls.be_forecast_2y, ls.be_forecast_5y, ls.be_retail, ls.be_growth_12m,
      (ls.ebay_ask_cached_at IS NULL OR ls.ebay_ask_cached_at < datetime('now', '-7 days')) AS ask_stale
    FROM lego_sets ls
    LEFT JOIN set_market_ext sme ON sme.set_num = ls.set_num
    WHERE 1=1
      ${freshnessPredicate}
      ${valuePredicate}
      ${scopePredicate}
      ${PRICEABLE_PREDICATE}
    ORDER BY
      ${priorityOrder},
      -- This legacy sealed-target heuristic intentionally excludes raw PC fields:
      -- their identity may be quarantined and positive does not mean publishable.
      CASE WHEN (ls.bl_new_value IS NULL OR ls.bl_new_value <= 0)
                AND (ls.be_value_new IS NULL OR ls.be_value_new <= 0)
                AND (ls.ebay_new_value IS NULL OR ls.ebay_new_value <= 0)
                AND COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) >= 100
           THEN 0 ELSE 1 END,
      CASE WHEN ${duePredicate} THEN 0 ELSE 1 END,
      ${valueOrder}
      COALESCE(ls.valuation_expires_at, ls.cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<DueSetRow>();

  // Reserve provider-call units for this batch and return the exact atomic grants
  // to the execution loop. A reservation is the sole charge for these paths:
  // the provider helpers must not spendQuota again or they would double-charge.
  //
  // Multiplicity:
  //   BrickLink NEW=1, retired USED=1;
  //   eBay sold NEW+USED=2 and stale ask=1; Gemini/OpenAI=1 logical call;
  //   OpenRouter <=6 free attempts + 1 paid backstop per set.
  const blReserve = includeBrickLink ? results.reduce(
    (n, s) => (blBackedOffAt(s.bl_nodata_at) ? n : n + (s.retired ? 2 : 1)),
    0,
  ) : 0;
  const rawGrants = await reserveQuota(env, {
    bricklink: blReserve,
    ebay: includeEbay
      ? results.reduce((n, s) => n + (includeEbaySold ? 2 : 0) + (s.ask_stale ? 1 : 0), 0)
      : 0,
    // AI quota service names are intentionally unbudgeted by default today, so
    // reserveQuota passes these through without a D1 row. If an operator/code cap
    // is introduced, these same returned grants immediately become hard gates.
    gemini: includeAiFallback && !!env.GEMINI_API_KEY ? results.length : 0,
    openrouter: includeAiFallback && !!env.OPENROUTER_API_KEY ? results.length * OPENROUTER_CALLS_PER_SET : 0,
    openai: includeAiFallback && !env.OPENROUTER_API_KEY && !!env.OPENAI_API_KEY ? results.length : 0,
  });
  const grants: ValuationQuotaGrants = {
    bricklink: rawGrants.bricklink ?? 0,
    ebay: rawGrants.ebay ?? 0,
    gemini: rawGrants.gemini ?? 0,
    openrouter: rawGrants.openrouter ?? 0,
    openai: rawGrants.openai ?? 0,
  };

  return { results, limit, grants };
}
