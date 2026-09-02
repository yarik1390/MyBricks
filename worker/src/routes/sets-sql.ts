// Catalog/search SQL building blocks for the sets routes: the ORDER BY sort map,
// the non-building-merch demotion key, the catalog-card column projection, the
// set_market_ext join, and the FTS prefix-query builder. Pure strings/helpers with
// no request context — extracted from routes/sets.ts so the route file reads as
// handlers, and so scan.ts + tests can import the projection directly.

export const SORTS: Record<string, string> = {
  value_desc: "(CASE WHEN valuation_method IN ('formula_bulk', 'local') THEN 1 ELSE 0 END), COALESCE(NULLIF(blended_value, 0), current_value) DESC",
  // Ascending mirrors: keep formula/local rows last and NULL ROI/years last in
  // both directions so the reversed sort still surfaces real data first.
  value_asc:  "(CASE WHEN valuation_method IN ('formula_bulk', 'local') THEN 1 ELSE 0 END), COALESCE(NULLIF(blended_value, 0), current_value) ASC",
  roi_desc:   '(current_value / NULLIF(retail_price, 0)) DESC',
  roi_asc:    '(CASE WHEN retail_price IS NULL OR retail_price = 0 THEN 1 ELSE 0 END), (current_value / NULLIF(retail_price, 0)) ASC',
  year_desc:  '(year IS NULL) ASC, year DESC',
  year_asc:   '(year IS NULL) ASC, year ASC',
  az:         'name ASC',
  za:         'name DESC',
  // Trending: 30-day price momentum — sets whose value rose most. The route
  // INNER-joins the 30-day snapshot and filters both values > 0, so every row
  // reaching this sort has real momentum; the old CASE/-1 fallback for
  // snapshot-less sets is gone with the LEFT join that produced them.
  trending:   '((s.current_value - svh30.current_value) / svh30.current_value) DESC',
};

// Non-building merchandise (bag tags, bags, apparel, stationery, books) is
// catalogued under these themes. In keyword search we DEMOTE — never hide —
// these below real building sets, so a tight name match such as "Millennium
// Falcon Bag Tag" can't outrank the actual Millennium Falcon sets. Brickset's
// `category` column is mostly NULL across the catalog, so `theme` is the
// dependable signal. Used as the leading ORDER BY key (0 = real set, 1 = merch).
export const NON_SET_DEMOTION =
  "(CASE WHEN COALESCE(s.theme, '') IN ('Gear', 'Books') THEN 1 ELSE 0 END)";

// Catalog-card projection for GET /search. The grid + enrichSetRecord only need
// identity, value and the per-source price/cache family — NOT the heavy
// detail-only columns (brickset_description, brickset_image_urls and
// brickset_tags are large text/JSON; ratings, dimensions, dates, age and
// barcodes are detail-page only). Projecting them out trims the search payload
// and D1 serialization on every catalog page; GET /:setnum still SELECT *s the
// full row. IMPORTANT: every column blendMarketValue() reads must be here, or the
// grid's blended value silently diverges from the detail page (this list must stay
// a superset of BLEND_INPUT_COLUMNS + BLEND_EXT_COLUMNS in lib/market-sources.ts).
export const CATALOG_COLS =
  's.set_num, s.name, s.year, s.theme, s.pieces, s.minifigs, ' +
  's.image_url, s.retail_price, s.brickset_msrp, s.current_value, s.forecast_2y, s.forecast_5y, s.retired, ' +
  's.valuation_method, s.cached_at, s.source, s.valuation_expires_at, s.ebay_value, s.ebay_cached_at, ' +
  's.ebay_new_value, s.ebay_used_value, s.ebay_new_qty, s.ebay_used_qty, s.ebay_new_cached_at, s.ebay_used_cached_at, ' +
  's.ebay_new_last_sold, s.ebay_used_last_sold, ' +
  's.used_value, s.bl_new_value, s.bl_new_qty, s.bl_used_qty, s.bl_cached_at, s.be_cached_at, ' +
  's.be_value_new, s.be_value_used, s.be_retail, ' +
  's.ebay_ask_value, s.ebay_ask_qty, s.ebay_ask_cached_at, s.retirement_risk_score, s.subtheme, s.be_growth_12m, ' +
  's.bl_new_min, s.bl_new_max, s.bl_used_min, s.bl_used_max, s.lego_in_stock, s.lego_retiring_soon, ' +
  's.bo_new_value, s.bo_new_qty, s.bo_used_value, s.bo_used_qty, s.bo_cached_at, s.blended_value, ' +
  's.deal_signal, s.deal_strong, s.deal_discount_pct, ' +
  // PriceCharting sealed/complete sold comps — blendMarketValue() reads these
  // (pc_new weight 0.95, pc_complete 0.75). Omitting them made the grid blend
  // diverge from the detail page (catalog showed the range-high, not the blend).
  's.pc_new_value, s.pc_complete_value, s.pc_cached_at, ' +
  // Pricing v3 (set_market_ext side table): liquidity + used loose + live retail
  // + StockX lowest ask (corroborating asking signal in blendMarketValue).
  'ext.pc_loose_value, ext.pc_sales_volume, ext.pa_retail_value, ext.pa_lowest_offer, ext.pa_in_stock, ' +
  'ext.pa_best_merchant, ext.pa_offer_count, ext.pa_market, ext.pa_cached_at, ' +
  'ext.stockx_ask, ext.stockx_cached_at, ' +
  // Persisted v3 state keeps catalog cards and offline seed confidence aligned
  // with set detail, including history-based anomaly demotions.
  'svn.fair_value AS v3_new_fair, svn.low AS v3_new_low, svn.high AS v3_new_high, ' +
  'svn.liquidation_value AS v3_new_liquidation, svn.confidence AS v3_new_confidence, ' +
  'svn.confidence_score AS v3_new_score, svn.sample_count AS v3_new_samples, ' +
  'svn.independent_family_count AS v3_new_families, svn.basis_json AS v3_new_basis, ' +
  'svn.flags_json AS v3_new_flags, svn.forecast_json AS v3_new_forecast, svn.as_of AS v3_new_as_of, ' +
  'svu.fair_value AS v3_used_fair, svu.low AS v3_used_low, svu.high AS v3_used_high, ' +
  'svu.liquidation_value AS v3_used_liquidation, svu.confidence AS v3_used_confidence, ' +
  'svu.confidence_score AS v3_used_score, svu.sample_count AS v3_used_samples, ' +
  'svu.independent_family_count AS v3_used_families, svu.basis_json AS v3_used_basis, ' +
  'svu.flags_json AS v3_used_flags, svu.as_of AS v3_used_as_of';

// Wishlist cards need the exact same pricing inputs and persisted v3 states as
// catalog cards, but also carry user-owned metadata. Keep this as a mechanical
// alias of CATALOG_COLS rather than maintaining another blend projection that
// can drift. D1 permits at most 100 result columns: CATALOG_COLS is 94 and the
// six wishlist columns below bring this projection to exactly 100.
export const WISHLIST_COLS =
  'w.id, w.target_price, w.notes, w.added_at, w.alerted_at, w.acknowledged_at, ' +
  CATALOG_COLS;

// LEFT JOIN that brings the set_market_ext side-table columns into a flat row so
// enrichSetRecord (deal signal / liquidity / used loose) sees them. Used by both
// the catalog projection above and the SELECT * detail read.
export const MARKET_EXT_JOIN = `
  LEFT JOIN set_market_ext ext ON ext.set_num = s.set_num
  LEFT JOIN set_valuation_state svn ON svn.set_num=s.set_num AND svn.condition='new_sealed'
  LEFT JOIN set_valuation_state svu ON svu.set_num=s.set_num AND svu.condition='used_complete'`;

function parseJson(value: unknown, fallback: unknown) {
  try { return JSON.parse(String(value ?? '')); } catch { return fallback; }
}

export function attachCatalogValuationState<T extends Record<string, unknown>>(row: T): T {
  const state = (prefix: 'v3_new' | 'v3_used', condition: 'new_sealed' | 'used_complete') => {
    if (row[`${prefix}_fair`] == null) return undefined;
    return {
      condition,
      fair_value: row[`${prefix}_fair`],
      low: row[`${prefix}_low`],
      high: row[`${prefix}_high`],
      liquidation_value: row[`${prefix}_liquidation`],
      confidence: row[`${prefix}_confidence`],
      confidence_score: row[`${prefix}_score`],
      sample_count: row[`${prefix}_samples`],
      independent_family_count: row[`${prefix}_families`],
      basis: parseJson(row[`${prefix}_basis`], []),
      flags: parseJson(row[`${prefix}_flags`], []),
      as_of: row[`${prefix}_as_of`],
      model_version: 'v3',
    };
  };
  return {
    ...row,
    __valuation_new: state('v3_new', 'new_sealed'),
    __valuation_used: state('v3_used', 'used_complete'),
    __valuation_forecast: parseJson(row.v3_new_forecast, undefined),
  };
}

// Turn a raw search string into an FTS5 prefix query (each token gets a trailing *).
export function toFtsPrefixQuery(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(tok => `${tok}*`)
    .join(' ');
}
