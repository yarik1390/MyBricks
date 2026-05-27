import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const userId = getCallerId(req);
  const days = Math.min(parseInt(req.query.days || '90', 10), 365);
  const r = await db.query(`
    SELECT snapshot_date, total_value, total_paid, set_count
    FROM portfolio_snapshots
    WHERE user_id = $1 AND snapshot_date >= CURRENT_DATE - $2::int
    ORDER BY snapshot_date ASC
  `, [userId, days]);
  return res.json({ snapshots: r.rows });
}