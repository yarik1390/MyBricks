import type { Env } from '../types';

export async function runSnapshotPortfolios(env: Env) {
  const { results: users } = await env.DB.prepare(
    'SELECT DISTINCT user_id FROM user_collection WHERE deleted_at IS NULL'
  ).all<{ user_id: string }>();

  let snapped = 0;
  for (const { user_id } of users) {
    const stats = await env.DB.prepare(`
      SELECT
        COALESCE(SUM(s.current_value * uc.quantity), 0) as total_value,
        COALESCE(SUM(COALESCE(uc.purchase_price, 0) * uc.quantity), 0) as total_paid,
        COUNT(*) as set_count
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      WHERE uc.user_id=? AND uc.deleted_at IS NULL
    `).bind(user_id).first<{ total_value: number; total_paid: number; set_count: number }>();

    if (!stats) continue;
    await env.DB.prepare(`
      INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, total_paid, set_count)
      VALUES (?, DATE('now'), ?, ?, ?)
      ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
        total_value=?, total_paid=?, set_count=?, snapshot_at=datetime('now')
    `).bind(user_id, stats.total_value, stats.total_paid, stats.set_count,
            stats.total_value, stats.total_paid, stats.set_count).run();
    snapped++;
  }

  return { snapped };
}
