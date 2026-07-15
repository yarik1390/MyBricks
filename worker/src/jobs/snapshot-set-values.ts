import type { Env } from '../types';
import { pricingWritesAllowed, recordPricingWrites } from '../lib/pricing-budget';

// Beyond the user's own collection/wishlist, also snapshot the highest-value
// catalog sets each day so their detail charts accumulate a real history line
// (not just "tracking just started"). Bounded so the daily insert and the table
// stay lean as coverage widens — the chart only needs the head of the catalog
// where price movement actually matters to investors.
const CATALOG_SNAPSHOT_TOP_N = 2000;

// Charts read at most 90 days; keep a wide margin for a future longer window
// while bounding table growth now that coverage extends past owned/wishlisted.
const HISTORY_RETENTION_DAYS = 400;

/**
 * Daily value snapshot into set_value_history, powering the trend chart and the
 * advisor's 90-day growth signal.
 *
 * Snapshots the AUTHORITATIVE displayed value — the blended market value when we
 * have one, falling back to current_value — so the chart is a true line of the
 * value the user actually sees, not the legacy single-source figure. Covers the
 * user's collection + wishlist plus the top-value head of the catalog, and
 * prunes ancient rows so the table stays bounded.
 */
export async function runSnapshotSetValues(env: Env) {
  const result = await env.DB.prepare(`
    INSERT INTO set_value_history (set_num, snapshot_date, current_value, ebay_value, bl_value)
    SELECT s.set_num, DATE('now'),
           COALESCE(NULLIF(s.blended_value, 0), s.current_value),
           COALESCE(s.ebay_new_value, s.ebay_value), s.bl_new_value
    FROM lego_sets s
    WHERE COALESCE(NULLIF(s.blended_value, 0), s.current_value) IS NOT NULL
      AND s.set_num IN (
        SELECT set_num FROM user_collection WHERE deleted_at IS NULL
        UNION
        SELECT set_num FROM user_wishlist
        UNION
        SELECT set_num FROM (
          SELECT set_num FROM lego_sets
          WHERE year >= 2000
            AND COALESCE(NULLIF(blended_value, 0), current_value) IS NOT NULL
          ORDER BY COALESCE(NULLIF(blended_value, 0), current_value) DESC
          LIMIT ?
        )
      )
    ON CONFLICT (set_num, snapshot_date)
      DO UPDATE SET current_value = EXCLUDED.current_value,
        ebay_value = EXCLUDED.ebay_value,
        bl_value = EXCLUDED.bl_value
  `).bind(CATALOG_SNAPSHOT_TOP_N).run();

  let v3Snapshotted = 0;
  if (await pricingWritesAllowed(env.DB)) {
    const v3 = await env.DB.prepare(`
      INSERT INTO set_valuation_history_v2 (
        set_num, condition, snapshot_date, fair_value, low, high, confidence, model_version
      )
      SELECT sv.set_num, sv.condition, date('now'), sv.fair_value, sv.low, sv.high,
             sv.confidence, 'v3'
      FROM set_valuation_state sv
      WHERE sv.fair_value IS NOT NULL AND sv.set_num IN (
        SELECT set_num FROM user_collection WHERE deleted_at IS NULL
        UNION SELECT set_num FROM user_wishlist
        UNION SELECT set_num FROM (
          SELECT set_num FROM set_valuation_state
          WHERE condition='new_sealed' AND fair_value IS NOT NULL
          ORDER BY fair_value DESC LIMIT ?
        )
      )
      ON CONFLICT(set_num, condition, snapshot_date) DO UPDATE SET
        fair_value=excluded.fair_value, low=excluded.low, high=excluded.high,
        confidence=excluded.confidence, model_version='v3'
      WHERE set_valuation_history_v2.fair_value IS NOT excluded.fair_value
         OR set_valuation_history_v2.low IS NOT excluded.low
         OR set_valuation_history_v2.high IS NOT excluded.high
         OR set_valuation_history_v2.confidence IS NOT excluded.confidence
    `).bind(CATALOG_SNAPSHOT_TOP_N).run().catch(() => null);
    v3Snapshotted = Number(v3?.meta?.changes || 0);
    await recordPricingWrites(env.DB, 'valuation-history-v2', v3Snapshotted);
  }

  // Mirror the snapshot for minifigs that carry a real market value (the
  // populated population — owned/CMF/popular figs the valuation job prices), so
  // their detail pages get the same 90-day trend line. Naturally bounded to
  // priced figs; commons on the rarity fallback are excluded.
  let figSnapshotted = 0;
  try {
    const figRes = await env.DB.prepare(`
      INSERT INTO minifig_value_history (fig_num, snapshot_date, current_value, ebay_value)
      SELECT m.fig_num, DATE('now'), m.current_value, m.ebay_value
      FROM minifigs m
      WHERE m.current_value IS NOT NULL AND m.current_value > 0
      ON CONFLICT (fig_num, snapshot_date)
        DO UPDATE SET current_value = EXCLUDED.current_value, ebay_value = EXCLUDED.ebay_value
    `).run();
    figSnapshotted = (figRes.meta.changes as number | undefined) ?? 0;
  } catch (e) {
    console.warn('[snapshot] minifig snapshot failed:', (e as Error).message);
  }

  // Prune ancient history so widening coverage never grows the tables without
  // bound. Fails open — a prune hiccup must not fail the snapshot itself.
  let pruned = 0;
  try {
    const cutoff = `-${HISTORY_RETENTION_DAYS} days`;
    const del = await env.DB.prepare(
      `DELETE FROM set_value_history WHERE snapshot_date < DATE('now', ?)`,
    ).bind(cutoff).run();
    pruned = (del.meta.changes as number | undefined) ?? 0;
    await env.DB.prepare(
      `DELETE FROM minifig_value_history WHERE snapshot_date < DATE('now', ?)`,
    ).bind(cutoff).run().catch(() => {});
    const v3Prune = await env.DB.prepare(
      `DELETE FROM set_valuation_history_v2 WHERE snapshot_date < DATE('now', ?)`,
    ).bind(cutoff).run().catch(() => null);
    pruned += Number(v3Prune?.meta?.changes || 0);
  } catch (e) {
    console.warn('[snapshot] history prune failed:', (e as Error).message);
  }

  return { snapshotted: result.meta.changes ?? 0, v3Snapshotted, figSnapshotted, pruned };
}
