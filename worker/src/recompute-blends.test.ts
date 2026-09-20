/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runBlendRecomputeBackfill } from './jobs/recompute-blends';
import * as marketSources from './lib/market-sources';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runBlendRecomputeBackfill', () => {
  beforeEach(async () => {
    marketSources.resetSourceWeightMultipliers();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'user_prefs', 'set_value_history', 'set_valuation_state', 'pricing_write_ledger', 'pricing_signals', 'app_settings']);
  });
  afterEach(() => vi.restoreAllMocks());

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

  it('revisits existing states for changed evidence and aging without refreshing sources', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method, bl_new_value, bl_new_qty, bl_cached_at, cached_at, valuation_expires_at)
      VALUES ('Y-1','Y','market',100,8,datetime('now'), '2020-01-01', '2020-02-01')`).run();
    await runBlendRecomputeBackfill(env as any);
    await db.prepare(`UPDATE lego_sets SET bl_new_value=200 WHERE set_num='Y-1'`).run();
    const snapshot = () => db.prepare(`SELECT bl_cached_at, cached_at, valuation_expires_at FROM lego_sets WHERE set_num='Y-1'`).first();
    const state = () => db.prepare(`SELECT fair_value, confidence_score, flags_json FROM set_valuation_state WHERE set_num='Y-1' AND condition='new_sealed'`).first<any>();
    const before = await snapshot();
    const first = await state();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await runBlendRecomputeBackfill(env as any)).candidates).toBe(1);
    expect((await state()).fair_value).not.toBe(first.fair_value);
    expect(await snapshot()).toEqual(before);
    // Aging input simulates passage of time without a source refresh.
    await db.prepare(`UPDATE lego_sets SET bl_cached_at='2000-01-01' WHERE set_num='Y-1'`).run();
    const agedSources = await snapshot();
    const fresh = await state();
    await runBlendRecomputeBackfill(env as any);
    expect(await state()).not.toEqual(fresh);
    expect(await snapshot()).toEqual(agedSources);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  const cursor = async () => (await db.prepare(`SELECT value FROM app_settings WHERE key='blend_recompute_cursor_v1'`).first<{ value: string }>())?.value;

  it('rotates bounded pages, including no-signal rows and wrap-around', async () => {
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      await db.prepare(`INSERT INTO lego_sets (set_num,name) VALUES (?,?)`).bind(id, id).run();
    }
    for (const expected of ['B', 'D', 'A', 'C', 'E']) {
      expect((await runBlendRecomputeBackfill(env as any, { limit: 2 })).candidates).toBe(2);
      expect(await cursor()).toBe(expected);
    }
    expect((await db.prepare(`SELECT COUNT(DISTINCT set_num) AS n FROM set_valuation_state`).first<any>()).n).toBe(5);
  });

  it('caps work at 400 and advances even when all writes are no-ops', async () => {
    await db.prepare(`WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<401)
      INSERT INTO lego_sets(set_num,name) SELECT printf('%04d',n),'Empty' FROM ids`).run();
    const result = await runBlendRecomputeBackfill(env as any, { limit: 999 });
    expect(result).toMatchObject({ candidates: 400, limit: 400 });
    expect(await cursor()).toBe('0400');
    await runBlendRecomputeBackfill(env as any, { limit: 1 });
    expect(await cursor()).toBe('0401');
    vi.spyOn(marketSources, 'recomputeBlendedValues').mockResolvedValueOnce(0);
    expect(await runBlendRecomputeBackfill(env as any, { limit: 0.5 })).toMatchObject({ candidates: 1, recomputed: 0, limit: 1 });
    expect(await cursor()).toBe('0001');
  });

  it('pauses without advancing the checkpoint when pricing writes are over budget', async () => {
    await db.prepare(`INSERT INTO lego_sets(set_num,name) VALUES ('A','A'),('B','B')`).run();
    await runBlendRecomputeBackfill(env as any, { limit: 1 });
    await db.prepare(`INSERT INTO pricing_write_ledger(day,job,rows_written) VALUES (date('now'),'test',1000000)`).run();
    expect(await runBlendRecomputeBackfill(env as any)).toMatchObject({ paused: true, candidates: 0, recomputed: 0 });
    expect(await cursor()).toBe('A');
  });

  it.each(['source read', 'history read', 'state write', 'checkpoint write'])('retries the same page after a failed %s', async (failure) => {
    await db.prepare(`INSERT INTO lego_sets(set_num,name) VALUES ('A','A'),('B','B')`).run();
    await runBlendRecomputeBackfill(env as any, { limit: 1 });
    if (failure === 'state write') {
      await db.prepare(`CREATE TRIGGER fail_state BEFORE INSERT ON set_valuation_state BEGIN SELECT RAISE(ABORT,'injected failure'); END`).run();
    } else if (failure === 'checkpoint write') {
      await db.prepare(`CREATE TRIGGER fail_cursor BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT,'injected failure'); END`).run();
    } else {
      await db.prepare(`ALTER TABLE ${failure === 'source read' ? 'pricing_signals' : 'set_value_history'} RENAME TO unavailable`).run();
    }
    await expect(runBlendRecomputeBackfill(env as any, { limit: 1 })).rejects.toThrow();
    expect(await cursor()).toBe('A');
    if (failure === 'source read' || failure === 'history read') {
      expect(await db.prepare(`SELECT set_num FROM set_valuation_state WHERE set_num='B'`).first()).toBeNull();
    }
    if (failure === 'state write') await db.prepare('DROP TRIGGER fail_state').run();
    else if (failure === 'checkpoint write') await db.prepare('DROP TRIGGER fail_cursor').run();
    else await db.prepare(`ALTER TABLE unavailable RENAME TO ${failure === 'source read' ? 'pricing_signals' : 'set_value_history'}`).run();
    expect((await runBlendRecomputeBackfill(env as any, { limit: 1 })).candidates).toBe(1);
    expect(await cursor()).toBe('B');
  });

  it('reaches PriceCharting-era rows without starving other rows', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, blended_value) VALUES ('CLEAN-1','Clean',80,80)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method, current_value, blended_value, pc_new_value) VALUES ('PC-1','Bad mapping','formula_bulk',100,900,900)`),
    ]);
    const result = await runBlendRecomputeBackfill(env as any, { limit: 1 });
    expect(result.candidates).toBe(1);
    expect(await cursor()).toBe('CLEAN-1');
    await runBlendRecomputeBackfill(env as any, { limit: 1 });
    expect(await cursor()).toBe('PC-1');
    const cleaned = await db.prepare(`SELECT blended_value, deal_signal FROM lego_sets WHERE set_num='PC-1'`).first<any>();
    expect(cleaned.blended_value).toBe(100);
    expect(cleaned.deal_signal).toBeNull();
  });
});
