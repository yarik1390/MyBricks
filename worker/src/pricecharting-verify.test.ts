/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { runPriceChartingVerify } from './jobs/pricecharting-verify';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runPriceChartingVerify (identity-first)', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'pricing_source_map', 'pricing_signals',
      'set_valuation_state', 'app_settings', 'user_collection', 'user_wishlist',
    ]);
  });

  it('never promotes from price coincidence or copied legacy identity fields', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, upc, pc_new_value, pc_complete_value, bl_new_value, used_value) VALUES ('10300-1','Time Machine','pc123','0673419340373',105,80,100,80)`),
      db.prepare(`INSERT INTO pricing_source_map (source, source_item_id, set_num, source_title, upc, variant_key, match_method, match_confidence, status) VALUES ('pricecharting','pc123','10300-1','Time Machine','0673419340373','10300-1','legacy_pc_id',0.2,'quarantined')`),
    ]);

    const result = await runPriceChartingVerify(env as any);
    expect(result.promoted).toBe(0);
    expect(result.signals).toBe(0);
    const mapping = await db.prepare(`SELECT status, match_method FROM pricing_source_map WHERE source_item_id='pc123'`).first<any>();
    expect(mapping).toEqual({ status: 'quarantined', match_method: 'legacy_pc_id' });
  });

  it('preserves manual and rejected decisions and refreshes known-good mappings', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_new_value) VALUES ('MAN-1','Manual','manual-provider',110)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_new_value) VALUES ('REJ-1','Rejected','rejected-provider',120)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_new_value) VALUES ('GOOD-1','Verified','real-provider-id',130)`),
      db.prepare(`INSERT INTO pricing_source_map (source, source_item_id, set_num, match_method, match_confidence, status) VALUES ('pricecharting','manual-provider','MAN-1','manual',1,'manual')`),
      db.prepare(`INSERT INTO pricing_source_map (source, source_item_id, set_num, match_method, match_confidence, status) VALUES ('pricecharting','rejected-provider','REJ-1','manual',1,'rejected')`),
      db.prepare(`INSERT INTO pricing_source_map (source, source_item_id, set_num, match_method, match_confidence, status) VALUES ('pricecharting','real-provider-id','GOOD-1','upc',1,'verified')`),
    ]);

    const result = await runPriceChartingVerify(env as any);
    expect(result.promoted).toBe(0);
    const maps = await db.prepare(`SELECT source_item_id, status, match_method FROM pricing_source_map ORDER BY source_item_id`).all<any>();
    expect(maps.results).toEqual([
      { source_item_id: 'manual-provider', status: 'manual', match_method: 'manual' },
      { source_item_id: 'real-provider-id', status: 'verified', match_method: 'upc' },
      { source_item_id: 'rejected-provider', status: 'rejected', match_method: 'manual' },
    ]);
    const signals = await db.prepare(`SELECT source_item_id, set_num, value FROM pricing_signals ORDER BY source_item_id`).all<any>();
    expect(signals.results).toEqual([
      { source_item_id: 'manual-provider', set_num: 'MAN-1', value: 110 },
      { source_item_id: 'real-provider-id', set_num: 'GOOD-1', value: 130 },
    ]);
  });

  it('does not synthesize a provider ID for legacy rows', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, pc_new_value, bl_new_value) VALUES ('NOID-1','No provider identity',100,100)`).run();
    const result = await runPriceChartingVerify(env as any, { refreshSignals: false });
    expect(result).toMatchObject({ promoted: 0, signals: 0, reblended: 0 });
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM pricing_source_map`).first<{ n: number }>();
    expect(count!.n).toBe(0);
  });
});
