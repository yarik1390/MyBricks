import { db } from 'hatchable';

export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  const users = await db.query(
    `SELECT DISTINCT user_id FROM user_collection WHERE deleted_at IS NULL`
  );

  let snapped = 0;
  for (const { user_id } of users.rows) {
    const stats = await db.query(`
      SELECT
        COALESCE(SUM(s.current_value * uc.quantity), 0) as total_value,
        COALESCE(SUM(COALESCE(uc.purchase_price, 0) * uc.quantity), 0) as total_paid,
        COUNT(*) as set_count
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      WHERE uc.user_id=$1 AND uc.deleted_at IS NULL
    `, [user_id]);
    const { total_value, total_paid, set_count } = stats.rows[0];
    await db.query(`
      INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, total_paid, set_count)
      VALUES ($1, CURRENT_DATE, $2, $3, $4)
      ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
        total_value=$2, total_paid=$3, set_count=$4, snapshot_at=now()
    `, [user_id, total_value, total_paid, set_count]);
    snapped++;
  }

  return res.json({ snapped });
}