import type { Env } from '../types';

export async function runSnapshotPortfolios(env: Env) {
  // Query stats for all users in a single query
  const { results } = await env.DB.prepare(`
    SELECT
      uc.user_id,
      COALESCE(SUM(s.current_value * uc.quantity), 0) as total_value,
      COALESCE(SUM(COALESCE(uc.purchase_price, 0) * uc.quantity), 0) as total_paid,
      CAST(COUNT(uc.id) AS INTEGER) as set_count
    FROM user_collection uc
    JOIN lego_sets s ON s.set_num = uc.set_num
    WHERE uc.deleted_at IS NULL
    GROUP BY uc.user_id
  `).all<{ user_id: string; total_value: number; total_paid: number; set_count: number }>();

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
