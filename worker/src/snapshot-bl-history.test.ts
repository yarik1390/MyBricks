/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runSnapshotSetValues } from './jobs/snapshot-set-values';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

/**
 * BrickLink's permission covers displaying its guide content for at most 24 hours
 * and does not extend to historical retention, so set_value_history must not
 * accumulate raw BrickLink guide values — and the 61,025 rows written before that
 * rule existed had to be purged exactly once.
 */
describe('set value history holds no raw BrickLink guide values', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_value_history', 'portfolio_snapshots', 'app_settings',
      'user_collection', 'user_wishlist',
    ]);
  });

  it('writes NULL for bl_value and keeps our own derived columns', async () => {
    await db.prepare(
      `INSERT INTO lego_sets (set_num, name, theme, pieces, year, current_value, ebay_value, bl_new_value, bl_cached_at)
       VALUES ('10026-1','S','Icons', 1000, 2020, 500, 480, 510, datetime('now'))`,
    ).run();

    const result = await runSnapshotSetValues(env as any);
    expect(result.snapshotted).toBeGreaterThan(0);

    const row = await db.prepare(
      `SELECT current_value, ebay_value, bl_value FROM set_value_history WHERE set_num='10026-1'`,
    ).first<{ current_value: number; ebay_value: number; bl_value: number | null }>();
    expect(row).toBeTruthy();
    expect(row?.current_value).toBe(500);
    // eBay ask/sold is not BrickLink guide data and stays.
    expect(row?.ebay_value).toBe(480);
    // The BrickLink guide figure must never be persisted as history.
    expect(row?.bl_value).toBeNull();
  });

  it('purges pre-existing raw guide values once, guarded so the nightly job does not re-scan', async () => {
    // Rows written under the old rule.
    await db.prepare(
      `INSERT INTO lego_sets (set_num, name, theme, pieces, year, current_value) VALUES ('10027-1','S','Icons', 900, 2020, 600)`,
    ).run();
    await db.prepare(
      `INSERT INTO set_value_history (set_num, snapshot_date, current_value, ebay_value, bl_value)
       VALUES ('10027-1', date('now','-30 days'), 590, 570, 585),
              ('10027-1', date('now','-29 days'), 592, 572, 588)`,
    ).run();

    const first = await runSnapshotSetValues(env as any);
    expect(first.purgedGuideRows).toBeGreaterThanOrEqual(2);

    const left = await db.prepare(
      `SELECT COUNT(*) AS n FROM set_value_history WHERE bl_value IS NOT NULL`,
    ).first<{ n: number }>();
    expect(left?.n).toBe(0);

    const guard = await db.prepare(
      `SELECT value FROM app_settings WHERE key='pricing_bl_history_purged'`,
    ).first<{ value: string }>();
    expect(guard?.value).toBe('done');

    // Second run must not re-run the purge.
    const second = await runSnapshotSetValues(env as any);
    expect(second.purgedGuideRows).toBe(0);
  });
});
