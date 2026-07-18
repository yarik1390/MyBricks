/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runEbaySoldScrape } from './jobs/ebay-sold-scrape';
import { fetchEbaySoldViaBrightData } from './lib/brightdata';
import { fetchEbaySoldViaFirecrawl } from './lib/ebay-firecrawl';

// The scrape job is exercised against a module-mocked Bright Data fetcher so
// tests control per-set outcomes (ok / no_data / error) without 50KB HTML
// fixtures. pickKey/recordKeyCall live in brightdata-keys and stay real.
vi.mock('./lib/brightdata', () => ({ fetchEbaySoldViaBrightData: vi.fn() }));
vi.mock('./lib/ebay-firecrawl', () => ({ fetchEbaySoldViaFirecrawl: vi.fn() }));
const mockFetcher = vi.mocked(fetchEbaySoldViaBrightData);
const mockFcFetcher = vi.mocked(fetchEbaySoldViaFirecrawl);
import { hashKey } from './lib/brightdata-keys';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7);

// Base env with every scraper source OFF; each test opts in explicitly.
const bare = {
  ...env,
  BRIGHTDATA_API_TOKEN: '',
  BRIGHTDATA_API_TOKENS: '',
  FIRECRAWL_API_KEY: '',
  FIRECRAWL_API_KEYS: '',
};

async function brightdataUsedToday(): Promise<number | null> {
  const row = await db.prepare(`SELECT used FROM api_quota WHERE service='brightdata' AND day=?1`).bind(today).first<{ used: number }>();
  return row ? Number(row.used) : null;
}

describe('runEbaySoldScrape', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'api_quota', 'brightdata_keys', 'integration_health']);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('skips when neither Bright Data nor Firecrawl is configured', async () => {
    const r = await runEbaySoldScrape(bare as any);
    expect(r.skipped).toMatch(/neither firecrawl nor brightdata/);
  });

  it('does NOT reserve daily quota when the Bright Data key pool is exhausted', async () => {
    // A configured token, but its ledger row is latched exhausted for this month →
    // pickKey() returns null. The reserve-after-live-key guard must skip BEFORE
    // debiting the api_quota ledger (else the admin usage panel over-reports).
    const hash = await hashKey('tkA');
    await db.prepare(
      `INSERT INTO brightdata_keys (key_hash, used, cap, period_month, exhausted_at) VALUES (?1, 0, 4900, ?2, datetime('now'))`,
    ).bind(hash, month).run();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkA' } as any);

    expect(r.skipped).toMatch(/all keys exhausted/);
    expect(await brightdataUsedToday()).toBeNull(); // ledger never touched
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reserves NO quota when there are no eligible sets (reserve-after-filter)', async () => {
    // Live token but zero eligible sets: with reservation moved AFTER candidate
    // selection + negative-cache filtering, an empty run must not debit the
    // api_quota ledger at all (it used to book the full limit up front).
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 20 });

    expect(r.processed).toBe(0);
    expect(await brightdataUsedToday()).toBeNull(); // ledger never touched
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  function kvStub() {
    const store = new Map<string, string>();
    return {
      store,
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
    };
  }

  it('no_data writes the KV skip key and leaves ebay_new_cached_at NULL', async () => {
    const kv = kvStub();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('ND-1','NoData Set', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'no_data', new_value: null, new_count: 0 } as any);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB', CACHE_KV: kv } as any, { limit: 5 });

    expect(r.processed).toBe(1);
    expect(r.updated).toBe(0);
    expect(kv.store.get('ebay-sold:skip:ND-1')).toBe('no_data');
    const row = await db.prepare(`SELECT ebay_new_cached_at FROM lego_sets WHERE set_num='ND-1'`).first<{ ebay_new_cached_at: string | null }>();
    expect(row!.ebay_new_cached_at).toBeNull(); // KV, never a freshness stamp
  });

  it('provider error writes the short-TTL skip key', async () => {
    const kv = kvStub();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('ER-1','Err Set', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'boom' } as any);

    await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB', CACHE_KV: kv } as any, { limit: 5 });

    expect(kv.store.get('ebay-sold:skip:ER-1')).toBe('err');
  });

  it('pre-seeded skip keys exclude sets and quota books only the scraped count', async () => {
    const kv = kvStub();
    kv.store.set('ebay-sold:skip:SK-1', 'no_data');
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('SK-1','Skipped', 100)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('SK-2','Scraped', 100)`),
    ]);
    mockFetcher.mockResolvedValue({ status: 'ok', new_value: 110, new_count: 6 } as any);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB', CACHE_KV: kv } as any, { limit: 10 });

    expect(r.processed).toBe(1); // only SK-2
    expect(r.updated).toBe(1);
    expect(await brightdataUsedToday()).toBe(1); // reserved for the FILTERED count
    const skipped = await db.prepare(`SELECT ebay_new_value FROM lego_sets WHERE set_num='SK-1'`).first<{ ebay_new_value: number | null }>();
    expect(skipped!.ebay_new_value).toBeNull();
    const scraped = await db.prepare(`SELECT ebay_new_value FROM lego_sets WHERE set_num='SK-2'`).first<{ ebay_new_value: number | null }>();
    expect(scraped!.ebay_new_value).toBe(110);
  });

  it('3x-divergence rejection writes the anomaly row AND the skip key', async () => {
    await applyTestTables(db, ['pricing_anomalies']);
    const kv = kvStub();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('DV-1','Diverged', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'ok', new_value: 900, new_count: 4 } as any); // 9x the reference

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB', CACHE_KV: kv } as any, { limit: 5 });

    expect(r.rejected).toBe(1);
    expect(r.updated).toBe(0);
    expect(kv.store.get('ebay-sold:skip:DV-1')).toBe('diverged');
    const anomaly = await db.prepare(`SELECT status FROM pricing_anomalies WHERE anomaly_key='ebay_sold:DV-1:value_divergence'`).first<{ status: string }>();
    expect(anomaly!.status).toBe('open');
  });


  // --- Firecrawl rescue lane (Bright Data primary + FC configured) ---
  const rescueEnv = { ...bare, BRIGHTDATA_API_TOKENS: 'tkB', FIRECRAWL_API_KEY: 'fk' };

  it('rescues a Bright Data failure through Firecrawl and writes the value', async () => {
    const kv = kvStub();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('RS-1','Rescued', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'blocked' } as any);
    mockFcFetcher.mockResolvedValue({ status: 'ok', new_value: 120, new_count: 5 } as any);

    const r = await runEbaySoldScrape({ ...rescueEnv, CACHE_KV: kv } as any, { limit: 5 });

    expect(r.rescued).toBe(1);
    expect(r.updated).toBe(1);
    expect(kv.store.has('ebay-sold:skip:RS-1')).toBe(false); // rescued, not negative-cached
    const row = await db.prepare(`SELECT ebay_new_value FROM lego_sets WHERE set_num='RS-1'`).first<{ ebay_new_value: number | null }>();
    expect(row!.ebay_new_value).toBe(120);
  });

  it('rescue returning no_data writes the long-TTL skip key, not err', async () => {
    const kv = kvStub();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('RS-2','NoDataRescue', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'blocked' } as any);
    mockFcFetcher.mockResolvedValue({ status: 'no_data', new_value: null, new_count: 0 } as any);

    const r = await runEbaySoldScrape({ ...rescueEnv, CACHE_KV: kv } as any, { limit: 5 });

    expect(r.rescued).toBe(1);
    expect(kv.store.get('ebay-sold:skip:RS-2')).toBe('no_data');
  });

  it('when the rescue also fails, the set is err-cached as before', async () => {
    const kv = kvStub();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('RS-3','DoubleFail', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'blocked' } as any);
    mockFcFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'fc down' } as any);

    const r = await runEbaySoldScrape({ ...rescueEnv, CACHE_KV: kv } as any, { limit: 5 });

    expect(r.rescued).toBe(0);
    expect(kv.store.get('ebay-sold:skip:RS-3')).toBe('err');
  });
});
