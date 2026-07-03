/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runSnapshotSetValues } from './jobs/snapshot-set-values';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runSnapshotSetValues', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'set_value_history', 'minifigs', 'minifig_value_history']);
  });

  it('snapshots the displayed value for owned sets and priced minifigs, and prunes ancient rows', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, current_value, bl_new_value) VALUES ('X-1','X', 100, 90, 70)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('u1','X-1')`),
      db.prepare(`INSERT INTO minifigs (fig_num, name, current_value, ebay_value) VALUES ('fig-1','Luke', 25, 20)`),
      // Ancient history row (>400d) that must be pruned this run.
      db.prepare(`INSERT INTO set_value_history (set_num, snapshot_date, current_value) VALUES ('X-1', DATE('now','-500 days'), 10)`),
    ]);

    const r = await runSnapshotSetValues(env as any);

    expect(r.snapshotted).toBeGreaterThanOrEqual(1);
    expect(r.figSnapshotted).toBe(1);
    expect(r.pruned).toBe(1); // the 500-day-old row

    const today = await db.prepare(`SELECT current_value FROM set_value_history WHERE set_num='X-1' AND snapshot_date = DATE('now')`).first<{ current_value: number }>();
    expect(today!.current_value).toBe(100); // blended value preferred over current_value
    const fig = await db.prepare(`SELECT current_value FROM minifig_value_history WHERE fig_num='fig-1' AND snapshot_date = DATE('now')`).first<{ current_value: number }>();
    expect(fig!.current_value).toBe(25);
  });

  it('skips sets with no displayable value', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, current_value) VALUES ('N-1','N', NULL, NULL)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('u1','N-1')`),
    ]);
    const r = await runSnapshotSetValues(env as any);
    expect(r.snapshotted).toBe(0);
  });
});
