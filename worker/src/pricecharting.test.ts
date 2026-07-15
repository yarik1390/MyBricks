/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchPriceChartingData } from './lib/pricecharting';
import { parsePriceChartingCsv, runPriceChartingBulk } from './jobs/pricecharting-bulk';
import { clearSourceConfigCache, saveSourceConfig } from './lib/source-config';

const db = (env as any).DB as D1Database;

describe('parsePriceChartingCsv', () => {
  it('parses $-dollar prices, sales-volume, and the #set-number (real download format)', () => {
    const csv = [
      'id,console-name,product-name,loose-price,cib-price,new-price,upc,sales-volume',
      '5857984,LEGO Creator,Back to the Future Time Machine #10300,$50.00,$92.50,$122.50,673419761697,548',
      '7777,LEGO Brand,Promo Polybag,,,,,0',
    ].join('\n');
    const rows = parsePriceChartingCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      pcId: '5857984', upc: '673419761697', setBase: '10300',
      newValue: 122.5, completeValue: 92.5, looseValue: 50, salesVolume: 548,
    });
    // Empty cells → null (PriceCharting leaves blanks for conditions with no sales).
    expect(rows[1].newValue).toBeNull();
    expect(rows[1].salesVolume).toBeNull();
  });
});

describe('fetchPriceChartingData (UPC + loose/sales)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the UPC endpoint and maps loose-price + sales-volume', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({
        status: 'success', id: '6910', 'console-name': 'Lego',
        'new-price': 21000, 'cib-price': 18000, 'loose-price': 12500, 'sales-volume': 340,
      }), { status: 200 });
    }));
    const e: any = { ...env, PRICECHARTING_TOKEN: 'tok' };
    const r = await fetchPriceChartingData('10300-1', 'BTTF', null, e, '0673419340373');
    expect(r).toMatchObject({
      pc_id: '6910', new_value: 210, complete_value: 180, loose_value: 125,
      sales_volume: 340, match_method: 'upc', match_confidence: 1,
      upc: '0673419340373', variant_key: '10300-1',
    });
    expect(seen[0]).toContain('upc=0673419340373'); // took the exact UPC path, no search
  });

  it('rejects a UPC collision with a non-LEGO product', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'success', id: '1', 'console-name': 'Super Nintendo', 'new-price': 5000,
    }), { status: 200 })));
    const e: any = { ...env, PRICECHARTING_TOKEN: 'tok' };
    // upc miss → falls through to search, which also returns the SNES product → filtered out.
    const r = await fetchPriceChartingData('10300-1', 'BTTF', null, e, '999');
    expect(r).toBeNull();
  });
});

describe('runPriceChartingBulk', () => {
  beforeEach(async () => {
    await db.prepare('DROP TABLE IF EXISTS lego_sets').run();
    await db.prepare('DROP TABLE IF EXISTS set_market_ext').run();
    await db.prepare('DROP TABLE IF EXISTS app_settings').run();
    await db.prepare('DROP TABLE IF EXISTS pricing_source_map').run();
    await db.prepare('DROP TABLE IF EXISTS pricing_signals').run();
    await db.prepare(`CREATE TABLE lego_sets (
      set_num TEXT PRIMARY KEY, name TEXT, upc TEXT, pc_id TEXT,
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
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, upc) VALUES ('10300-1', 'BTTF', '0673419340373')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name) VALUES ('75192-1', 'Falcon')`),
    ]);
  });

  it('is gated behind PRICECHARTING_PRO', async () => {
    const e: any = { ...env, PRICECHARTING_PRO: undefined };
    const r = await runPriceChartingBulk(e, 'id,upc\n1,2');
    expect(r.skipped).toMatch(/PRICECHARTING_PRO/);
  });

  it('matches only a unique UPC and quarantines unverified base-number candidates', async () => {
    const e: any = { ...env, PRICECHARTING_PRO: '1', PRICECHARTING_VERIFIED_ENABLED: '1' };
    await saveSourceConfig(e, { pricecharting: { enabled: true, weight: 0 } } as any);
    clearSourceConfigCache();
    const csv = [
      'id,console-name,upc,product-name,loose-price,cib-price,new-price,sales-volume',
      '6910,LEGO Creator,0673419340373,Back to the Future #10300,$50.00,$92.50,$122.50,548', // UPC match
      '5555,LEGO Star Wars,,Millennium Falcon #75192,$258.36,$577.84,$745.00,555',           // #set-number match
      '9999,LEGO Brand,,Unknown Set #12121,$10.00,,,5',                                       // no match
    ].join('\n');
    const r = await runPriceChartingBulk(e, csv);
    expect(r.rows).toBe(3);
    expect(r.matched).toBe(1);
    expect(r.unmatched).toBe(2);

    const ext = await db.prepare(`SELECT set_num, pc_loose_value, pc_sales_volume FROM set_market_ext ORDER BY set_num`).all<any>();
    expect(ext.results).toEqual([
      { set_num: '10300-1', pc_loose_value: 50, pc_sales_volume: 548 },
    ]);
    const ls = await db.prepare(`SELECT pc_new_value FROM lego_sets WHERE set_num='75192-1'`).first<any>();
    expect(ls.pc_new_value).toBeNull();
    const candidate = await db.prepare(`SELECT status, set_num FROM pricing_source_map WHERE source_item_id='5555'`).first<any>();
    expect(candidate).toMatchObject({ status: 'quarantined', set_num: '75192-1' });

    // Summary persisted for admin diagnostics.
    const summary = await db.prepare(`SELECT value FROM app_settings WHERE key='pc_bulk_last_result'`).first<any>();
    expect(JSON.parse(summary.value).matched).toBe(1);
  });
});
