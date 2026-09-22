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

const HEADER = 'id,console-name,upc,product-name,loose-price,cib-price,new-price,sales-volume';

/** 30 days ago — beyond the 7-day re-confirmation window and the engine's 14-day one. */
const OLD = '2026-08-20T00:00:00Z';

async function importRows(rows: string[]) {
  const e = enabledEnv();
  await saveSourceConfig(e, { pricecharting: { enabled: true, weight: 1 } } as any);
  clearSourceConfigCache();
  return runPriceChartingBulk(e, [HEADER, ...rows].join('\n'));
}

/** One verified mapping + one signal per condition, all last checked 30 days ago. */
async function seed(...conditions: Array<'new_sealed' | 'used_complete' | 'loose'>) {
  const signals = conditions.map((condition) => db.prepare(
    `INSERT INTO pricing_signals
       (set_num,source,source_item_id,provider_family,condition,signal_type,currency,value,
        sample_count,sales_volume,source_observed_at,checked_at,match_status,flags_json,updated_at)
     VALUES ('10001-1','pricecharting','12345','ebay_market',?,?, 'USD',50,12,12,?,?, 'verified','[]',?)`,
  ).bind(condition, condition === 'loose' ? 'sold' : 'sold', OLD, OLD, OLD));
  await db.batch([
    db.prepare(`INSERT INTO lego_sets (set_num,name,category,pc_id,blended_value,current_value)
                VALUES ('10001-1','Mapped Set','Normal','12345',40,40)`),
    db.prepare(`INSERT INTO pricing_source_map
                  (source,source_item_id,set_num,source_title,variant_key,match_method,match_confidence,status,verified_at,updated_at)
                VALUES ('pricecharting','12345','10001-1','Mapped Set','10001-1','set_token',1,'verified',?,?)`)
      .bind(OLD, OLD),
    ...signals,
  ]);
}

const signal = (condition: string) => db.prepare(
  `SELECT checked_at, source_observed_at FROM pricing_signals
    WHERE set_num='10001-1' AND source='pricecharting' AND condition=?`,
).bind(condition).first<any>();

describe('PriceCharting bulk re-confirmation', () => {
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
      set_num TEXT PRIMARY KEY, pc_loose_value REAL, pc_sales_volume INTEGER
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

  it('reports failure when imported prices cannot refresh a user-facing blend', async () => {
    await seed('new_sealed');
    await db.prepare(`INSERT INTO user_collection (set_num) VALUES ('10001-1')`).run();
    vi.mocked(recomputeBlendedValues).mockRejectedValueOnce(new Error('blend refresh unavailable'));

    await expect(importRows(['12345,LEGO Sets,,Mapped Set #10001,$40,$60,$50,12']))
      .rejects.toThrow('blend refresh unavailable');
    const stored = await db.prepare(`SELECT value FROM app_settings WHERE key='pc_bulk_last_result'`).first<{ value: string }>();
    expect(JSON.parse(stored!.value).skipped).toContain('blend refresh unavailable');
    expect(await db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE '_pc_bulk_%'`).all())
      .toMatchObject({ results: [] });
  });

  it('advances checked_at for an unchanged price the sweep still publishes', async () => {
    await seed('new_sealed');

    // The sweep re-publishes the identical $90 new price.
    await importRows(['12345,LEGO Sets,,Mapped Set #10001,$40,$60,$50,12']);

    const row = await signal('new_sealed');
    // Re-observed: freshness advances.
    expect(new Date(row.checked_at).getTime())
      .toBeGreaterThan(Date.parse('2026-09-01T00:00:00Z'));
    // Re-priced: the value-observation anchor the benchmark freezes on does NOT move.
    expect(row.source_observed_at).toBe(OLD);
    // The unchanged value itself is untouched.
    expect(await db.prepare(`SELECT value FROM pricing_signals WHERE condition='new_sealed'`).first<any>())
      .toMatchObject({ value: 50 });
  });

  it('does not advance a condition the sweep no longer prices', async () => {
    await seed('new_sealed');
    // Product still listed, but this row's new-price column is empty.
    await importRows(['12345,LEGO Sets,,Mapped Set #10001,$40,$60,,12']);

    expect(await signal('new_sealed')).toMatchObject({ checked_at: OLD, source_observed_at: OLD });
  });

  it('does not advance a product that dropped out of the sweep', async () => {
    await seed('new_sealed');
    await importRows(['99999,LEGO Sets,,Some Other Set #10002-1,$40,$60,$90,12']);

    expect(await signal('new_sealed')).toMatchObject({ checked_at: OLD, source_observed_at: OLD });
  });

  it('does not advance a quarantined mapping', async () => {
    await seed('new_sealed');
    await db.prepare(`UPDATE pricing_source_map SET status='quarantined' WHERE source_item_id='12345'`).run();

    await importRows(['12345,LEGO Sets,,Mapped Set #10001,$40,$60,$90,12']);

    expect(await signal('new_sealed')).toMatchObject({ checked_at: OLD, source_observed_at: OLD });
  });

  it('records a failed import instead of vanishing from diagnostics', async () => {
    const e = enabledEnv();
    await saveSourceConfig(e, { pricecharting: { enabled: true, weight: 1 } } as any);
    clearSourceConfigCache();
    // Drop a table the import writes, so the import fails mid-flight.
    await db.prepare('DROP TABLE pricing_signals').run();

    await expect(runPriceChartingBulk(e, `${HEADER}\n12345,LEGO Sets,,Mapped Set #10001,$40,$60,$90,12`))
      .rejects.toThrow(/pricing_signals/);
    const progress = await db.prepare(`SELECT value FROM app_settings WHERE key='pc_bulk_last_result'`).first<any>();
    expect(String(progress?.value ?? '')).toContain('import failed');
  });
});
