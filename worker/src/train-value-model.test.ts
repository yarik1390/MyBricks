/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTestTables } from './test-schema';
import { runTrainValueModel } from './jobs/train-value-model';
import { legacySignalsFor, valueSignalsV3 } from './lib/valuation-v3';
import { discoveryWantsUsed } from './jobs/valuate-select';

const db = (env as any).DB as D1Database;
const YEAR = new Date().getUTCFullYear();

async function insertSets(rows: Array<Record<string, unknown>>) {
  const stmts = rows.map((r) => {
    const keys = Object.keys(r);
    return db.prepare(`INSERT INTO lego_sets (${keys.join(',')}) VALUES (${keys.map((_, i) => `?${i + 1}`).join(',')})`)
      .bind(...keys.map((k) => r[k]));
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

// Training sets: Star Wars sells at 2x retail, City at 1x, both 10 years old
// and retired, so the model has a clear theme effect to learn.
function trainingSets(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const starWars = i % 2 === 0;
    return {
      set_num: `T${i}-1`, name: `Train ${i}`, year: YEAR - 10, retired: 1, pieces: 500,
      theme: starWars ? 'Star Wars' : 'City', retail_price: 50,
      bl_new_value: starWars ? 100 : 50, bl_new_qty: 8,
    };
  });
}

const modelValue = async (setNum: string) => (await db.prepare(
  'SELECT model_value, model_cached_at FROM set_market_ext WHERE set_num=?',
).bind(setNum).first<{ model_value: number | null; model_cached_at: string | null }>());

describe('runTrainValueModel', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'app_settings']);
  });

  it('learns theme uplifts from BrickLink-priced sets and estimates unpriced ones', async () => {
    await insertSets([
      ...trainingSets(240),
      { set_num: 'SW-NEW-1', name: 'Unpriced SW', year: YEAR - 10, retired: 1, pieces: 500, theme: 'Star Wars', retail_price: 80 },
      { set_num: 'CITY-NEW-1', name: 'Unpriced City', year: YEAR - 10, retired: 1, pieces: 500, theme: 'City', retail_price: 80 },
      { set_num: 'NO-RETAIL-1', name: 'No retail', year: YEAR - 10, retired: 1, pieces: 500, theme: 'City' },
    ]);

    const result = await runTrainValueModel(env as any);

    expect(result.trained).toBe(240);
    const sw = (await modelValue('SW-NEW-1'))!.model_value!;
    const city = (await modelValue('CITY-NEW-1'))!.model_value!;
    // 120 sets per theme is plenty, so shrinkage barely bites: ~2x and ~1x.
    expect(sw).toBeGreaterThan(150);
    expect(sw).toBeLessThanOrEqual(162);
    expect(city).toBeGreaterThanOrEqual(78);
    expect(city).toBeLessThan(90);
    expect((await modelValue('SW-NEW-1'))!.model_cached_at).toBeTruthy();
    // No retail price, no estimate.
    expect(await modelValue('NO-RETAIL-1')).toBeNull();
  });

  it('blends in the BrickLink used guide when one exists', async () => {
    await insertSets([
      // Used sells at half the new price across the training sets.
      ...trainingSets(240).map((s) => ({ ...s, used_value: Number(s.bl_new_value) / 2, bl_used_qty: 4 })),
      { set_num: 'USED-1', name: 'Has used', year: YEAR - 10, retired: 1, pieces: 500, theme: 'City', retail_price: 50, used_value: 150, bl_used_qty: 6 },
    ]);
    await runTrainValueModel(env as any);
    // Retail model says ~$50 (City sells at 1x); used x2 says $300; with the
    // used anchor at 65% in log space that is 50^0.35 x 300^0.65 ~= $160.
    const v = (await modelValue('USED-1'))!.model_value!;
    expect(v).toBeGreaterThan(150);
    expect(v).toBeLessThan(170);
  });

  it('does not train on too little ground truth', async () => {
    await insertSets(trainingSets(20));
    const result = await runTrainValueModel(env as any);
    expect(result.written).toBe(0);
    expect(result.skipped).toMatch(/fewer than 200/);
  });
});

describe('value model in the v3 blend', () => {
  const now = Date.now();
  const fresh = new Date(now - 3600_000).toISOString();

  it('replaces the formula as the no-evidence estimate', () => {
    const signals = legacySignalsFor({ valuation_method: 'formula_bulk', current_value: 40, cached_at: fresh, model_value: 65, model_cached_at: fresh });
    expect(signals.some((s) => s.source === 'formula')).toBe(false);
    const state = valueSignalsV3('new_sealed', signals, {}, now);
    expect(state.fair_value).toBe(65);
    expect(state.confidence).toBe('estimated');
  });

  it('never outranks a modeled or sold source', () => {
    const state = valueSignalsV3('new_sealed', legacySignalsFor({
      valuation_method: 'brickeconomy', be_value_new: 120, be_cached_at: fresh, brickset_msrp: 100,
      model_value: 300, model_cached_at: fresh,
    }), {}, now);
    expect(state.fair_value).toBe(120);
  });

  it('beats a lone listing price, which is never a fair value on its own', () => {
    const state = valueSignalsV3('new_sealed', legacySignalsFor({
      bl_ask_value: 150, bl_ask_qty: 3, bl_fallback_cached_at: fresh, model_value: 90, model_cached_at: fresh,
    }), {}, now);
    expect(state.fair_value).toBe(90);
  });
});

describe('discoveryWantsUsed', () => {
  const at = new Date('2026-10-13T00:00:00Z');
  it('asks for the used guide on retired or 4+ year old sets only', () => {
    expect(discoveryWantsUsed({ year: 2022, retired: 0 }, at)).toBe(true);
    expect(discoveryWantsUsed({ year: 2024, retired: 1 }, at)).toBe(true);
    expect(discoveryWantsUsed({ year: 2024, retired: 0 }, at)).toBe(false);
    expect(discoveryWantsUsed({ year: null, retired: 0 }, at)).toBe(false);
  });
});
