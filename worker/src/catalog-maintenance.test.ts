/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runDailyCatalogMaintenance, runDailyEbayMaintenance } from './jobs/catalog-maintenance';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
// eBay sold comps OFF → runEbayBackfill short-circuits, so runDailyEbayMaintenance
// exercises the run-bookkeeping wrapper (startRun/completeRun) with no network.
const e = { ...env, EBAY_SOLD_COMPS_ENABLED: '' } as any;

describe('catalog-maintenance', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_minifigs', 'import_runs', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health']);
  });

  it('syncs drifted minifig counts and skips the heavy jobs while a run is active', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, minifigs) VALUES ('X-1','X', 0)`),
      db.prepare(`INSERT INTO set_minifigs (set_num, fig_num, quantity) VALUES ('X-1','f1', 1)`),
      db.prepare(`INSERT INTO set_minifigs (set_num, fig_num, quantity) VALUES ('X-1','f2', 1)`),
      // A fresh 'running' row → activeRun() returns it → the barcode/valuation/ebay
      // sub-jobs must be skipped.
      db.prepare(`INSERT INTO import_runs (job_type, status) VALUES ('daily','running')`),
    ]);

    const r: any = await runDailyCatalogMaintenance(e);
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/already active/);
    expect(r.minifigCounts.synced).toBe(1); // count drift healed regardless of the lock

    const set = await db.prepare(`SELECT minifigs FROM lego_sets WHERE set_num='X-1'`).first<{ minifigs: number }>();
    expect(set!.minifigs).toBe(2);
    const runs = await db.prepare(`SELECT COUNT(*) AS n FROM import_runs`).first<{ n: number }>();
    expect(runs!.n).toBe(1); // no new run rows created (sub-jobs skipped)
  });

  it('records a completed import_run even when the eBay sub-job is disabled', async () => {
    const r: any = await runDailyEbayMaintenance(e, 2);
    expect(r.skipped).toMatch(/ebay disabled in source tuning|ebay sold comps disabled/);
    const run = await db.prepare(`SELECT status, job_type FROM import_runs ORDER BY id DESC LIMIT 1`).first<{ status: string; job_type: string }>();
    expect(run!.status).toBe('completed');
    expect(run!.job_type).toBe('daily');
  });
});
