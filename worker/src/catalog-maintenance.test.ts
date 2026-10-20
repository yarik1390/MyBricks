/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runDailyCatalogMaintenance } from './jobs/catalog-maintenance';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const e = { ...env } as any;

describe('catalog-maintenance', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_minifigs', 'import_runs', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health']);
  });

  it('syncs drifted minifig counts and skips the heavy jobs while a run is active', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, minifigs) VALUES ('X-1','X', 0)`),
      db.prepare(`INSERT INTO set_minifigs (set_num, fig_num, quantity) VALUES ('X-1','f1', 1)`),
      db.prepare(`INSERT INTO set_minifigs (set_num, fig_num, quantity) VALUES ('X-1','f2', 1)`),
      // A fresh 'running' row → activeRun() returns it → the barcode/valuation
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
});
