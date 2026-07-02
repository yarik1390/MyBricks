/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runDbHygiene } from './jobs/db-hygiene';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runDbHygiene', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'rate_limits', 'oauth_sessions', 'oauth_states', 'import_runs', 'cron_runs',
    ]);
  });

  it('deletes only rows past their retention window, keeping fresh ones', async () => {
    // rate_limits: one 50h-old window (stale) + one 1h-old (live).
    await db.batch([
      db.prepare(`INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count) VALUES ('u', 'e', datetime('now','-50 hours'), 1)`),
      db.prepare(`INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count) VALUES ('u', 'e', datetime('now','-1 hours'), 1)`),
    ]);
    // oauth_sessions / oauth_states: expires_at is unixepoch seconds. One expired
    // well past the 1-day grace, one still valid.
    await db.batch([
      db.prepare(`INSERT INTO oauth_sessions (code, user_id, expires_at) VALUES ('c1', 'u', unixepoch() - 200000)`),
      db.prepare(`INSERT INTO oauth_sessions (code, user_id, expires_at) VALUES ('c2', 'u', unixepoch() + 200000)`),
      db.prepare(`INSERT INTO oauth_states (state, user_id, expires_at) VALUES ('s1', 'u', unixepoch() - 200000)`),
      db.prepare(`INSERT INTO oauth_states (state, user_id, expires_at) VALUES ('s2', 'u', unixepoch() + 200000)`),
    ]);

    const r = await runDbHygiene(env as any);

    expect(r.deleted.rate_limits).toBe(1);
    expect(r.deleted.oauth_sessions).toBe(1);
    expect(r.deleted.oauth_states).toBe(1);
    const rl = await db.prepare(`SELECT COUNT(*) AS n FROM rate_limits`).first<{ n: number }>();
    expect(rl!.n).toBe(1); // the live window survives
  });

  it('prunes import_runs older than 30 days but always keeps the 20 most recent', async () => {
    // 25 rows, all older than 30 days, with distinct ages so ordering is stable.
    const stmts = [];
    for (let i = 0; i < 25; i++) {
      stmts.push(db.prepare(
        `INSERT INTO import_runs (job_type, status, started_at) VALUES ('t', 'done', datetime('now','-' || ?1 || ' days'))`,
      ).bind(40 + i));
    }
    await db.batch(stmts);

    const r = await runDbHygiene(env as any);

    // 25 total, keep the 20 newest → exactly the 5 oldest (still >30d) are dropped.
    expect(r.deleted.import_runs).toBe(5);
    const left = await db.prepare(`SELECT COUNT(*) AS n FROM import_runs`).first<{ n: number }>();
    expect(left!.n).toBe(20);
  });

  it('backfills retail_price from brickset_msrp/be_retail without touching rows that already have it', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp, be_retail) VALUES ('A-1','A', NULL, 49.99, NULL)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp, be_retail) VALUES ('B-1','B', NULL, NULL, 30)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp, be_retail) VALUES ('C-1','C', 10, 999, 999)`),
    ]);

    const r = await runDbHygiene(env as any);

    expect(r.retailBackfilled).toBe(2);
    const rows = await db.prepare(`SELECT set_num, retail_price FROM lego_sets ORDER BY set_num`).all<{ set_num: string; retail_price: number }>();
    expect(rows.results).toEqual([
      { set_num: 'A-1', retail_price: 49.99 }, // from brickset_msrp
      { set_num: 'B-1', retail_price: 30 },    // from be_retail (COALESCE fallback)
      { set_num: 'C-1', retail_price: 10 },    // untouched — already set
    ]);
  });

  it('sweeps orphaned running cron rows older than the window and reports the count', async () => {
    await db.batch([
      db.prepare(`INSERT INTO cron_runs (name, started_at, status) VALUES ('stuck', datetime('now','-40 minutes'), 'running')`),
      db.prepare(`INSERT INTO cron_runs (name, started_at, status) VALUES ('live', datetime('now'), 'running')`),
    ]);

    const r = await runDbHygiene(env as any);

    expect(r.staleCronRuns).toBe(1);
    const stuck = await db.prepare(`SELECT status FROM cron_runs WHERE name='stuck'`).first<{ status: string }>();
    expect(stuck!.status).toBe('failed');
    const live = await db.prepare(`SELECT status FROM cron_runs WHERE name='live'`).first<{ status: string }>();
    expect(live!.status).toBe('running'); // fresh run untouched
  });
});
