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

async function importRows(rows: string[], envOverride?: any) {
  const e = envOverride ?? enabledEnv();
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
                  VALUES ('10001-1','Mapped Set','Normal','12345',11,22,'2026-01-01T00:00:00Z',33,44)`),
      db.prepare(`INSERT INTO lego_sets (set_num,name,category,current_value) VALUES ('10002-1','Conflicting Set','Normal',55)`),
      db.prepare(`INSERT INTO set_market_ext (set_num,pc_loose_value,pc_sales_volume) VALUES ('10001-1',7,8)`),
      db.prepare(`INSERT INTO pricing_source_map
                  (source,source_item_id,set_num,source_title,variant_key,match_method,match_confidence,status,verified_at,updated_at)
                  VALUES ('pricecharting','12345','10001-1','Reviewed title','10001-1','manual',1,'manual','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`),
      db.prepare(`INSERT INTO pricing_signals
                  (set_num,source,source_item_id,provider_family,condition,signal_type,currency,value,sample_count,sales_volume,source_observed_at,checked_at,match_status,flags_json,updated_at)
                  VALUES ('10001-1','pricecharting','12345','ebay_market','new_sealed','sold','USD',11,8,8,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','manual','[]','2026-01-01T00:00:00Z')`),
      db.prepare(`INSERT INTO user_collection (set_num,deleted_at) VALUES ('10001-1',NULL)`),
    ]);

    const result = await importRows(['12345,LEGO Sets,,Conflicting observation #10002-1,$70,$80,$90,99']);

    expect(result).toMatchObject({ rows: 1, matched: 0, unmatched: 1, updated: 0 });
    expect(await db.prepare(`SELECT set_num,status,source_title,variant_key FROM pricing_source_map WHERE source='pricecharting' AND source_item_id='12345'`).first<any>())
      .toMatchObject({ set_num: '10001-1', status: 'manual', source_title: 'Reviewed title', variant_key: '10001-1' });
    const legacy = await db.prepare(`SELECT pc_id,pc_new_value,pc_complete_value,pc_cached_at,blended_value,current_value FROM lego_sets WHERE set_num='10001-1'`).first<any>();
    expect(legacy.pc_id).toBe('12345');
    expect(legacy.pc_new_value).toBe(11);
    expect(legacy.pc_complete_value).toBe(22);
    expect(legacy.current_value).toBe(44);
    expect(String(legacy.pc_cached_at)).toContain('2026-01-01');
    expect(await db.prepare(`SELECT pc_loose_value,pc_sales_volume FROM set_market_ext WHERE set_num='10001-1'`).first<any>())
      .toMatchObject({ pc_loose_value: 7, pc_sales_volume: 8 });
    expect(await db.prepare(`SELECT source_item_id,value,sample_count,sales_volume,match_status FROM pricing_signals WHERE set_num='10001-1' AND source='pricecharting' AND condition='new_sealed'`).first<any>())
      .toMatchObject({ source_item_id: '12345', value: 11, sample_count: 8, sales_volume: 8, match_status: 'manual' });
    expect(vi.mocked(recomputeBlendedValues)).not.toHaveBeenCalled();
  });

  it('promotes a sole bare-base row with an exact normalized title', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('75188-1','Resistance Bomber','Normal')`).run();

    expect(await importRows(['pc-75188,LEGO Sets,,LEGO Resistance Bomber #75188,$70,$80,$90,9']))
      .toMatchObject({ matched: 1, updated: 1 });
    expect(await db.prepare(`SELECT match_method,status FROM pricing_source_map WHERE source_item_id='pc-75188'`).first())
      .toEqual({ match_method: 'base_title', status: 'verified' });
    expect(await db.prepare(`SELECT pc_id,pc_new_value FROM lego_sets WHERE set_num='75188-1'`).first())
      .toEqual({ pc_id: 'pc-75188', pc_new_value: 90 });
  });

  it.each([
    ['title mismatch / named variant', "'75188-1','Resistance Bomber','Normal',NULL", 'pc-a,LEGO Sets,,Finch Dallow Resistance Bomber #75188,$70,$80,$90,9'],
    ['multiple catalog variants', "'75188-1','Resistance Bomber','Normal',NULL),('75188-2','Resistance Bomber','Normal',NULL", 'pc-b,LEGO Sets,,Resistance Bomber #75188,$70,$80,$90,9'],
    ['category conflict', "'75188-1','Resistance Bomber','Technic',NULL", 'pc-c,LEGO Sets,,Resistance Bomber #75188,$70,$80,$90,9'],
    ['UPC mismatch', "'75188-1','Resistance Bomber','Normal','111'", 'pc-d,LEGO Sets,222,Resistance Bomber #75188,$70,$80,$90,9'],
  ])('does not promote bare-base evidence for %s', async (_reason, values, row) => {
    await db.prepare(`INSERT INTO lego_sets (set_num,name,category,upc) VALUES (${values})`).run();
    const result = await importRows([row]);
    expect(result.updated).toBe(0);
    expect((await db.prepare(`SELECT count(*) n FROM pricing_signals`).first<any>()).n).toBe(0);
    expect(vi.mocked(recomputeBlendedValues)).not.toHaveBeenCalled();
  });

  it('blocks base-title promotion when the provider id or base evidence competes', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('75188-1','Resistance Bomber','Normal')`).run();
    const result = await importRows([
      'dup,LEGO Sets,,Resistance Bomber #75188,$70,$80,$90,9',
      'dup,LEGO Sets,,Resistance Bomber #75188,$71,$81,$91,10',
      'other,LEGO Sets,,Resistance Bomber #75188,$72,$82,$92,11',
    ]);
    expect(result.updated).toBe(0);
    expect((await db.prepare(`SELECT count(*) n FROM pricing_signals`).first<any>()).n).toBe(0);
  });

  it.each(['manual', 'rejected'])('preserves a %s mapping from base-title promotion', async (status) => {
    await db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('75188-1','Resistance Bomber','Normal')`).run();
    await db.prepare(`INSERT INTO pricing_source_map (source,source_item_id,set_num,status,match_method)
      VALUES ('pricecharting','protected','75188-1',?1,'manual')`).bind(status).run();
    expect((await importRows(['new,LEGO Sets,,Resistance Bomber #75188,$70,$80,$90,9'])).updated).toBe(0);
    expect(await db.prepare(`SELECT status FROM pricing_source_map WHERE source_item_id='protected'`).first()).toEqual({ status });
  });

  it('rechecks a base-title mapping against the current row before writing drifted evidence', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES ('75188-1','Resistance Bomber','Normal')`).run();
    await importRows(['pc,LEGO Sets,,Resistance Bomber #75188,$70,$80,$90,9']);
    vi.mocked(recomputeBlendedValues).mockClear();

    const result = await importRows(['pc,LEGO Sets,,Finch Dallow Resistance Bomber #75188,$71,$81,$91,10']);
    expect(result.updated).toBe(0);
    expect(await db.prepare(`SELECT pc_new_value FROM lego_sets WHERE set_num='75188-1'`).first()).toEqual({ pc_new_value: 90 });
    expect(await db.prepare(`SELECT value FROM pricing_signals WHERE condition='new_sealed'`).first()).toEqual({ value: 90 });
    expect(vi.mocked(recomputeBlendedValues)).not.toHaveBeenCalled();
  });

  it('repairs equal-price synthetic identity from an exact full token', async () => {
    const token = '#10001-1';
    await db.prepare(`INSERT INTO lego_sets (set_num,category) VALUES ('10001-1','Normal')`).run();
    await db.prepare(`INSERT INTO pricing_source_map (source,source_item_id,set_num,status)
      VALUES ('pricecharting','legacy:10001-1','10001-1','verified')`).run();
    await db.prepare(`INSERT INTO pricing_signals (set_num,source,source_item_id,condition,value,sample_count,match_status)
      VALUES ('10001-1','pricecharting','legacy:10001-1','new_sealed',90,99,'verified')`).run();
    expect(await importRows([`123,LEGO Sets,,Set ${token},$70,$80,$90,99`])).toMatchObject({matched:1});
    expect(await db.prepare(`SELECT source_item_id,value FROM pricing_signals WHERE condition='new_sealed'`).first())
      .toEqual({source_item_id:'123',value:90});
    expect(await db.prepare(`SELECT status FROM pricing_source_map WHERE source_item_id='legacy:10001-1'`).first())
      .toEqual({status:'quarantined'});
  });

  it.each([
    ['Set #10001', 'LEGO Sets', '', true],
    ['Set #10001-1 and #10002-1', 'LEGO Sets', '', false],
    ['Set #10001-1 #10001-1', 'LEGO Sets', '', false],
    ['Set #10001-1', 'Video Games', '', false],
    ['Set #10001-1', 'LEGO Sets', '222', false],
  ])('rejects ambiguous or conflicting evidence: %s %s %s', async (title,category,upc,variant) => {
    await db.prepare(`INSERT INTO lego_sets (set_num,upc,category) VALUES ('10001-1','111','Normal'),('10002-1','222','Normal')`).run();
    if (variant) await db.prepare(`INSERT INTO lego_sets (set_num,category) VALUES ('10001-2','Normal')`).run();
    expect(await importRows([`123,${category},${upc},${title},$70,$80,$90,99`])).toMatchObject({matched:0});
    expect(await db.prepare('SELECT count(*) AS n FROM pricing_signals').first()).toEqual({n:0});
  });

  it.each(['manual','rejected','quarantined'])('never steals an existing %s provider ID', async (status) => {
    await db.prepare(`INSERT INTO lego_sets (set_num,category) VALUES ('10001-1','Normal'),('10002-1','Normal')`).run();
    await db.prepare(`INSERT INTO pricing_source_map (source,source_item_id,set_num,status) VALUES ('pricecharting','123','10002-1',?)`).bind(status).run();
    expect(await importRows(['123,LEGO Sets,,Set #10001-1,$70,$80,$90,99'])).toMatchObject({matched:0});
    expect(await db.prepare(`SELECT set_num,status FROM pricing_source_map WHERE source_item_id='123'`).first()).toEqual({set_num:'10002-1',status});
  });

  it.each(['manual','rejected'])('preserves a %s synthetic mapping', async (status) => {
    await db.prepare(`INSERT INTO lego_sets (set_num,category) VALUES ('10001-1','Normal')`).run();
    await db.prepare(`INSERT INTO pricing_source_map (source,source_item_id,set_num,status) VALUES ('pricecharting','legacy:10001-1','10001-1',?)`).bind(status).run();
    expect(await importRows(['123,LEGO Sets,,Set #10001-1,$70,$80,$90,99'])).toMatchObject({matched:0});
    expect(await db.prepare(`SELECT status FROM pricing_source_map`).first()).toEqual({status});
  });

  it('isolates overlapping import stages', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num,category) VALUES ('10001-1','Normal'),('10002-1','Normal')`).run();
    const results = await Promise.all([
      importRows(['123,LEGO Sets,,Set #10001-1,$70,$80,$90,99']),
      importRows(['456,LEGO Sets,,Set #10002-1,$71,$81,$91,99']),
    ]);
    expect(results.map((r) => r.matched)).toEqual([1,1]);
    expect(await db.prepare(`SELECT count(*) AS n FROM pricing_signals`).first()).toEqual({n:6});
  });

  it('still imports a matching full token and recomputes a priority set', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num,name,category,current_value) VALUES ('10001-1','Mapped Set','Normal',44)`),
      db.prepare(`INSERT INTO pricing_source_map
                  (source,source_item_id,set_num,source_title,variant_key,match_method,match_confidence,status,verified_at,updated_at)
                  VALUES ('pricecharting','12345','10001-1','Reviewed title','10001-1','manual',1,'manual','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`),
      db.prepare(`INSERT INTO user_wishlist (set_num) VALUES ('10001-1')`),
    ]);

    const result = await importRows(['12345,LEGO Sets,,Matching observation #10001-1,$70,$80,$90,99']);

    expect(result).toMatchObject({ rows: 1, matched: 1, unmatched: 0, updated: 1 });
    expect(await db.prepare(`SELECT pc_id,pc_new_value,pc_complete_value FROM lego_sets WHERE set_num='10001-1'`).first<any>())
      .toMatchObject({ pc_id: '12345', pc_new_value: 90, pc_complete_value: 80 });
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

  it.each([
    ['same set and same prices', [
      'dup,LEGO Sets,,Set #10001-1,$70,$80,$90,9',
      'dup,LEGO Sets,,Set #10001-1,$70,$80,$90,9',
    ]],
    ['same set and different prices', [
      'dup,LEGO Sets,,Set #10001-1,$70,$80,$90,9',
      'dup,LEGO Sets,,Set #10001-1,$71,$81,$91,10',
    ]],
    ['different sets', [
      'dup,LEGO Sets,,Set #10001-1,$70,$80,$90,9',
      'dup,LEGO Sets,,Set #10002-1,$71,$81,$91,10',
    ]],
  ])('quarantines every occurrence of a duplicate provider ID: %s', async (_label, duplicateRows) => {
    await db.prepare(`INSERT INTO lego_sets (set_num,category) VALUES ('10001-1','Normal'),('10002-1','Normal')`).run();
    const result = await importRows(duplicateRows);
    expect(result).toMatchObject({ rows: 2, matched: 0, unmatched: 2, updated: 0 });
    expect(await db.prepare(`SELECT count(*) AS n FROM pricing_source_map WHERE source_item_id='dup'`).first()).toEqual({ n: 0 });
    expect(await db.prepare(`SELECT count(*) AS n FROM pricing_signals WHERE source_item_id='dup'`).first()).toEqual({ n: 0 });
  });

  it('stages a real 13k-row CSV within a bounded query budget', async () => {
    let prepareCount = 0;
    const countedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'prepare') return (sql: string) => {
          prepareCount++;
          return target.prepare(sql);
        };
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const rows = Array.from({ length: 13_000 }, (_, i) =>
      `${1_000_000 + i},LEGO Sets,,Set #${900_000 + i}-1,$7,$8,$9,1`);
    const result = await importRows(rows, { ...enabledEnv(), DB: countedDb });
    expect(result).toMatchObject({ rows: 13_000, matched: 0, unmatched: 13_000, updated: 0 });
    // Includes source-config/progress and all import SQL, not just staging.
    expect(prepareCount).toBeLessThan(100);
  }, 60_000);

  it('drops its unique staging table after an injected staging failure', async () => {
    const failure = new Error('injected stage failure');
    let injected = false;
    const failingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'prepare') return (sql: string) => {
          const statement = target.prepare(sql);
          if (!injected && /INSERT INTO _pc_bulk_/.test(sql)) {
            injected = true;
            return new Proxy(statement, {
              get(stmt, key, stmtReceiver) {
                if (key === 'bind') return (...args: unknown[]) => {
                  const bound = stmt.bind(...args);
                  return new Proxy(bound, { get(b, k, r) { return k === 'run' ? async () => { throw failure; } : Reflect.get(b, k, r); } });
                };
                return Reflect.get(stmt, key, stmtReceiver);
              },
            });
          }
          return statement;
        };
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(importRows(['123,LEGO Sets,,Set #10001-1,$7,$8,$9,1'], { ...enabledEnv(), DB: failingDb }))
      .rejects.toBe(failure);
    expect((await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_pc_bulk_%'`).all()).results).toEqual([]);
  });

  it('drops its staging table after an injected post-stage import failure', async () => {
    const failure = new Error('injected import failure');
    const failingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'prepare') return (sql: string) => {
          if (/CREATE INDEX IF NOT EXISTS _pc_bulk_/.test(sql)) {
            return { run: async () => { throw failure; }, bind() { return this; } } as any;
          }
          return target.prepare(sql);
        };
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(importRows(['123,LEGO Sets,,Set #10001-1,$7,$8,$9,1'], { ...enabledEnv(), DB: failingDb }))
      .rejects.toBe(failure);
    expect((await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_pc_bulk_%'`).all()).results).toEqual([]);
  });

  it('preserves the import error when cleanup also fails', async () => {
    const importFailure = new Error('primary import failure');
    const cleanupFailure = new Error('secondary cleanup failure');
    const failingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'prepare') return (sql: string) => {
          if (/CREATE INDEX IF NOT EXISTS _pc_bulk_/.test(sql)) {
            return { run: async () => { throw importFailure; }, bind() { return this; } } as any;
          }
          if (/DROP TABLE IF EXISTS _pc_bulk_/.test(sql)) {
            return { run: async () => { throw cleanupFailure; }, bind() { return this; } } as any;
          }
          return target.prepare(sql);
        };
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(importRows(['123,LEGO Sets,,Set #10001-1,$7,$8,$9,1'], { ...enabledEnv(), DB: failingDb }))
      .rejects.toBe(importFailure);
    const orphan = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_pc_bulk_%'`).first<{ name: string }>();
    expect(orphan?.name).toMatch(/^_pc_bulk_/);
    await db.prepare(`DROP TABLE ${orphan!.name}`).run();
  });

  it('surfaces cleanup failure after a successful import', async () => {
    const cleanupFailure = new Error('injected cleanup failure');
    const failingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'prepare') return (sql: string) => {
          if (/DROP TABLE IF EXISTS _pc_bulk_/.test(sql)) {
            return { run: async () => { throw cleanupFailure; }, bind() { return this; } } as any;
          }
          return target.prepare(sql);
        };
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(importRows(['123,LEGO Sets,,Set #10001-1,$7,$8,$9,1'], { ...enabledEnv(), DB: failingDb }))
      .rejects.toBe(cleanupFailure);
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

  it('requires boundary-safe full tokens and promotes a uniquely exact bare-base title', async () => {
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
      { source_item_id: 'base', set_num: '31058-1', status: 'verified', match_method: 'base_title' },
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
