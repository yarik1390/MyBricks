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
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'set_value_history']);
  });

  it('backfills the confidence band for a valued set that predates calibration', async () => {
    // blended_value set but blended_low NULL = the pre-v2.2 cohort this job heals.
    await db.prepare(
      `INSERT INTO lego_sets (set_num, name, valuation_method, blended_value, blended_low, bl_new_value, bl_new_qty, bl_cached_at)
       VALUES ('X-1','X','market', 100, NULL, 100, 8, datetime('now'))`,
    ).run();

    const r = await runBlendRecomputeBackfill(env as any);
    expect(r).toMatchObject({ candidates: 1, recomputed: 1 });
    const row = await db.prepare(`SELECT blended_low, blended_high FROM lego_sets WHERE set_num='X-1'`).first<{ blended_low: number; blended_high: number }>();
    expect(row!.blended_low).toBeGreaterThan(0); // band now populated
    expect(row!.blended_high).toBeGreaterThanOrEqual(row!.blended_low);
  });

  it('finds no candidates when every valued set already has a band', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, blended_low, blended_high) VALUES ('Y-1','Y', 50, 45, 55)`).run();
    const r = await runBlendRecomputeBackfill(env as any);
    expect(r.candidates).toBe(0);
    expect(r.recomputed).toBe(0);
  });
});
