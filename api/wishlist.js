import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  const userId = getCallerId(req);

  if (req.method === 'GET') {
    const [wl, alerts] = await Promise.all([
      db.query(`
        SELECT w.id, w.set_num, w.target_price, w.notes, w.added_at, w.alerted_at,
          s.name, s.theme, s.year, s.image_url, s.current_value, s.forecast_2y, s.retail_price
        FROM user_wishlist w
        JOIN lego_sets s ON s.set_num = w.set_num
        WHERE w.user_id = $1
        ORDER BY w.added_at DESC
      `, [userId]),
      db.query(`
        SELECT * FROM wishlist_alerts
        WHERE user_id = $1 AND read_at IS NULL
        ORDER BY triggered_at DESC
      `, [userId]),
    ]);
    return res.json({ wishlist: wl.rows, unread_alerts: alerts.rows });
  }

  const { set_num, target_price, notes } = req.body;
  if (!set_num) return res.status(400).json({ error: 'set_num required' });
  const r = await db.query(`
    INSERT INTO user_wishlist (user_id, set_num, target_price, notes)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, set_num) DO UPDATE SET
      target_price = COALESCE(EXCLUDED.target_price, user_wishlist.target_price),
      notes = COALESCE(EXCLUDED.notes, user_wishlist.notes)
    RETURNING *
  `, [userId, set_num, target_price || null, notes || null]);
  return res.status(201).json({ item: r.rows[0] });
}