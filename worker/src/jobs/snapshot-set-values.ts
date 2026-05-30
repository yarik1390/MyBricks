import type { Env } from '../types';

export async function runSnapshotSetValues(env: Env) {
  const result = await env.DB.prepare(`
    INSERT INTO set_value_history (set_num, snapshot_date, current_value)
    SELECT s.set_num, DATE('now'), s.current_value
    FROM lego_sets s
    WHERE s.set_num IN (
      SELECT set_num FROM user_collection WHERE deleted_at IS NULL
      UNION
      SELECT set_num FROM user_wishlist
    )
    ON CONFLICT (set_num, snapshot_date)
      DO UPDATE SET current_value = EXCLUDED.current_value
  `).run();

  return { snapshotted: result.meta.changes ?? 0 };
}
