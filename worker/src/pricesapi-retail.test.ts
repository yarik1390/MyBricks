/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';
import { saveSourceConfig, clearSourceConfigCache } from './lib/source-config';

vi.mock('./lib/pricesapi', () => ({ pricesApiSearch: vi.fn() }));
import { pricesApiSearch } from './lib/pricesapi';
import { runPricesApiRetail } from './jobs/pricesapi-retail';

const db = (env as any).DB as D1Database;
const mockSearch = vi.mocked(pricesApiSearch);
const today = new Date().toISOString().slice(0, 10);
// Env with the key + explicit opt-in; the admin source-config gate is separate.
const on = { ...env, PRICESAPI_API_KEYS: 'k1', PRICESAPI_ENABLED: '1' } as any;

async function enableSourceAndSeed() {
  await saveSourceConfig(on, { pricesapi: { enabled: true } } as any);
  await db.prepare(`INSERT INTO lego_sets (set_num, name, year) VALUES ('75300-1','X-Wing', 2020)`).run();
}

describe('runPricesApiRetail', () => {
  beforeEach(async () => {
    mockSearch.mockReset();
    clearSourceConfigCache();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota', 'app_settings']);
  });

  it('skips when pricesAPI is not opted in via env', async () => {
    const r = await runPricesApiRetail({ ...env, PRICESAPI_API_KEYS: 'k1', PRICESAPI_ENABLED: '' } as any);
    expect(r.skipped).toMatch(/pricesAPI disabled \(set/);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('skips when the admin source-tuning kill-switch is off (default)', async () => {
    // env opt-in present, but source_config.pricesapi.enabled defaults to false.
    const r = await runPricesApiRetail(on);
    expect(r.skipped).toMatch(/admin source tuning/);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('skips when the daily pricesAPI cap is already reached', async () => {
    await enableSourceAndSeed();
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('pricesapi', ?1, 60, 60)`).bind(today).run();
    const r = await runPricesApiRetail(on);
    expect(r.skipped).toMatch(/daily pricesapi cap reached/);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('writes the pa_* live-retail fields on a hit', async () => {
    await enableSourceAndSeed();
    mockSearch.mockResolvedValue({ retail_value: 100, lowest_offer: 80, in_stock: true, best_merchant: 'Amazon', offer_count: 5, market: 'US' } as any);
    const r = await runPricesApiRetail(on, { limit: 1 });
    expect(r).toMatchObject({ processed: 1, updated: 1 });
    const ext = await db.prepare(`SELECT pa_retail_value, pa_lowest_offer, pa_in_stock, pa_best_merchant, pa_cached_at FROM set_market_ext WHERE set_num='75300-1'`)
      .first<{ pa_retail_value: number; pa_lowest_offer: number; pa_in_stock: number; pa_best_merchant: string; pa_cached_at: string }>();
    expect(ext!.pa_retail_value).toBe(100);
    expect(ext!.pa_lowest_offer).toBe(80);
    expect(ext!.pa_in_stock).toBe(1);
    expect(ext!.pa_best_merchant).toBe('Amazon');
    expect(ext!.pa_cached_at).toBeTruthy();
  });

  it('stamps pa_cached_at without values when the provider has no coverage', async () => {
    await enableSourceAndSeed();
    mockSearch.mockResolvedValue(null as any); // both the base-num and name queries miss
    const r = await runPricesApiRetail(on, { limit: 1 });
    expect(r).toMatchObject({ processed: 1, updated: 0 });
    const ext = await db.prepare(`SELECT pa_retail_value, pa_cached_at FROM set_market_ext WHERE set_num='75300-1'`)
      .first<{ pa_retail_value: number | null; pa_cached_at: string }>();
    expect(ext!.pa_retail_value).toBeNull();
    expect(ext!.pa_cached_at).toBeTruthy();
  });
});
