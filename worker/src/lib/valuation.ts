// Retail MSRP-per-piece multipliers, calibrated against the alexracape Kaggle
// dataset (3,428 sets with >=100 pieces, 2023). Real retail $/piece is far
// flatter across building themes than once assumed — most cluster near 1.0;
// the theme-specific value lives in appreciation (below), not retail price.
// Duplo stays low-balled: its few large pieces inflate raw $/piece, so the
// piece-count model over-prices it without this damping.
const THEME_MULTIPLIERS: Record<string, number> = {
  'Star Wars': 1.10,
  'Technic': 0.97,
  'Ideas': 0.85,
  'Icons': 0.80,
  'Creator Expert': 0.83,
  'Creator 3-in-1': 0.82,
  'Architecture': 0.90,
  'Harry Potter': 1.03,
  'Marvel': 1.03,
  'DC': 1.00,
  'Ninjago': 0.94,
  'City': 1.20,
  'Friends': 0.98,
  'Duplo': 0.85,
  'Minecraft': 0.96,
  'Speed Champions': 0.95,
};

/**
 * Whether a set should be treated as retired, inferred from age. The formula
 * below models a ~2-year shelf life, so anything older than that is past retail
 * and has begun appreciating. The bulk catalog import has no real retirement
 * data — without this it pinned every catalog set to its MSRP (no appreciation
 * applied), which is the dominant cause of "low" valuation quality. Kept here as
 * the single source of truth so the import path and any offline recompute agree.
 */
export function isLikelyRetired(year?: number | null): boolean {
  if (!year || year <= 0) return false;
  return year <= new Date().getFullYear() - 3;
}

/**
 * Empirically-measured RRP -> current-value multiplier.
 *
 * Calibrated 2026-07-25 against PRODUCTION sets that carry a real sold comp
 * (eBay sold or BrickLink), median of value/RRP per (age, retired) bucket over
 * ~5,200 sets, outliers clipped to 0.1-30x:
 *
 *   active   age 0-2  0.85 (n=1107)   retired  age 3-5   1.10 (n=762)
 *   active   age 3-5  0.98 (n=383)    retired  age 6-8   1.50 (n=941)
 *                                     retired  age 9-11  2.11 (n=822)
 *                                     retired  age 12-15 2.84 (n=658)
 *                                     retired  age 16-20 4.03 (n=280)
 *                                     retired  age 21-25 6.01 (n=167)
 *                                     retired  age 26+   7.93 (n=118)
 *
 * The curve is smooth and monotonic and reproduces the known market shape: sets
 * trade BELOW RRP while in production (discounting), then appreciate once
 * retired. Interpolated between bucket midpoints so neighbouring years don't
 * jump. Re-measure periodically — these are empirical, not physical, constants.
 */
export function retailAgeMultiplier(ageYears: number, retired: boolean): number {
  const age = Number.isFinite(ageYears) ? Math.max(0, ageYears) : 0;
  // Still in production: shallow discount curve, never the retirement premium.
  if (!retired) return age <= 2 ? 0.85 : Math.min(0.98, 0.85 + (age - 2) * 0.043);
  // Retired: (bucket midpoint age, median multiplier) with linear interpolation.
  const curve: Array<[number, number]> = [
    [1, 0.90], [4, 1.10], [7, 1.50], [10, 2.11],
    [13.5, 2.84], [18, 4.03], [23, 6.01], [28, 7.93],
  ];
  if (age <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i - 1];
    const [x2, y2] = curve[i];
    if (age <= x2) return y1 + ((age - x1) / (x2 - x1)) * (y2 - y1);
  }
  // Beyond the measured range, extend the final observed slope but cap it: we
  // have no evidence past ~30 years and must not extrapolate a runaway value.
  const [lastX, lastY] = curve[curve.length - 1];
  return Math.min(12, lastY + (age - lastX) * 0.19);
}

export function formulaValuation(set: {
  pieces?: number;
  year?: number;
  theme?: string | null;
  retired?: boolean;
  minifigs?: number;
  /** Real RRP (retail_price / brickset_msrp). Strongly preferred over the
   *  piece-count estimate — present for ~99.99% of formula-priced sets. */
  retailPrice?: number | null;
}) {
  const pieces = set.pieces || 100;
  const year = set.year || new Date().getFullYear();
  const theme = set.theme || '';
  const retired = set.retired || false;
  const minifigs = set.minifigs || 0;

  const themeMultiplier = THEME_MULTIPLIERS[theme] || 1.0;
  const currentYear = new Date().getFullYear();

  // Base MSRP calculation based on parts count, theme multiplier, and base rate per piece.
  // The $0.11/pc base is mirrored by pricePerPiece() in public/js/lib/pure.js — keep in sync.
  const msrp = Math.round(pieces * 0.11 * themeMultiplier * 100) / 100;

  // Theme-specific compound appreciation rates, calibrated against the Kaggle
  // dataset (2,666 sets, year<=2020, annualized 2023 price / MSRP). The real
  // overall median is ~7%/yr, so the baseline rose from 4%; premium themes
  // sit ~9-11%, and City/Friends — previously floored at 1.5% — are really
  // ~3-4%. Order matters: 'creator expert' must precede plain 'creator'.
  let appreciationRate = 0.065; // ~7% real overall median
  const t = theme.toLowerCase();
  if (t.includes('star wars') || t.includes('ninjago') || t.includes('architecture') || t.includes('ideas')) {
    appreciationRate = 0.09; // real 8-11%/yr
  } else if (t.includes('icons') || t.includes('creator expert')) {
    appreciationRate = 0.07; // real ~7%/yr
  } else if (t.includes('technic')) {
    appreciationRate = 0.05; // real ~4.8%/yr (was overstated at 7%)
  } else if (t.includes('creator')) {
    appreciationRate = 0.045; // plain Creator, real ~3.9%/yr
  } else if (t.includes('city')) {
    appreciationRate = 0.04; // real ~4.3%/yr (was floored at 1.5%)
  } else if (t.includes('friends') || t.includes('duplo')) {
    appreciationRate = 0.03; // real ~2.5%/yr
  }

  // Shelf life defaults to 2 years before a set is retired
  const yearsSinceRetirement = retired ? Math.max(0, currentYear - (year + 2)) : 0;

  // PREFERRED PATH: a real RRP with the empirical age curve. The piece-count
  // route below synthesises an MSRP ($0.11/pc x theme) and only then compounds a
  // theme appreciation rate — two stacked estimates, and it silently defaults
  // `pieces` to 100 when the piece count is missing (true for ~37% of
  // formula-priced sets, which made those values meaningless). The real retail
  // price is present for ~99.99% of them, so prefer it whenever we have one.
  const realRrp = Number(set.retailPrice);
  const haveRealRrp = Number.isFinite(realRrp) && realRrp > 0;
  let currentValue: number;
  if (haveRealRrp) {
    currentValue = realRrp * retailAgeMultiplier(currentYear - year, retired);
  } else {
    // Compound appreciation value
    currentValue = msrp * Math.pow(1 + appreciationRate, yearsSinceRetirement);
    // Cap appreciation at 5x MSRP
    const maxCap = msrp * 5;
    if (currentValue > maxCap) {
      currentValue = maxCap;
    }
  }

  // Minifigure rarity bonus — piece-count path ONLY. The empirical RRP curve is
  // measured on real sets WITH their minifigs already priced in, so adding the
  // bonus on top of it would double-count them.
  if (!haveRealRrp) {
    const isLicensed = t.includes('star wars') || t.includes('marvel') || t.includes('dc') || t.includes('harry potter') || t.includes('ideas');
    const figBonusVal = isLicensed ? 7.50 : 4.50;
    currentValue += minifigs * figBonusVal;
  }

  // Round values
  currentValue = Math.round(currentValue * 100) / 100;
  const forecast2y = Math.round(currentValue * Math.pow(1 + appreciationRate, 2) * 100) / 100;
  const forecast5y = Math.round(currentValue * Math.pow(1 + appreciationRate, 5) * 100) / 100;

  return {
    // Report the REAL retail price when we have one; only fall back to the
    // synthesised piece-count MSRP when we don't.
    retail_price: haveRealRrp ? realRrp : msrp,
    current_value: currentValue,
    forecast_2y: forecast2y,
    forecast_5y: forecast5y,
  };
}

/**
 * The only retail figure that may ANCHOR a plausibility judgement is one that
 * is independent of the value being judged. brickset_msrp qualifies; a
 * retail_price that matches be_retail was fed by the same BrickEconomy scrape
 * as the value itself (backfill path), so it can't corroborate it — a
 * misparsed "$4,999" retail is exactly what let a $15,000 scrape through.
 */
export function independentRetailAnchor(row: {
  brickset_msrp?: number | null;
  retail_price?: number | null;
  be_retail?: number | null;
}): number | null {
  const msrp = Number(row.brickset_msrp);
  if (Number.isFinite(msrp) && msrp > 0) return msrp;
  const retail = Number(row.retail_price);
  if (!Number.isFinite(retail) || retail <= 0) return null;
  const beRetail = Number(row.be_retail);
  if (Number.isFinite(beRetail) && beRetail > 0 && retail === beRetail) return null;
  return retail;
}

/**
 * Guard against implausible market values — chiefly BrickEconomy mismatches
 * (e.g. a $10,153 "value" on a 1985 59-piece UNICEF Van whose eBay asks are
 * ~$14). Returns true if the value should be TRUSTED, false if it's implausible
 * and should be discarded in favour of the next source / the formula.
 *
 * A real corroborating comp (eBay asking, BrickLink sold) is the authority: when
 * present, the value is trusted iff it's in a sane band around it (this spares
 * legit rares like UCS sets whose high value is confirmed by listings). Only
 * when there's NO corroboration do we fall back to a generous retail-multiple
 * ceiling to flag gross errors. BrickLink sold data is clean and isn't gated.
 */
export function isPlausibleMarketValue(
  value: number,
  ctx: { retailPrice?: number | null; pieces?: number | null; corroborators?: Array<number | null | undefined> },
): boolean {
  if (!(value > 0)) return false;
  const corr = (ctx.corroborators ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (corr.length) {
    // Trust iff within a sane band of a real comp. Asks overstate realized value,
    // so a "value" more than ~3x the highest comp is implausible (catches e.g.
    // Cloud City at $15,878 vs a $3,907 ask) while sparing thin-market variance.
    return value <= 3 * Math.max(...corr) && value >= 0.15 * Math.min(...corr);
  }
  const retail = Number(ctx.retailPrice);
  // A retail anchor that exactly equals the candidate value is no anchor at
  // all: the BrickEconomy scrape sometimes echoes the market value into the
  // retail field (Ole Kirk's House stored retail=$13,037=value), and a value
  // can't corroborate itself. Treat it as unknown retail instead.
  if (Number.isFinite(retail) && retail > 0 && retail !== value) {
    const cap = Number(ctx.pieces) > 500 ? 25 : 40; // big sets rarely exceed 25x retail; small/vintage get more headroom
    return value >= 0.2 * retail && value <= cap * retail;
  }
  // No independent anchor at all. Modest claims pass (low stakes, can't judge),
  // but an uncorroborated four-figure value — or an absurd $/piece — is exactly
  // how scrape garbage reached the top of the catalog ($15,000 for a 177-piece
  // kit, $3,999 for a pencil case). Reject those until any real comp lands.
  const pieces = Number(ctx.pieces);
  if (Number.isFinite(pieces) && pieces >= 30) return value / pieces <= 20;
  return value <= 2000;
}

// Refresh cadence by valuation source quality. Market-backed prices hold for a
// day; eBay sold comps move slowly (a week); formula/AI estimates are
// low-confidence, so retry them sooner in the hope a market source answers.
const VALUATION_TTL: Record<string, string> = {
  brickeconomy: '+1 day',
  market: '+1 day',
  ebay_sold: '+7 days',
  ebay_rss: '+7 days',
  ai: '+12 hours',
  formula: '+12 hours',
  formula_bulk: '+12 hours',
};

export function valuationExpiryModifier(method: string): string {
  return VALUATION_TTL[method] ?? '+1 day';
}
