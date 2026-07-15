import type { Env } from '../types';
import { holdingValueForRollout } from '../lib/market-sources';

export async function runSnapshotPortfolios(env: Env) {
  // Read holdings once, then use the same deterministic rollout basis as every
  // portfolio endpoint. SQL cannot reproduce the per-set rollout hash safely.
  const { results: holdings } = await env.DB.prepare(`
    SELECT
      uc.user_id, uc.set_num, uc.condition, uc.quantity, uc.purchase_price,
      s.current_value, s.blended_value, s.used_value,
      s.ebay_used_value, s.bo_used_value,
      svn.fair_value AS v3_new_fair, svu.fair_value AS v3_used_fair
    FROM user_collection uc
    JOIN lego_sets s ON s.set_num = uc.set_num
    LEFT JOIN set_valuation_state svn ON svn.set_num=s.set_num AND svn.condition='new_sealed'
    LEFT JOIN set_valuation_state svu ON svu.set_num=s.set_num AND svu.condition='used_complete'
    WHERE uc.deleted_at IS NULL
  `).all<Record<string, unknown>>();

  const rolloutPercent = Number(env.PRICING_V3_READ_PERCENT || 0);
  const byUser = new Map<string, { user_id: string; total_value: number; total_paid: number; set_count: number }>();
  for (const row of holdings) {
    const userId = String(row.user_id);
    const stats = byUser.get(userId) || { user_id: userId, total_value: 0, total_paid: 0, set_count: 0 };
    const quantity = Number(row.quantity || 1);
    stats.total_value += holdingValueForRollout(row, rolloutPercent) * quantity;
    stats.total_paid += Number(row.purchase_price || 0) * quantity;
    stats.set_count += 1;
    byUser.set(userId, stats);
  }
  const results = [...byUser.values()];

  if (!results.length) return { snapped: 0 };

  const stmts = results.map(stats => {
    return env.DB.prepare(`
      INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, total_paid, set_count)
      VALUES (?, DATE('now'), ?, ?, ?)
      ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
        total_value=?, total_paid=?, set_count=?, snapshot_at=datetime('now')
    `).bind(stats.user_id, stats.total_value, stats.total_paid, stats.set_count,
            stats.total_value, stats.total_paid, stats.set_count);
  });

  // Batch-execute statements in chunks of 100
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }

  return { snapped: results.length };
}
