import { db } from 'hatchable';

export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  const r = await db.query(`
    SELECT w.id, w.user_id, w.set_num, w.target_price, w.alerted_at,
           s.name as set_name, s.current_value
    FROM user_wishlist w
    JOIN lego_sets s ON s.set_num = w.set_num
    WHERE w.target_price IS NOT NULL
      AND s.current_value <= w.target_price
      AND (w.alerted_at IS NULL OR w.alerted_at < now() - interval '7 days')
  `);

  let fired = 0;
  for (const row of r.rows) {
    await db.query(`
      INSERT INTO wishlist_alerts (user_id, set_num, set_name, target_price, current_value)
      VALUES ($1, $2, $3, $4, $5)
    `, [row.user_id, row.set_num, row.set_name, row.target_price, row.current_value]);
    await db.query(
      'UPDATE user_wishlist SET alerted_at=now() WHERE id=$1',
      [row.id]
    );
    fired++;
  }

  return res.json({ fired });
}