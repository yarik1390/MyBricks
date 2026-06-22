import type { Env } from '../types';
import { firecrawlScrape } from './firecrawl';
import { firecrawlEnabled } from './pricing-flags';

/**
 * BrickEconomy set valuation via Firecrawl structured extraction — a drop-in,
 * cost-free replacement for the (~$1,000/mo) BrickEconomy API. Scrapes the
 * public set page. Superset of the old BrickEconomyDetails shape: it also
 * captures the real 5-year forecast the API never exposed.
 *
 * Returns null on any failure. Values are NOT trusted blindly — the caller
 * applies value validation + the existing isPlausibleMarketValue corroboration
 * gate before any figure is allowed to set current_value, so a hallucinated
 * scrape can never poison a valuation.
 */
export interface BrickEconomyScrape {
  retail_price_us: number | null;
  current_value_new: number | null;
  current_value_used: number | null;
  forecast_value_new_2_years: number | null;
  forecast_value_new_5_years: number | null;
  rolling_growth_12months: number | null;
}

const BE_SCHEMA = {
  type: 'object',
  properties: {
    retail_price_us: { type: 'number', description: 'Original US retail price (RRP) in USD' },
    current_value_new: { type: 'number', description: 'Current market value for NEW/sealed condition, in USD' },
    current_value_used: { type: 'number', description: 'Current market value for USED condition, in USD' },
    forecast_value_new_2_years: { type: 'number', description: '2-year forecast value for new/sealed, in USD' },
    forecast_value_new_5_years: { type: 'number', description: '5-year forecast value for new/sealed, in USD' },
    rolling_growth_12months: { type: 'number', description: 'Trailing 12-month value growth as a percentage (e.g. 18.5 means +18.5%)' },
  },
};

// Accept only finite positive numbers; reject 0/negatives/NaN/strings the LLM
// may emit. Growth may be negative, so it is validated separately by the caller.
const posNum = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const anyNum = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function fetchBrickEconomyViaFirecrawl(
  setNum: string,
  env: Env,
): Promise<BrickEconomyScrape | null> {
  if (!firecrawlEnabled(env)) return null;
  const formatted = setNum.includes('-') ? setNum : `${setNum}-1`;
  // BrickEconomy set pages live at /set/{setnum}/{slug}. The slug is purely
  // decorative — the site resolves on the set number alone — but the bare
  // /set/{setnum} path 404s, so append a placeholder "x" slug to land the page.
  const url = `https://www.brickeconomy.com/set/${encodeURIComponent(formatted)}/x`;

  const result = await firecrawlScrape<Partial<BrickEconomyScrape>>(
    {
      url,
      formats: ['json'],
      jsonOptions: {
        schema: BE_SCHEMA,
        prompt: `Extract the LEGO set valuation figures from this BrickEconomy page for set ${formatted}: original US retail price, current market value (new/sealed and used), the 2-year and 5-year forecast values for new/sealed, and the trailing 12-month growth percentage. All money in USD. Use null for any figure not shown on the page.`,
      },
      waitFor: 1200,
      timeoutMs: 25_000,
    },
    env,
  );
  if (!result) return null;

  const d = result.data || {};
  const out: BrickEconomyScrape = {
    retail_price_us: posNum(d.retail_price_us),
    current_value_new: posNum(d.current_value_new),
    current_value_used: posNum(d.current_value_used),
    forecast_value_new_2_years: posNum(d.forecast_value_new_2_years),
    forecast_value_new_5_years: posNum(d.forecast_value_new_5_years),
    // Growth can legitimately be negative; clamp obviously-bogus magnitudes.
    rolling_growth_12months: (() => {
      const g = anyNum(d.rolling_growth_12months);
      return g != null && g >= -90 && g <= 500 ? g : null;
    })(),
  };

  // Nothing useful extracted → treat as a miss so the caller keeps prior data.
  if (out.current_value_new == null && out.current_value_used == null && out.retail_price_us == null) {
    return null;
  }
  return out;
}
