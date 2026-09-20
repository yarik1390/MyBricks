/**
 * PriceCharting counterfactual backtest.
 *
 * The blend folds PriceCharting into the eBay-market family on purpose (it is a
 * resale index, not an independent second opinion), which means the engine gets
 * its "price agreed by two methods" signal from eBay-sold. Two facts made that
 * worth measuring BEFORE any weight change:
 *
 *   - 4,158 of the 7,826 sets carrying a PriceCharting sealed value have no
 *     eBay-sold comp at all. For them PriceCharting is the only sold-class
 *     evidence the blend has ever seen.
 *   - On the 3,668 sets that carry both, PriceCharting sits at 1.005x eBay-sold
 *     with a mean absolute difference of 13.4% and 85.7% inside a -20%/+25% band.
 *
 * That is the evidence, not an opinion: it says PriceCharting may CARRY the
 * family where eBay-sold is absent, and it does not say PriceCharting deserves a
 * separate family (the residual 13.4% is real disagreement, and treating a
 * derivative index as an independent confirmation is precisely the mistake the
 * family model exists to prevent).
 *
 * Exposed as GET /api/admin/pricing/backtest so the same numbers can be
 * recomputed after any weighting change instead of being quoted from a stale
 * report.
 */

export type BacktestBand = {
  n_compare: number;
  mean_ratio: number | null;
  mean_abs_pct_diff: number | null;
  within_band: number;
};

export type PriceChartingBacktest = {
  as_of: string;
  overlap: BacktestBand & { within_band_pct: number | null };
  coverage: {
    pc_sets: number;
    pc_with_ebay_sold: number;
    pc_without_ebay_sold: number;
  };
  loose: {
    loose_sets: number;
    mean_loose_vs_complete: number | null;
  };
  attribution: {
    sets_with_pc_signal: number;
    sets_without_link: number;
    pending_legacy_mappings: number;
  };
};

export async function runPriceChartingBacktest(db: D1Database): Promise<PriceChartingBacktest> {
  const pcCte = `WITH pc AS (
      SELECT set_num, MAX(value) AS v
        FROM pricing_signals
       WHERE source='pricecharting' AND condition='new_sealed'
         AND match_status IN ('verified','manual') AND value > 0
       GROUP BY set_num
    )`;

  const [overlap, coverage, loose, attribution] = await Promise.all([
    db.prepare(`${pcCte}
      SELECT COUNT(*) AS n_compare,
             AVG(pc.v / ls.ebay_new_value) AS mean_ratio,
             AVG(ABS(pc.v - ls.ebay_new_value) / ls.ebay_new_value) AS mean_abs_pct_diff,
             SUM(CASE WHEN pc.v BETWEEN ls.ebay_new_value * 0.8 AND ls.ebay_new_value * 1.25 THEN 1 ELSE 0 END) AS within_band
        FROM pc JOIN lego_sets ls ON ls.set_num = pc.set_num
       WHERE ls.ebay_new_value > 0`).first<{
      n_compare: number;
      mean_ratio: number | null;
      mean_abs_pct_diff: number | null;
      within_band: number | null;
    }>(),
    db.prepare(`${pcCte}
      SELECT COUNT(*) AS pc_sets,
             SUM(CASE WHEN ls.ebay_new_value > 0 THEN 1 ELSE 0 END) AS pc_with_ebay_sold,
             SUM(CASE WHEN ls.ebay_new_value IS NULL OR ls.ebay_new_value <= 0 THEN 1 ELSE 0 END) AS pc_without_ebay_sold
        FROM pc JOIN lego_sets ls ON ls.set_num = pc.set_num`).first<{
      pc_sets: number;
      pc_with_ebay_sold: number | null;
      pc_without_ebay_sold: number | null;
    }>(),
    // Loose (item only, no box/manual) against used-complete on the same sets.
    // Measured at ~0.52x, which is why loose may only ever cap the liquidation
    // figure and never be folded into the used-complete headline.
    db.prepare(`WITH l AS (
        SELECT set_num, MAX(value) AS v FROM pricing_signals
         WHERE source='pricecharting' AND condition='loose' AND value > 0 GROUP BY set_num),
      c AS (
        SELECT set_num, MAX(value) AS v FROM pricing_signals
         WHERE source='pricecharting' AND condition='used_complete' AND value > 0 GROUP BY set_num)
      SELECT COUNT(*) AS loose_sets, AVG(l.v / c.v) AS mean_loose_vs_complete
        FROM l JOIN c ON c.set_num = l.set_num`).first<{
      loose_sets: number;
      mean_loose_vs_complete: number | null;
    }>(),
    // Attribution debt. PriceCharting's permission is conditioned on a prominent
    // credit AND a direct product link, so a set contributing a PriceCharting
    // signal without a numeric product id is under-attributed by construction.
    db.prepare(`WITH pcs AS (
        SELECT DISTINCT set_num FROM pricing_signals WHERE source='pricecharting')
      SELECT COUNT(*) AS sets_with_pc_signal,
             SUM(CASE WHEN ls.pc_id IS NULL
                       OR NOT (ls.pc_id GLOB '[0-9]*' AND ls.pc_id NOT GLOB '*[^0-9]*')
                      THEN 1 ELSE 0 END) AS sets_without_link
        FROM pcs JOIN lego_sets ls ON ls.set_num = pcs.set_num`).first<{
      sets_with_pc_signal: number;
      sets_without_link: number | null;
    }>(),
  ]);

  const pendingLegacy = await db.prepare(
    `SELECT COUNT(*) AS n FROM pricing_source_map pm
      JOIN lego_sets ls ON ls.set_num = pm.set_num
     WHERE pm.source='pricecharting' AND pm.status IN ('verified','manual')
       AND pm.source_item_id LIKE 'legacy:%'
       AND (ls.pc_id IS NULL OR NOT (ls.pc_id GLOB '[0-9]*' AND ls.pc_id NOT GLOB '*[^0-9]*'))`,
  ).first<{ n: number }>().catch(() => null);

  const nCompare = Number(overlap?.n_compare || 0);
  const withinBand = Number(overlap?.within_band || 0);
  const round = (value: number | null | undefined, places: number) => (
    value == null || !Number.isFinite(Number(value))
      ? null
      : Math.round(Number(value) * 10 ** places) / 10 ** places
  );

  return {
    as_of: new Date().toISOString(),
    overlap: {
      n_compare: nCompare,
      mean_ratio: round(overlap?.mean_ratio, 3),
      mean_abs_pct_diff: round(overlap?.mean_abs_pct_diff, 3),
      within_band: withinBand,
      within_band_pct: nCompare ? Math.round((withinBand / nCompare) * 1000) / 10 : null,
    },
    coverage: {
      pc_sets: Number(coverage?.pc_sets || 0),
      pc_with_ebay_sold: Number(coverage?.pc_with_ebay_sold || 0),
      pc_without_ebay_sold: Number(coverage?.pc_without_ebay_sold || 0),
    },
    loose: {
      loose_sets: Number(loose?.loose_sets || 0),
      mean_loose_vs_complete: round(loose?.mean_loose_vs_complete, 3),
    },
    attribution: {
      sets_with_pc_signal: Number(attribution?.sets_with_pc_signal || 0),
      sets_without_link: Number(attribution?.sets_without_link || 0),
      pending_legacy_mappings: Number(pendingLegacy?.n || 0),
    },
  };
}
