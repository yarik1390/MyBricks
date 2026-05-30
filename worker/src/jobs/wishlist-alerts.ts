import type { Env } from '../types';

export async function runWishlistAlerts(env: Env) {
  const { results } = await env.DB.prepare(`
    SELECT w.id, w.user_id, w.set_num, w.target_price, w.alerted_at,
           s.name as set_name, s.current_value
    FROM user_wishlist w
    JOIN lego_sets s ON s.set_num = w.set_num
    WHERE w.target_price IS NOT NULL
      AND s.current_value <= w.target_price
      AND (w.alerted_at IS NULL OR w.alerted_at < datetime('now', '-7 days'))
  `).all<{ id: number; user_id: string; set_num: string; target_price: number; set_name: string; current_value: number }>();

  let fired = 0;
  for (const row of results) {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO wishlist_alerts (user_id, set_num, set_name, target_price, current_value)
        VALUES (?, ?, ?, ?, ?)
      `).bind(row.user_id, row.set_num, row.set_name, row.target_price, row.current_value),
      env.DB.prepare(
        `UPDATE user_wishlist SET alerted_at=datetime('now') WHERE id=?`
      ).bind(row.id),
    ]);
    fired++;
  }

  return { fired };
}
