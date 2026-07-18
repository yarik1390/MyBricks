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

// Day-over-day movers: after the 03:00 snapshot, flag sets whose displayed
// value jumped >= +40% or fell <= -40% overnight — excluding high-confidence
// blends, where a real market move is plausible and corroborated. Until now
// only the eBay-scrape writer had anomaly detection; this watches the OUTPUT
// (the value users see) regardless of which writer moved it. Rows land in
// pricing_anomalies, which the admin Pricing Center already renders.
const MOVER_MIN_PREV = 25;      // ignore penny sets — ratios there are noise
const MOVER_UP = 1.4;
const MOVER_DOWN = 0.6;
const MOVER_SEVERE_UP = 2.5;
const MOVER_SEVERE_DOWN = 0.4;
const MOVER_LIMIT = 200;

export async function detectValueMovers(env: Env) {
  if (!(await pricingWritesAllowed(env.DB))) {
    return { flagged: 0, resolved: 0, skipped: 'pricing write budget exhausted' };
  }

  const { results: movers } = await env.DB.prepare(`
    SELECT t.set_num, y.current_value AS prev, t.current_value AS curr
    FROM set_value_history t
    JOIN set_value_history y
      ON y.set_num = t.set_num AND y.snapshot_date = DATE('now', '-1 day')
    JOIN lego_sets ls ON ls.set_num = t.set_num
    WHERE t.snapshot_date = DATE('now')
      AND y.current_value >= ?1
      AND t.current_value IS NOT NULL
      AND (t.current_value >= ?2 * y.current_value OR t.current_value <= ?3 * y.current_value)
      AND COALESCE(ls.blended_confidence, '') != 'high'
    ORDER BY MAX(
      t.current_value / y.current_value,
      y.current_value / MAX(t.current_value, 0.01)
    ) DESC
    LIMIT ?4
  `).bind(MOVER_MIN_PREV, MOVER_UP, MOVER_DOWN, MOVER_LIMIT)
    .all<{ set_num: string; prev: number; curr: number }>();

  const stmts: D1PreparedStatement[] = [];
  for (const m of movers) {
    const ratio = m.prev > 0 ? m.curr / m.prev : 0;
    const severe = ratio >= MOVER_SEVERE_UP || ratio <= MOVER_SEVERE_DOWN;
    stmts.push(env.DB.prepare(`
      INSERT INTO pricing_anomalies (
        anomaly_key, set_num, condition, source, anomaly_type, severity,
        detail_json, status, first_seen_at, last_seen_at
      ) VALUES (?1, ?2, 'new_sealed', 'blend', 'day_move', ?3, ?4, 'open', datetime('now'), datetime('now'))
      ON CONFLICT(anomaly_key) DO UPDATE SET
        severity=excluded.severity, detail_json=excluded.detail_json,
        status='open', last_seen_at=datetime('now'), resolved_at=NULL
    `).bind(
      `blend:${m.set_num}:day_move`,
      m.set_num,
      severe ? 'error' : 'warning',
      JSON.stringify({ prev: m.prev, curr: m.curr, ratio: Math.round(ratio * 100) / 100 }),
    ));
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));

  // Auto-resolve open day_move rows whose set either reverted to within the
  // band today or has since earned a high-confidence blend — keeps the panel
  // showing only live problems without manual triage.
  const resolved = await env.DB.prepare(`
    UPDATE pricing_anomalies SET status='resolved', resolved_at=datetime('now')
    WHERE anomaly_type='day_move' AND status='open'
      AND (
        set_num IN (SELECT set_num FROM lego_sets WHERE blended_confidence = 'high')
        OR set_num IN (
          SELECT t.set_num
          FROM set_value_history t
          JOIN set_value_history y
            ON y.set_num = t.set_num AND y.snapshot_date = DATE('now', '-1 day')
          WHERE t.snapshot_date = DATE('now')
            AND y.current_value > 0 AND t.current_value IS NOT NULL
            AND t.current_value < ?1 * y.current_value
            AND t.current_value > ?2 * y.current_value
        )
      )
  `).bind(MOVER_UP, MOVER_DOWN).run().catch(() => null);

  const resolvedCount = Number(resolved?.meta?.changes || 0);
  await recordPricingWrites(env.DB, 'pricing-movers', movers.length + resolvedCount);
  return { flagged: movers.length, resolved: resolvedCount };
}
