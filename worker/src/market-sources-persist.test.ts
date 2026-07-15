/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { persistBlendedValue, recomputeBlendedValues, resetSourceWeightMultipliers } from './lib/market-sources';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

// The pure blend math (blendMarketValue / computeDealSignal) is covered in
// lib.test.ts. These cover the D1-persistence wrappers the crons actually call.
describe('market-sources persistence (recomputeBlendedValues / persistBlendedValue)', () => {
  beforeEach(async () => {
    resetSourceWeightMultipliers(); // ignore any weights a prior test set
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'set_value_history', 'set_valuation_state',
      'pricing_signals', 'pricing_write_ledger',
    ]);
  });

  it('persists a high-confidence blend when two fresh sold comps agree', async () => {
    // BrickLink $100 + PriceCharting $105, both fresh sold comps within 1.4x → high.
    await db.prepare(
      `INSERT INTO lego_sets (set_num, name, valuation_method, bl_new_value, bl_new_qty, bl_cached_at, ebay_new_value, ebay_new_qty, ebay_new_cached_at)
       VALUES ('X-1','X','market', 100, 10, datetime('now'), 105, 8, datetime('now'))`,
    ).run();

    const blended = await persistBlendedValue(db, 'X-1');
    expect(blended).toBeGreaterThan(99);
    expect(blended).toBeLessThan(106);

    const row = await db.prepare(`SELECT blended_value, blended_confidence, blended_low, blended_high FROM lego_sets WHERE set_num='X-1'`)
      .first<{ blended_value: number; blended_confidence: string; blended_low: number; blended_high: number }>();
    expect(row!.blended_value).toBe(blended);
    expect(row!.blended_confidence).toBe('high');
    expect(row!.blended_low).toBeGreaterThan(0);
    expect(row!.blended_high).toBeGreaterThanOrEqual(row!.blended_low);
  });

  it('returns null and writes nothing for a set with no market signals', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method) VALUES ('Y-1','Y','formula_bulk')`).run();
    const blended = await persistBlendedValue(db, 'Y-1');
    expect(blended).toBeNull();
    const row = await db.prepare(`SELECT blended_value FROM lego_sets WHERE set_num='Y-1'`).first<{ blended_value: number | null }>();
    expect(row!.blended_value).toBeNull();
  });

  it('returns null for a set that does not exist', async () => {
    expect(await persistBlendedValue(db, 'nope-1')).toBeNull();
  });

  it('recomputes many sets in one pass and reports the written count', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method, bl_new_value, bl_new_qty, bl_cached_at) VALUES ('A-1','A','market', 40, 6, datetime('now'))`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method, current_value, cached_at) VALUES ('B-1','B','formula_bulk', 88, datetime('now'))`),
    ]);

    const written = await recomputeBlendedValues(db, ['A-1', 'B-1', 'A-1']); // dupe id de-duped
    expect(written).toBeGreaterThanOrEqual(2);

    const rows = await db.prepare(`SELECT set_num, blended_value FROM lego_sets ORDER BY set_num`).all<{ set_num: string; blended_value: number }>();
    expect(rows.results.every(r => r.blended_value > 0)).toBe(true);
  });

  it('fails open to 0 when given an empty id list', async () => {
    expect(await recomputeBlendedValues(db, [])).toBe(0);
  });
});
