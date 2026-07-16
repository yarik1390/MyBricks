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

  it('backfills retail_price from brickset_msrp/be_retail and heals formula rows that wildly disagree', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp, be_retail) VALUES ('A-1','A', NULL, 49.99, NULL)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp, be_retail) VALUES ('B-1','B', NULL, NULL, 30)`),
      // Formula placeholder ($10) vs authoritative MSRP ($999) — the 21065
      // "Retail $9.90 on an $800 set" bug; MSRP must win.
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp, be_retail) VALUES ('C-1','C', 10, 999, 999)`),
      // Non-formula rows keep their retail even when MSRP disagrees.
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp, be_retail, valuation_method) VALUES ('D-1','D', 10, 999, 999, 'bricklink')`),
      // Formula rows within 2x of MSRP are plausible — untouched.
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp, be_retail) VALUES ('E-1','E', 60, 99.99, NULL)`),
    ]);

    const r = await runDbHygiene(env as any);

    expect(r.retailBackfilled).toBe(3);
    const rows = await db.prepare(`SELECT set_num, retail_price FROM lego_sets ORDER BY set_num`).all<{ set_num: string; retail_price: number }>();
    expect(rows.results).toEqual([
      { set_num: 'A-1', retail_price: 49.99 }, // from brickset_msrp
      { set_num: 'B-1', retail_price: 30 },    // from be_retail (COALESCE fallback)
      { set_num: 'C-1', retail_price: 999 },   // formula placeholder healed from MSRP
      { set_num: 'D-1', retail_price: 10 },    // non-formula valuation — untouched
      { set_num: 'E-1', retail_price: 60 },    // formula but plausible — untouched
    ]);
  });

  it('sets coming-soon current_value to retail for formula-valued sets', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, current_value, lego_availability) VALUES ('CS-1','CS', 799.99, 9.9, 'coming_soon')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, current_value, lego_availability, valuation_method) VALUES ('CS-2','CS2', 100, 250, 'coming_soon', 'bricklink')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, current_value) VALUES ('RL-1','Released', 100, 250)`),
    ]);

    const r = await runDbHygiene(env as any);

    expect(r.comingSoonHealed).toBe(1);
    const cs = await db.prepare(`SELECT current_value FROM lego_sets WHERE set_num='CS-1'`).first<{ current_value: number }>();
    expect(cs!.current_value).toBe(799.99);
    const market = await db.prepare(`SELECT current_value FROM lego_sets WHERE set_num='CS-2'`).first<{ current_value: number }>();
    expect(market!.current_value).toBe(250); // market-valued — untouched
    const rl = await db.prepare(`SELECT current_value FROM lego_sets WHERE set_num='RL-1'`).first<{ current_value: number }>();
    expect(rl!.current_value).toBe(250); // released — untouched
  });

  it('scrubs a fabricated retail echo (BE scrape copied value into retail)', async () => {
    await db.batch([
      // Ole Kirk's House case: retail = be_retail = be_value_new = $13,037, no MSRP.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pieces, retail_price, be_retail, be_value_new, current_value, valuation_method) VALUES ('LIT-1','Echo', 910, 13037, 13037, 13037, 13037, 'brickeconomy')`),
      // New set legitimately worth exactly RRP, MSRP-corroborated — untouched.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pieces, retail_price, brickset_msrp, be_retail, be_value_new, current_value, valuation_method) VALUES ('NEW-1','New', 9000, 799.99, 799.99, 799.99, 799.99, 799.99, 'brickeconomy')`),
      // Cheap echo under the $500 bar — untouched (plenty of legit sets there).
      db.prepare(`INSERT INTO lego_sets (set_num, name, pieces, retail_price, be_retail, be_value_new, current_value, valuation_method) VALUES ('CHP-1','Cheap', 500, 49.99, 49.99, 49.99, 49.99, 'brickeconomy')`),
    ]);

    const r = await runDbHygiene(env as any);

    expect(r.retailEchoScrubbed).toBe(1);
    const echo = await db.prepare(`SELECT retail_price, be_retail FROM lego_sets WHERE set_num='LIT-1'`).first<{ retail_price: number | null; be_retail: number | null }>();
    expect(echo!.retail_price).toBeNull();
    expect(echo!.be_retail).toBeNull();
    const fresh = await db.prepare(`SELECT retail_price FROM lego_sets WHERE set_num='NEW-1'`).first<{ retail_price: number }>();
    expect(fresh!.retail_price).toBe(799.99);
  });

  it('re-formulas an implausible uncorroborated BrickEconomy value', async () => {
    await db.batch([
      // Volcanic Panic case: $15,000 on 177 pieces, retail fed by the same
      // scrape (retail_price = be_retail), nothing independent behind it.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pieces, year, theme, minifigs, retired, retail_price, be_retail, be_value_new, current_value, valuation_method) VALUES ('VP-1','Junk', 177, 2000, 'FIRST LEGO League', 1, 1, 4999, 4999, 15000, 15000, 'brickeconomy')`),
      // Plausible ultra-rare ($14.3/piece) — kept even without corroboration.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pieces, year, theme, retired, current_value, valuation_method) VALUES ('OK-1','Rare', 910, 2009, 'Promotional', 1, 13037, 'brickeconomy')`),
      // High value but corroborated by a real comp — untouched.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pieces, year, current_value, bl_new_value, valuation_method) VALUES ('CORR-1','Backed', 5198, 2007, 2983, 2900, 'brickeconomy')`),
    ]);

    const r = await runDbHygiene(env as any);

    expect(r.beValuesHealed).toBe(1);
    const healed = await db.prepare(`SELECT current_value, valuation_method, be_value_new, retail_price FROM lego_sets WHERE set_num='VP-1'`).first<{ current_value: number; valuation_method: string; be_value_new: number | null; retail_price: number | null }>();
    expect(healed!.valuation_method).toBe('formula_bulk');
    expect(healed!.current_value).toBeLessThan(200); // formula scale, not $15k
    expect(healed!.be_value_new).toBeNull();
    expect(healed!.retail_price).toBeNull(); // scrape-fed retail dropped with it
    const rare = await db.prepare(`SELECT current_value, valuation_method FROM lego_sets WHERE set_num='OK-1'`).first<{ current_value: number; valuation_method: string }>();
    expect(rare!.current_value).toBe(13037);
    expect(rare!.valuation_method).toBe('brickeconomy');
    const backed = await db.prepare(`SELECT current_value FROM lego_sets WHERE set_num='CORR-1'`).first<{ current_value: number }>();
    expect(backed!.current_value).toBe(2983);
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
