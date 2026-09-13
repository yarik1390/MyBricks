/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPriceChartingBulk } from './jobs/pricecharting-bulk';
import { recomputeBlendedValues } from './lib/market-sources';
import { clearSourceConfigCache, saveSourceConfig } from './lib/source-config';

vi.mock('./lib/market-sources', () => ({
  recomputeBlendedValues: vi.fn(async () => 0),
}));

const db = (env as any).DB as D1Database;
const enabledEnv = () => ({ ...env, PRICECHARTING_PRO: '1', PRICECHARTING_VERIFIED_ENABLED: '1' } as any);

async function importRows(rows: string[]) {
  const e = enabledEnv();
  await saveSourceConfig(e, { pricecharting: { enabled: true, weight: 0 } } as any);
  clearSourceConfigCache();
  return runPriceChartingBulk(e, [
    'id,console-name,upc,product-name,loose-price,cib-price,new-price,sales-volume',
    ...rows,
  ].join('\n'));
}

describe('PriceCharting bulk identity verification', () => {
  beforeEach(async () => {
    vi.mocked(recomputeBlendedValues).mockClear();
    for (const table of ['lego_sets', 'set_market_ext', 'app_settings', 'pricing_source_map', 'pricing_signals', 'user_collection', 'user_wishlist']) {
      await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
    await db.prepare(`CREATE TABLE lego_sets (
      set_num TEXT PRIMARY KEY, name TEXT, upc TEXT, category TEXT, pc_id TEXT,
      pc_new_value REAL, pc_complete_value REAL, pc_cached_at TEXT,
      blended_value REAL, current_value REAL
    )`).run();
    await db.prepare(`CREATE TABLE set_market_ext (
      set_num TEXT PRIMARY KEY, pc_loose_value REAL, pc_sales_volume INTEGER,
      pa_retail_value REAL, pa_lowest_offer REAL, pa_in_stock INTEGER,
      pa_best_merchant TEXT, pa_offer_count INTEGER, pa_market TEXT, pa_cached_at TEXT
    )`).run();
    await db.prepare(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`).run();
    await db.prepare(`CREATE TABLE pricing_source_map (
      source TEXT, source_item_id TEXT, set_num TEXT, source_title TEXT, upc TEXT,
      variant_key TEXT, match_method TEXT, match_confidence REAL, status TEXT,
      verified_at TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY(source, source_item_id)
    )`).run();
    await db.prepare(`CREATE TABLE pricing_signals (
      set_num TEXT, source TEXT, source_item_id TEXT, provider_family TEXT,
      condition TEXT, signal_type TEXT, currency TEXT, value REAL, low REAL, high REAL,
      sample_count INTEGER, sales_volume INTEGER, source_observed_at TEXT, checked_at TEXT,
      match_status TEXT, flags_json TEXT, updated_at TEXT,
      PRIMARY KEY(set_num, source, condition)
    )`).run();
    await db.prepare(`CREATE TABLE user_collection (set_num TEXT, deleted_at TEXT)`).run();
    await db.prepare(`CREATE TABLE user_wishlist (set_num TEXT)`).run();
  });

  it('skips a conflicting observation for an existing manual mapping without touching prices, extension, signals, or recompute', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num,name,category,pc_id,pc_new_value,pc_complete_value,pc_cached_at,blended_value,current_value)
                  VALUES ('10001-1','Mapped Set','Normal','pc-x',11,22,'2026-01-01T00:00:00Z',33,44)`),
      db.prepare(`INSERT INTO lego_sets (set_num,name,category,current_value) VALUES ('10002-1','Conflicting Set','Normal',55)`),
      db.prepare(`INSERT INTO set_market_ext (set_num,pc_loose_value,pc_sales_volume) VALUES ('10001-1',7,8)`),
      db.prepare(`INSERT INTO pricing_source_map
                  (source,source_item_id,set_num,source_title,variant_key,match_method,match_confidence,status,verified_at,updated_at)
                  VALUES ('pricecharting','pc-x','10001-1','Reviewed title','10001-1','manual',1,'manual','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`),
      db.prepare(`INSERT INTO pricing_signals
                  (set_num,source,source_item_id,provider_family,condition,signal_type,currency,value,sample_count,sales_volume,source_observed_at,checked_at,match_status,flags_json,updated_at)
                  VALUES ('10001-1','pricecharting','pc-x','ebay_market','new_sealed','sold','USD',11,8,8,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','manual','[]','2026-01-01T00:00:00Z')`),
      db.prepare(`INSERT INTO user_collection (set_num,deleted_at) VALUES ('10001-1',NULL)`),
    ]);

    const result = await importRows(['pc-x,LEGO Sets,,Conflicting observation #10002-1,$70,$80,$90,99']);

    expect(result).toMatchObject({ rows: 1, matched: 1, unmatched: 0, updated: 0 });
    expect(await db.prepare(`SELECT set_num,status,source_title,variant_key FROM pricing_source_map WHERE source='pricecharting' AND source_item_id='pc-x'`).first<any>())
      .toMatchObject({ set_num: '10001-1', status: 'manual', source_title: 'Reviewed title', variant_key: '10001-1' });
    const legacy = await db.prepare(`SELECT pc_id,pc_new_value,pc_complete_value,pc_cached_at,blended_value,current_value FROM lego_sets WHERE set_num='10001-1'`).first<any>();
    expect(legacy.pc_id).toBe('pc-x');
    expect(legacy.pc_new_value).toBe(11);
    expect(legacy.pc_complete_value).toBe(22);
    expect(legacy.current_value).toBe(44);
    expect(String(legacy.pc_cached_at)).toContain('2026-01-01');
    expect(await db.prepare(`SELECT pc_loose_value,pc_sales_volume FROM set_market_ext WHERE set_num='10001-1'`).first<any>())
      .toMatchObject({ pc_loose_value: 7, pc_sales_volume: 8 });
    expect(await db.prepare(`SELECT source_item_id,value,sample_count,sales_volume,match_status FROM pricing_signals WHERE set_num='10001-1' AND source='pricecharting' AND condition='new_sealed'`).first<any>())
      .toMatchObject({ source_item_id: 'pc-x', value: 11, sample_count: 8, sales_volume: 8, match_status: 'manual' });
    expect(vi.mocked(recomputeBlendedValues)).not.toHaveBeenCalled();
  });

  it('still imports a matching full token and recomputes a priority set', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num,name,category,current_value) VALUES ('10001-1','Mapped Set','Normal',44)`),
      db.prepare(`INSERT INTO pricing_source_map
                  (source,source_item_id,set_num,source_title,variant_key,match_method,match_confidence,status,verified_at,updated_at)
                  VALUES ('pricecharting','pc-x','10001-1','Reviewed title','10001-1','manual',1,'manual','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`),
      db.prepare(`INSERT INTO user_wishlist (set_num) VALUES ('10001-1')`),
    ]);

    const result = await importRows(['pc-x,LEGO Sets,,Matching observation #10001-1,$70,$80,$90,99']);

    expect(result).toMatchObject({ rows: 1, matched: 1, unmatched: 0, updated: 1 });
    expect(await db.prepare(`SELECT pc_id,pc_new_value,pc_complete_value FROM lego_sets WHERE set_num='10001-1'`).first<any>())
      .toMatchObject({ pc_id: 'pc-x', pc_new_value: 90, pc_complete_value: 80 });
    expect(await db.prepare(`SELECT pc_loose_value,pc_sales_volume FROM set_market_ext WHERE set_num='10001-1'`).first<any>())
      .toMatchObject({ pc_loose_value: 70, pc_sales_volume: 99 });
    const signals = await db.prepare(`SELECT condition,value,sales_volume FROM pricing_signals WHERE set_num='10001-1' ORDER BY condition`).all<any>();
    expect(signals.results).toEqual([
      expect.objectContaining({ condition: 'loose', value: 70, sales_volume: 99 }),
      expect.objectContaining({ condition: 'new_sealed', value: 90, sales_volume: 99 }),
      expect.objectContaining({ condition: 'used_complete', value: 80, sales_volume: 99 }),
    ]);
    expect(vi.mocked(recomputeBlendedValues)).toHaveBeenCalledOnce();
    const [recomputeDb, recomputeSetNums] = vi.mocked(recomputeBlendedValues).mock.calls[0];
    expect(recomputeDb).toBe(db);
    expect(recomputeSetNums).toEqual(['10001-1']);
  });

  it('accepts a unique provider UPC when the title has no conflicting explicit identity', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num,name,upc,category) VALUES ('10300-1','Time Machine','0673419340373','Normal')`).run();
    const result = await importRows(['6910,LEGO Creator,0673419340373,Back to the Future Time Machine #10300,$50,$90,$120,20']);
    expect(result.matched).toBe(1);
    const mapping = await db.prepare(`SELECT source_item_id,set_num,source_title,upc,status,match_method FROM pricing_source_map WHERE source_item_id='6910'`).first<any>();
    expect(mapping).toMatchObject({ source_item_id: '6910', set_num: '10300-1', upc: '0673419340373', status: 'verified', match_method: 'upc' });
  });

  it('rejects UPC promotion when an explicit variant conflicts', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num,name,upc,category) VALUES ('75188-1','Resistance Bomber','123456789012','Normal')`),
      db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('75188-2','Finch Dallow Resistance Bomber','Normal')`),
    ]);
    await importRows(['9001,LEGO Star Wars,123456789012,Finch Dallow Resistance Bomber #75188-2,$100,$150,$200,10']);
    const mapping = await db.prepare(`SELECT set_num,status,match_method FROM pricing_source_map WHERE source_item_id='9001'`).first<any>();
    expect(mapping).toMatchObject({ set_num: '75188-2', status: 'verified', match_method: 'set_token' });
    expect((await db.prepare(`SELECT pc_id FROM lego_sets WHERE set_num='75188-1'`).first<any>()).pc_id).toBeNull();
  });

  it('requires boundary-safe full tokens and leaves base-only ambiguity quarantined', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('1234-1','Short ID','Normal')`),
      db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('12345-1','Long ID','Normal')`),
      db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('31058-1','Mighty Dinosaurs 3-in-1','Normal')`),
    ]);
    await importRows([
      'pfx,LEGO Creator,,Long ID #12345-1,$1,$2,$3,4',
      'base,LEGO Creator,,Mighty Dinosaurs 3-in-1 #31058,$10,$20,$30,4',
    ]);
    const maps = await db.prepare(`SELECT source_item_id,set_num,status,match_method FROM pricing_source_map ORDER BY source_item_id`).all<any>();
    expect(maps.results).toEqual([
      { source_item_id: 'base', set_num: '31058-1', status: 'quarantined', match_method: 'base_candidate' },
      { source_item_id: 'pfx', set_num: '12345-1', status: 'verified', match_method: 'set_token' },
    ]);
  });

  it('requires compatible provider/catalog categories for full-token proof', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('50000-1','Collector Book','Books')`).run();
    await importRows(['book,LEGO Sets,,Collector Book #50000-1,$10,$20,$30,4']);
    const mapping = await db.prepare(`SELECT status,match_method FROM pricing_source_map WHERE source_item_id='book'`).first<any>();
    expect(mapping).toEqual({ status: 'quarantined', match_method: 'set_token_conflict' });
  });

  it('does not reopen rejected/manual mappings during a later bulk import', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num,name,upc,category) VALUES ('10001-1','Manual','111','Normal')`),
      db.prepare(`INSERT INTO lego_sets (set_num,name,upc,category) VALUES ('10002-1','Rejected','222','Normal')`),
      db.prepare(`INSERT INTO pricing_source_map (source,source_item_id,set_num,match_method,match_confidence,status) VALUES ('pricecharting','manual-id','10001-1','manual',1,'manual')`),
      db.prepare(`INSERT INTO pricing_source_map (source,source_item_id,set_num,match_method,match_confidence,status) VALUES ('pricecharting','rejected-id','10002-1','manual',1,'rejected')`),
    ]);
    await importRows([
      'manual-id,LEGO Sets,111,Manual #10001-1,$1,$2,$3,4',
      'rejected-id,LEGO Sets,222,Rejected #10002-1,$1,$2,$3,4',
    ]);
    const maps = await db.prepare(`SELECT source_item_id,status,match_method FROM pricing_source_map ORDER BY source_item_id`).all<any>();
    expect(maps.results).toEqual([
      { source_item_id: 'manual-id', status: 'manual', match_method: 'manual' },
      { source_item_id: 'rejected-id', status: 'rejected', match_method: 'manual' },
    ]);
  });
});
