/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runSnapshotPortfolios } from './jobs/snapshot-portfolios';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

/**
 * The portfolio history endpoints cap READS at 90 days (free) / 365 (Pro), and
 * nothing deleted the rows behind them — so a user's portfolio totals accumulated
 * forever while the product implied a one-year window. Retention is now enforced
 * at the write path.
 */
describe('portfolio snapshot retention', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'portfolio_snapshots', 'set_valuation_state']);
  });

  it('deletes snapshots past the retention window and keeps the recent ones', async () => {
    await db.prepare(
      `INSERT INTO lego_sets (set_num, name, theme, pieces, year, current_value)
       VALUES ('10276-1','Colosseum','Icons', 9036, 2020, 550)`,
    ).run();
    await db.prepare(
      `INSERT INTO user_collection (user_id, set_num, condition, quantity, purchase_price)
       VALUES ('u1','10276-1','new',1,400)`,
    ).run();
    await db.prepare(
      `INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, total_paid, set_count)
       VALUES ('u1', date('now','-500 days'), 100, 90, 1),
              ('u1', date('now','-399 days'), 200, 190, 1),
              ('u1', date('now','-10 days'), 300, 290, 1)`,
    ).run();

    const result = await runSnapshotPortfolios(env as any);
    expect(result.pruned).toBe(1);

    const dates = await db.prepare(
      `SELECT snapshot_date FROM portfolio_snapshots WHERE user_id='u1' ORDER BY snapshot_date ASC`,
    ).all<{ snapshot_date: string }>();
    const kept = dates.results.map(r => r.snapshot_date);
    expect(kept).toHaveLength(3); // -399, -10, and today's fresh snapshot
    expect(kept.some(d => d.startsWith(String(new Date(Date.now() - 500 * 864e5).toISOString().slice(0, 10))))).toBe(false);
  });
});
