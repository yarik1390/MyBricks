/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runBlendRecomputeBackfill } from './jobs/recompute-blends';
import { resetSourceWeightMultipliers } from './lib/market-sources';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runBlendRecomputeBackfill', () => {
  beforeEach(async () => {
    resetSourceWeightMultipliers();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'set_value_history', 'set_valuation_state', 'pricing_write_ledger']);
  });

  it('backfills the confidence band for a valued set that predates calibration', async () => {
    // blended_value set but blended_low NULL = the pre-v2.2 cohort this job heals.
    await db.prepare(
      `INSERT INTO lego_sets (set_num, name, valuation_method, blended_value, blended_low, bl_new_value, bl_new_qty, bl_cached_at)
       VALUES ('X-1','X','market', 100, NULL, 100, 8, datetime('now'))`,
    ).run();

    const r = await runBlendRecomputeBackfill(env as any);
    expect(r).toMatchObject({ candidates: 1, recomputed: 3 });
    const row = await db.prepare(`SELECT blended_low, blended_high FROM lego_sets WHERE set_num='X-1'`).first<{ blended_low: number; blended_high: number }>();
    expect(row!.blended_low).toBeGreaterThan(0); // band now populated
    expect(row!.blended_high).toBeGreaterThanOrEqual(row!.blended_low);
  });

  it('finds no candidates when the set already has a v3 shadow state', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, blended_low, blended_high) VALUES ('Y-1','Y', 50, 45, 55)`).run();
    await db.prepare(`INSERT INTO set_valuation_state (set_num, condition, model_version) VALUES ('Y-1','new_sealed','v3-shadow')`).run();
    const r = await runBlendRecomputeBackfill(env as any);
    expect(r.candidates).toBe(0);
    expect(r.recomputed).toBe(0);
  });

  it('prioritizes PriceCharting-era rows and rewrites the legacy headline', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, blended_value) VALUES ('CLEAN-1','Clean',80,80)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method, current_value, blended_value, pc_new_value) VALUES ('PC-1','Bad mapping','formula_bulk',100,900,900)`),
    ]);
    const result = await runBlendRecomputeBackfill(env as any, { limit: 1 });
    expect(result.candidates).toBe(1);
    const cleaned = await db.prepare(`SELECT blended_value, deal_signal FROM lego_sets WHERE set_num='PC-1'`).first<any>();
    expect(cleaned.blended_value).toBe(100);
    expect(cleaned.deal_signal).toBeNull();
  });
});
