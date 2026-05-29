import { db } from 'hatchable';

export const access = 'member';
export const methods = ['GET'];

// Real price history for a single set, accrued by api/jobs/snapshot-set-values.
// Mirrors api/collection/history.js. Returns ascending so the chart can draw
// left-to-right without re-sorting.
export default async function (req, res) {
  const setNum = req.params.setnum;
  const days = Math.min(parseInt(req.query.days || '90', 10), 365);
  const r = await db.query(`
    SELECT snapshot_date, current_value
    FROM set_value_history
    WHERE set_num = $1 AND snapshot_date >= CURRENT_DATE - $2::int
    ORDER BY snapshot_date ASC
  `, [setNum, days]);
  return res.json({ history: r.rows, days });
}
