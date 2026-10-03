/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runDbHygiene } from './jobs/db-hygiene';
import { runBlendRecomputeBackfill } from './jobs/recompute-blends';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

beforeEach(async () => {
  await applyTestTables(db, [
    'lego_sets', 'rate_limits', 'scan_requests', 'scan_quota_reservations', 'admin_operation_claims',
    'oauth_sessions', 'oauth_states', 'import_runs', 'cron_runs',
    'set_market_ext', 'user_collection', 'user_wishlist', 'user_prefs', 'set_value_history',
    'set_valuation_state', 'pricing_write_ledger', 'pricing_signals', 'app_settings',
  ]);
});

describe('magazine gift retail', () => {
  it('clears a cover-price retail on a gift with no real MSRP', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, pieces, subtheme, retail_price, be_retail, valuation_method, current_value)
      VALUES ('112601-1', 'Lloyd vs. Dragonian Warrior', 2026, 14, 'Magazine Gift', 29.99, 29.99, 'brickeconomy', 7.02)`).run();
    const r = await runDbHygiene(env as any);
    expect(r.giftRetailScrubbed).toBe(1);
    const row = await db.prepare(`SELECT retail_price, be_retail FROM lego_sets WHERE set_num='112601-1'`).first<any>();
    expect(row.retail_price).toBeNull();
    expect(row.be_retail).toBeNull();
  });

  it('keeps a Brickset MSRP and ordinary sets, and drops a formula gift\'s synthetic retail', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, subtheme, retail_price, brickset_msrp, valuation_method) VALUES ('G-1', 'G', 'Magazine Gift', 4.99, 4.99, 'market')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, subtheme, retail_price, valuation_method) VALUES ('F-1', 'F', 'Magazine Gift', 3.83, 'formula_bulk')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, subtheme, retail_price, valuation_method) VALUES ('S-1', 'S', 'Modular Buildings', 229.99, 'market')`),
    ]);
    const r = await runDbHygiene(env as any);
    expect(r.giftRetailScrubbed).toBe(1);
    const { results } = await db.prepare(`SELECT retail_price FROM lego_sets ORDER BY set_num`).all<any>();
    expect(results.map((x: any) => x.retail_price)).toEqual([null, 4.99, 229.99]);
  });
});

describe('old sets retired', () => {
  it('flags decades-old sets that are not on sale', async () => {
    const y = new Date().getFullYear();
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired, lego_availability) VALUES ('1301-1', 'LEGO Mosaic, Large', 1955, 0, 'out_of_stock')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired, lego_in_stock) VALUES ('10179-1', 'Old but reissued', 2007, 0, 1)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired) VALUES ('75192-1', 'Millennium Falcon', 2017, 0)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired, lego_availability) VALUES ('10220-1', 'Temporarily out', 2011, 0, 'out_of_stock')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired, lego_availability) VALUES ('10030-1', 'Sold out', 2002, 0, 'sold_out')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired, exit_date) VALUES ('X-1', 'Dated', ?, 0, '2099-12-31')`).bind(y - 20),
    ]);
    const r = await runDbHygiene(env as any);
    expect(r.oldSetsRetired).toBe(2);
    const { results } = await db.prepare(`SELECT set_num, retired FROM lego_sets ORDER BY set_num`).all<any>();
    expect(Object.fromEntries(results.map((x: any) => [x.set_num, x.retired]))).toEqual({ '10030-1': 1, '10179-1': 0, '10220-1': 0, '1301-1': 1, '75192-1': 0, 'X-1': 0 });
  });
});

describe('suspect re-check lane', () => {
  it('re-derives low-confidence valuations outside the rotation page', async () => {
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO lego_sets (set_num, name) VALUES ('A-1', 'A')`).run();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method, retail_price, bl_new_value, bl_new_qty, bl_cached_at)
      VALUES ('Z-1', 'Z', 'market', 100, 150, 8, ?)`).bind(now).run();
    await db.prepare(`INSERT INTO set_valuation_state (set_num, condition, fair_value, confidence, flags_json, updated_at)
      VALUES ('Z-1', 'new_sealed', 9999, 'low', '["source_conflict"]', '2000-01-01')`).run();
    await runBlendRecomputeBackfill(env as any, { limit: 1 });
    const state = await db.prepare(`SELECT fair_value FROM set_valuation_state WHERE set_num='Z-1' AND condition='new_sealed'`).first<any>();
    expect(state.fair_value).not.toBe(9999);
    const cursor = await db.prepare(`SELECT value FROM app_settings WHERE key='suspect_recheck_cursor_v1'`).first<any>();
    expect(cursor.value).toBe('');
  });
});
