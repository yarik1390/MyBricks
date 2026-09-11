/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBrickPickerBatch } from './lib/brickpicker';
import { runBrickPickerEnrich } from './jobs/brickpicker-enrich';
import { applyTestTables } from './test-schema';
import { clearSourceConfigCache, saveSourceConfig } from './lib/source-config';

const db = (env as any).DB as D1Database;
const liveConfig = { brickpicker: { enabled: true, weight: 0.5, dailyCap: 900, refreshDays: 14 } } as any;

async function seedSet(setNum: string, name = `Set ${setNum}`) {
  await db.prepare('INSERT INTO lego_sets (set_num, name, year) VALUES (?1, ?2, 2020)').bind(setNum, name).run();
}

async function enableBrickPicker() {
  await saveSourceConfig(env as any, liveConfig);
  clearSourceConfigCache();
}

function response(sets: unknown[]) {
  return new Response(JSON.stringify({ data: { sets } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function row(setNumber: string, overrides: Record<string, unknown> = {}) {
  return {
    set_number: setNumber,
    title: `Set ${setNumber}`,
    currency: 'USD',
    market_region: 'US',
    found: true,
    new_value_usd: 120,
    used_value_usd: 80,
    value_range: { low: 70, high: 130, calculated_at: '2026-09-10T07:13:53.909Z' },
    ...overrides,
  };
}

beforeEach(async () => {
  clearSourceConfigCache();
  await applyTestTables(db, [
    'lego_sets', 'user_collection', 'user_wishlist', 'api_quota', 'app_settings',
    'pricing_signals', 'set_valuation_state', 'pricing_write_ledger',
    'set_value_history', 'pricing_source_map',
  ]);
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchBrickPickerBatch', () => {
  it('posts base set ids with bearer auth and preserves modeled calculated_at', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: 'Bearer secret', 'Content-Type': 'application/json' });
      expect(JSON.parse(String(init.body))).toEqual({ sets: ['75192', '10305'] });
      return response([row('75192'), row('10305')]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBrickPickerBatch(['75192-1', '10305-1'], 'secret', new Date('2026-09-11T00:00:00Z'));
    expect(result.results).toHaveLength(2);
    expect(result.results[0].signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ condition: 'new_sealed', signal_type: 'modeled', provider_family: 'ebay_market', source_observed_at: '2026-09-10T07:13:53.909Z', sample_count: null }),
      expect.objectContaining({ condition: 'used_complete', signal_type: 'modeled', provider_family: 'ebay_market' }),
    ]));
  });

  it('rejects unsupported variants, mismatches, duplicates, and malformed rows without conflating ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([
      row('1000'), row('1000', { new_value_usd: 999 }), row('9999'),
      row('1001', { currency: 'EUR' }), row('1002', { market_region: 'GB' }),
    ])));
    const result = await fetchBrickPickerBatch(['1000-1', '1001-1', '1002-1', '1003-2'], 'secret');
    expect(result.results).toEqual([]);
    expect(result.misses).toEqual(['1001-1', '1002-1']);
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'duplicate' }),
      expect.objectContaining({ reason: 'unrequested' }),
      expect.objectContaining({ reason: 'currency' }),
      expect.objectContaining({ reason: 'region' }),
      expect.objectContaining({ setNum: '1003-2', reason: 'variant' }),
    ]));
  });

  it('drops zero/null values and invalid or future calculated_at dates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([
      row('1000', { new_value_usd: 0, used_value_usd: null }),
      row('1001', { value_range: { low: 70, high: 130, calculated_at: 'bad' } }),
      row('1002', { value_range: { low: 70, high: 130, calculated_at: '2026-09-12T00:00:00Z' } }),
    ])));
    const result = await fetchBrickPickerBatch(['1000-1', '1001-1', '1002-1'], 'secret', new Date('2026-09-11T00:00:00Z'));
    expect(result.results).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual(expect.arrayContaining(['no_values', 'calculated_at', 'future_calculated_at']));
  });
});

describe('runBrickPickerEnrich', () => {
  it('is shadow-disabled by default and makes no network call', async () => {
    await seedSet('1000-1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await runBrickPickerEnrich({ ...env, BRICKPICKER_API_KEY: 'secret' } as any);
    expect(result.skipped).toMatch(/disabled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reserves one quota unit per requested item including misses', async () => {
    await enableBrickPicker();
    await Promise.all(['1000-1', '1001-1', '1002-1'].map((s) => seedSet(s)));
    vi.stubGlobal('fetch', vi.fn(async () => response([row('1000'), { set_number: '1001', found: false }])));
    const result = await runBrickPickerEnrich({ ...env, BRICKPICKER_API_KEY: 'secret' } as any, { limit: 3 });
    expect(result).toMatchObject({ requested: 3, updated: 1, misses: 2 });
    const quota = await db.prepare("SELECT used, cap FROM api_quota WHERE service='brickpicker'").first<any>();
    expect(quota).toMatchObject({ used: 3, cap: 900 });
  });

  it('does not call the API when remaining quota cannot cover the selected batch', async () => {
    await enableBrickPicker();
    await Promise.all(['1000-1', '1001-1'].map((s) => seedSet(s)));
    await db.prepare("INSERT INTO api_quota(service, day, used, cap) VALUES('brickpicker', date('now'), 899, 900)").run();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await runBrickPickerEnrich({ ...env, BRICKPICKER_API_KEY: 'secret' } as any, { limit: 2 });
    expect(result.skipped).toMatch(/quota/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prioritizes owned then wishlist and skips fresh or backed-off misses', async () => {
    await enableBrickPicker();
    for (const setNum of ['1000-1', '1001-1', '1002-1', '1003-1']) await seedSet(setNum);
    await db.prepare("INSERT INTO user_collection(user_id,set_num,quantity,condition,purchase_price,purchased_at) VALUES('u','1001-1',1,'new',1,'2026-01-01')").run();
    await db.prepare("INSERT INTO user_wishlist(user_id,set_num) VALUES('u','1002-1')").run();
    await db.prepare("INSERT INTO pricing_signals(set_num,source,provider_family,condition,signal_type,currency,value,checked_at,source_observed_at,match_status) VALUES('1001-1','brickpicker','ebay_market','new_sealed','modeled','USD',10,datetime('now'),'2026-09-10T00:00:00Z','verified')").run();
    await db.prepare("INSERT INTO pricing_source_map(source,source_item_id,set_num,status,updated_at) VALUES('brickpicker','1002','1002-1','not_found',datetime('now'))").run();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ sets: ['1000', '1003'] });
      return response([row('1000'), row('1003')]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await runBrickPickerEnrich({ ...env, BRICKPICKER_API_KEY: 'secret' } as any, { limit: 2 });
    expect(result.updated).toBe(2);
  });

  it('backs misses off and persists no invented counts', async () => {
    await enableBrickPicker();
    await seedSet('1000-1');
    vi.stubGlobal('fetch', vi.fn(async () => response([])));
    const result = await runBrickPickerEnrich({ ...env, BRICKPICKER_API_KEY: 'secret' } as any, { limit: 1 });
    expect(result.misses).toBe(1);
    const mapping = await db.prepare("SELECT status FROM pricing_source_map WHERE set_num='1000-1' AND source='brickpicker'").first<any>();
    expect(mapping?.status).toBe('not_found');
    const count = await db.prepare("SELECT COUNT(*) as c FROM pricing_signals WHERE set_num='1000-1' AND source='brickpicker'").first<any>();
    expect(count?.c).toBe(0);
  });
});

