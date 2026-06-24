// Part-out (sum-of-parts) value (E1) — pure, no network.
//
// A set's part-out value is what its individual parts would fetch if sold
// separately: Σ quantity × unit price over the set's part inventory. Unit prices
// come from the shared part_prices cache (keyed part_num:color_id); because we
// rarely have a price for every single lot, the result also reports a
// quantity-weighted coverage so the caller can withhold the figure until enough
// of the set (by piece count) is actually priced — a part-out value built from
// 40% of the pieces would understate badly and must not be shown.

export interface PartLot {
  part_num: string;
  color_id: number;
  quantity: number;
  is_spare?: number | boolean | null;
}

export interface PartOutResult {
  value: number | null;   // null until at least one lot is priced
  coverage: number;        // quantity-weighted fraction priced, 0..1
  priced_lots: number;     // distinct lots we had a price for
  total_lots: number;      // distinct lots considered (after the spare filter)
  interpolated?: boolean;  // true when value is extrapolated from partial coverage (20–40%)
}

// Stable key for the price map and the part_prices cache.
export function partKey(partNum: string, colorId: number): string {
  return `${partNum}:${colorId}`;
}

/**
 * Sum quantity × unit price over a set's parts. Spares are excluded by default
 * (they don't add resale value in a part-out). `unitPrice` maps partKey() →
 * per-unit price (use the NEW price guide for a sealed-set part-out). Pure.
 */
export function computePartOutValue(
  parts: PartLot[],
  unitPrice: Map<string, number>,
  opts: { includeSpares?: boolean } = {},
): PartOutResult {
  const lots = parts.filter(
    (p) => (opts.includeSpares ? true : !p.is_spare) && Number(p.quantity) > 0,
  );
  if (!lots.length) return { value: null, coverage: 0, priced_lots: 0, total_lots: 0 };

  let value = 0;
  let pricedLots = 0;
  let totalQty = 0;
  let pricedQty = 0;
  for (const p of lots) {
    const qty = Number(p.quantity);
    totalQty += qty;
    const unit = unitPrice.get(partKey(p.part_num, p.color_id));
    if (typeof unit === 'number' && Number.isFinite(unit) && unit > 0) {
      value += unit * qty;
      pricedLots++;
      pricedQty += qty;
    }
  }

  const coverage = totalQty > 0 ? Math.round((pricedQty / totalQty) * 1000) / 1000 : 0;

  // For 20–40% coverage, extrapolate by scaling the known-parts sum to the full
  // set and applying a 15% discount for unknown-parts uncertainty.
  let interpolated = false;
  let finalValue: number | null = pricedLots > 0 ? Math.round(value * 100) / 100 : null;
  if (finalValue !== null && coverage >= 0.2 && coverage < 0.4) {
    finalValue = Math.round((value / coverage) * 0.85 * 100) / 100;
    interpolated = true;
  }

  return {
    value: finalValue,
    coverage,
    priced_lots: pricedLots,
    total_lots: lots.length,
    interpolated,
  };
}
