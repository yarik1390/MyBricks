/**
 * BrickEconomy figures already stored in lego_sets.be_* columns. The scraper
 * that populated them is retired; valuation and set-detail paths still read
 * what is stored. Nothing here fetches BrickEconomy.
 */
export interface BrickEconomyStored {
  retail_price_us: number | null;
  current_value_new: number | null;
  current_value_used: number | null;
  forecast_value_new_2_years: number | null;
  forecast_value_new_5_years: number | null;
  rolling_growth_12months: number | null;
}

const posNum = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const anyNum = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Build a BrickEconomy-shaped value object from a lego_sets row's stored be_*
 * columns. Returns null when the row carries no usable figures. A retail equal
 * to the value is a fabricated echo and is dropped so it cannot anchor itself.
 */
export function beDetailsFromRow(row: Record<string, unknown>): BrickEconomyStored | null {
  const out: BrickEconomyStored = {
    retail_price_us: posNum(row.be_retail),
    current_value_new: posNum(row.be_value_new),
    current_value_used: posNum(row.be_value_used),
    forecast_value_new_2_years: posNum(row.be_forecast_2y),
    forecast_value_new_5_years: posNum(row.be_forecast_5y),
    rolling_growth_12months: anyNum(row.be_growth_12m),
  };
  if (out.current_value_new == null && out.current_value_used == null
      && out.forecast_value_new_2_years == null && out.forecast_value_new_5_years == null
      && out.retail_price_us == null) {
    return null;
  }
  if (out.retail_price_us != null && out.retail_price_us === out.current_value_new) {
    return { ...out, retail_price_us: null };
  }
  return out;
}
