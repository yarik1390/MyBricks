import { db } from 'hatchable';

export const access = 'scheduler';
export const methods = ['POST'];

// Daily snapshot of current_value for every set a user owns or wishlists, so
// set_value_history accrues a real price trend over time. Runs at 03:00, after
// valuations (hourly) and the portfolio snapshot (02:00).
export default async function (req, res) {
  const r = await db.query(`
    INSERT INTO set_value_history (set_num, snapshot_date, current_value)
    SELECT s.set_num, CURRENT_DATE, s.current_value
    FROM lego_sets s
    WHERE s.set_num IN (
      SELECT set_num FROM user_collection WHERE deleted_at IS NULL
      UNION
      SELECT set_num FROM user_wishlist
    )
    ON CONFLICT (set_num, snapshot_date)
      DO UPDATE SET current_value = EXCLUDED.current_value
  `);
  return res.json({ snapshotted: r.rowCount ?? 0 });
}
