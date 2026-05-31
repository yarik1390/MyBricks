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

  if (!results.length) return { fired: 0 };

  const stmts: D1PreparedStatement[] = [];
  for (const row of results) {
    stmts.push(
      env.DB.prepare(`
        INSERT INTO wishlist_alerts (user_id, set_num, set_name, target_price, current_value)
        VALUES (?, ?, ?, ?, ?)
      `).bind(row.user_id, row.set_num, row.set_name, row.target_price, row.current_value),
      env.DB.prepare(
        `UPDATE user_wishlist SET alerted_at=datetime('now') WHERE id=?`
      ).bind(row.id),
    );
  }

  await env.DB.batch(stmts);

  const spike = await runSpikeAlerts(env);
  return { fired: results.length, spikes: spike.fired };
}

async function runSpikeAlerts(env: Env): Promise<{ fired: number }> {
  const { results } = await env.DB.prepare(`
    SELECT uc.id as collection_id, uc.user_id, uc.set_num, uc.purchase_price,
           ls.name as set_name, ls.current_value
    FROM user_collection uc
    JOIN lego_sets ls ON ls.set_num = uc.set_num
    WHERE uc.purchase_price > 0
      AND ls.current_value > 1.30 * uc.purchase_price
      AND uc.deleted_at IS NULL
      AND (uc.spike_alerted_at IS NULL OR uc.spike_alerted_at < datetime('now', '-30 days'))
  `).all<{
    collection_id: number; user_id: string; set_num: string;
    purchase_price: number; set_name: string; current_value: number;
  }>();

  if (!results.length) return { fired: 0 };

  const stmts: D1PreparedStatement[] = [];
  for (const row of results) {
    stmts.push(
      env.DB.prepare(`
        INSERT INTO wishlist_alerts (user_id, set_num, set_name, target_price, current_value, alert_type)
        VALUES (?, ?, ?, ?, ?, 'spike')
      `).bind(row.user_id, row.set_num, row.set_name, row.purchase_price, row.current_value),
      env.DB.prepare(
        `UPDATE user_collection SET spike_alerted_at=datetime('now') WHERE id=?`
      ).bind(row.collection_id),
    );
  }
  await env.DB.batch(stmts);
  return { fired: results.length };
}
