import type { Env } from '../types';

export async function runSnapshotSetValues(env: Env) {
  const result = await env.DB.prepare(`
    INSERT INTO set_value_history (set_num, snapshot_date, current_value, ebay_value, bl_value)
    SELECT s.set_num, DATE('now'), s.current_value,
           COALESCE(s.ebay_new_value, s.ebay_value), s.bl_new_value
    FROM lego_sets s
    WHERE s.set_num IN (
      SELECT set_num FROM user_collection WHERE deleted_at IS NULL
      UNION
      SELECT set_num FROM user_wishlist
    )
    ON CONFLICT (set_num, snapshot_date)
      DO UPDATE SET current_value = EXCLUDED.current_value,
        ebay_value = EXCLUDED.ebay_value,
        bl_value = EXCLUDED.bl_value
  `).run();

  return { snapshotted: result.meta.changes ?? 0 };
}
