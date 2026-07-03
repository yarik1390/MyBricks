/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runSnapshotPortfolios } from './jobs/snapshot-portfolios';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runSnapshotPortfolios', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'portfolio_snapshots']);
  });

  it('snapshots nothing when no user owns anything', async () => {
    expect(await runSnapshotPortfolios(env as any)).toEqual({ snapped: 0 });
  });

  it('sums blended-or-current value × quantity and paid, excluding soft-deleted rows', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, current_value) VALUES ('A-1','A', 100, 90)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, current_value) VALUES ('B-1','B', NULL, 50)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value) VALUES ('C-1','C', 999)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, purchase_price, deleted_at) VALUES ('u1','A-1', 2, 40, NULL)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, purchase_price, deleted_at) VALUES ('u1','B-1', 1, 30, NULL)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, purchase_price, deleted_at) VALUES ('u1','C-1', 5, 500, datetime('now'))`), // soft-deleted → excluded
    ]);

    const r = await runSnapshotPortfolios(env as any);
    expect(r).toEqual({ snapped: 1 });

    const row = await db.prepare(`SELECT total_value, total_paid, set_count FROM portfolio_snapshots WHERE user_id='u1'`)
      .first<{ total_value: number; total_paid: number; set_count: number }>();
    expect(row!.total_value).toBe(250); // 100*2 (blended) + 50*1 (current fallback)
    expect(row!.total_paid).toBe(110);  // 40*2 + 30*1
    expect(row!.set_count).toBe(2);     // deleted C-1 not counted
  });

  it('is idempotent for the same day (upsert, not duplicate rows)', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value) VALUES ('A-1','A', 60)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, purchase_price) VALUES ('u1','A-1', 1, 20)`),
    ]);
    await runSnapshotPortfolios(env as any);
    await runSnapshotPortfolios(env as any); // same day again

    const n = await db.prepare(`SELECT COUNT(*) AS n FROM portfolio_snapshots WHERE user_id='u1'`).first<{ n: number }>();
    expect(n!.n).toBe(1);
    const row = await db.prepare(`SELECT total_value FROM portfolio_snapshots WHERE user_id='u1'`).first<{ total_value: number }>();
    expect(row!.total_value).toBe(60);
  });
});
