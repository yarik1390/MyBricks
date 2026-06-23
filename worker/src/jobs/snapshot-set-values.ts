import type { Env } from '../types';

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

  // Prune ancient history so widening coverage never grows the table without
  // bound. Fails open — a prune hiccup must not fail the snapshot itself.
  let pruned = 0;
  try {
    const del = await env.DB.prepare(
      `DELETE FROM set_value_history WHERE snapshot_date < DATE('now', ?)`,
    ).bind(`-${HISTORY_RETENTION_DAYS} days`).run();
    pruned = (del.meta.changes as number | undefined) ?? 0;
  } catch (e) {
    console.warn('[snapshot] history prune failed:', (e as Error).message);
  }

  return { snapshotted: result.meta.changes ?? 0, pruned };
}
