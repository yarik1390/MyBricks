/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchPriceChartingData } from './lib/pricecharting';
import { parsePriceChartingCsv, runPriceChartingBulk } from './jobs/pricecharting-bulk';

const db = (env as any).DB as D1Database;

describe('parsePriceChartingCsv', () => {
  it('parses pennies → USD, sales-volume, and the set base number', () => {
    const csv = [
      'id,upc,product-name,new-price,cib-price,loose-price,sales-volume',
      '6910,0673419340373,10300 Back to the Future Time Machine,21000,18000,12500,340',
      '7777,,Not A Set Name,0,0,0,0',
    ].join('\n');
    const rows = parsePriceChartingCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      pcId: '6910', upc: '0673419340373', setBase: '10300',
      newValue: 210, completeValue: 180, looseValue: 125, salesVolume: 340,
    });
    // Zeros → null (PriceCharting returns 0 for no recent sales).
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
    expect(r).toEqual({ pc_id: '6910', new_value: 210, complete_value: 180, loose_value: 125, sales_volume: 340 });
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

  it('matches by UPC and by set number, writing loose + sales-volume', async () => {
    const e: any = { ...env, PRICECHARTING_PRO: '1' };
    const csv = [
      'id,upc,product-name,new-price,cib-price,loose-price,sales-volume',
      '6910,0673419340373,10300 Back to the Future,21000,18000,12500,340', // UPC match
      '5555,,75192 Millennium Falcon,90000,80000,60000,120',                // set-number match
      '9999,,12121 Unknown Set,1000,0,0,5',                                  // no match
    ].join('\n');
    const r = await runPriceChartingBulk(e, csv);
    expect(r.rows).toBe(3);
    expect(r.matched).toBe(2);
    expect(r.unmatched).toBe(1);

    const ext = await db.prepare(`SELECT set_num, pc_loose_value, pc_sales_volume FROM set_market_ext ORDER BY set_num`).all<any>();
    expect(ext.results).toEqual([
      { set_num: '10300-1', pc_loose_value: 125, pc_sales_volume: 340 },
      { set_num: '75192-1', pc_loose_value: 600, pc_sales_volume: 120 },
    ]);
    const ls = await db.prepare(`SELECT pc_new_value FROM lego_sets WHERE set_num='75192-1'`).first<any>();
    expect(ls.pc_new_value).toBe(900);

    // Summary persisted for admin diagnostics.
    const summary = await db.prepare(`SELECT value FROM app_settings WHERE key='pc_bulk_last_result'`).first<any>();
    expect(JSON.parse(summary.value).matched).toBe(2);
  });
});
