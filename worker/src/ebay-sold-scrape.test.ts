/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runEbaySoldScrape } from './jobs/ebay-sold-scrape';
import { fetchEbaySoldViaBrightData } from './lib/brightdata';
import { fetchEbaySoldViaFirecrawl } from './lib/ebay-firecrawl';

// The scrape job is exercised against a module-mocked Bright Data fetcher so
// tests control per-set outcomes (ok / partial / no_data / error) without HTML
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
    vi.clearAllMocks(); // reset fetcher call history so cross-test calls don't leak
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota', 'brightdata_keys', 'integration_health', 'pricing_write_ledger']);
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

  // Misses use condition-specific SQL cooldown markers. Success timestamps remain
  // blend-facing and are never written when that condition has no evidence.
  const attemptedAt = async (setNum: string, condition: 'new' | 'used' = 'new'): Promise<string | null> => {
    const column = condition === 'new' ? 'ebay_sold_attempted_at' : 'ebay_used_attempted_at';
    const row = await db.prepare(`SELECT ${column} AS attempted_at FROM set_market_ext WHERE set_num=?1`)
      .bind(setNum).first<{ attempted_at: string | null }>();
    return row?.attempted_at ?? null;
  };

  it('no_data stamps both condition attempts without stamping blend freshness', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('ND-1','NoData Set', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'no_data', new_value: null, new_count: 0 } as any);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 5 });

    expect(r.processed).toBe(1);
    expect(r.updated).toBe(0);
    expect(await attemptedAt('ND-1', 'new')).not.toBeNull();
    expect(await attemptedAt('ND-1', 'used')).not.toBeNull();
    const row = await db.prepare(`SELECT ebay_new_cached_at, ebay_used_cached_at FROM lego_sets WHERE set_num='ND-1'`)
      .first<{ ebay_new_cached_at: string | null; ebay_used_cached_at: string | null }>();
    expect(row!.ebay_new_cached_at).toBeNull();
    expect(row!.ebay_used_cached_at).toBeNull();
    const ledger = await db.prepare(`
      SELECT rows_written FROM pricing_write_ledger
      WHERE day=date('now') AND job='ebay-sold-scrape'
    `).first<{ rows_written: number }>();
    expect(Number(ledger?.rows_written)).toBe(2);
  });

  it('provider error stamps the attempt marker', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('ER-1','Err Set', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'boom' } as any);

    await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 5 });

    expect(await attemptedAt('ER-1', 'new')).not.toBeNull();
    expect(await attemptedAt('ER-1', 'used')).not.toBeNull();
  });

  it('a recently-attempted set is excluded and quota books only the scraped count', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('SK-1','Skipped', 100)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('SK-2','Scraped', 100)`),
      // SK-1 was attempted just now → inside the 14-day cooldown → excluded.
      db.prepare(`INSERT INTO set_market_ext (set_num, ebay_sold_attempted_at, ebay_used_attempted_at) VALUES ('SK-1', datetime('now'), datetime('now'))`),
    ]);
    mockFetcher.mockResolvedValue({ status: 'ok', new_value: 110, new_count: 6 } as any);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 10 });

    expect(r.processed).toBe(1); // only SK-2
    expect(r.updated).toBe(1);
    expect(await brightdataUsedToday()).toBe(2); // one request per due condition
    const skipped = await db.prepare(`SELECT ebay_new_value FROM lego_sets WHERE set_num='SK-1'`).first<{ ebay_new_value: number | null }>();
    expect(skipped!.ebay_new_value).toBeNull();
    const scraped = await db.prepare(`SELECT ebay_new_value FROM lego_sets WHERE set_num='SK-2'`).first<{ ebay_new_value: number | null }>();
    expect(scraped!.ebay_new_value).toBe(110);
  });

  it('persists used sold comps independently when new comps are absent', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value, used_value) VALUES ('US-1','Used Market', 120, 80)`).run();
    mockFetcher.mockResolvedValue({
      status: 'partial',
      new_value: null,
      new_count: 0,
      used_value: 75,
      used_count: 8,
      used_last_sold: '2026-07-20',
      error: 'new condition blocked',
    } as any);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 5 });

    expect(r.updated).toBe(1);
    expect(r.newUpdated).toBe(0);
    expect(r.usedUpdated).toBe(1);
    expect(await attemptedAt('US-1', 'new')).not.toBeNull();
    expect(await attemptedAt('US-1', 'used')).toBeNull();
    const row = await db.prepare(`
      SELECT ebay_new_value, ebay_new_cached_at, ebay_used_value, ebay_used_qty,
        ebay_used_cached_at, ebay_used_last_sold
      FROM lego_sets WHERE set_num='US-1'
    `).first<any>();
    expect(row.ebay_new_value).toBeNull();
    expect(row.ebay_new_cached_at).toBeNull();
    expect(row.ebay_used_value).toBe(75);
    expect(row.ebay_used_qty).toBe(8);
    expect(row.ebay_used_cached_at).not.toBeNull();
    expect(row.ebay_used_last_sold).toBe('2026-07-20');
  });

  it('requests and reserves only the stale condition', async () => {
    await db.prepare(`
      INSERT INTO lego_sets (
        set_num, name, bl_new_value, used_value, ebay_new_value, ebay_new_cached_at
      ) VALUES ('UD-1','Used Due', 120, 80, 125, datetime('now'))
    `).run();
    mockFetcher.mockResolvedValue({
      status: 'ok',
      new_value: null,
      new_count: 0,
      used_value: 78,
      used_count: 6,
    } as any);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 5 });

    expect(r.usedUpdated).toBe(1);
    expect(await brightdataUsedToday()).toBe(1);
    expect(mockFetcher).toHaveBeenCalledWith(
      'UD-1',
      'Used Due',
      expect.anything(),
      { includeNew: false, includeUsed: true },
    );
  });

  it('does not let a new-condition success hide a used-condition miss', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('NS-1','New Only', 100)`).run();
    mockFetcher.mockResolvedValue({
      status: 'partial',
      new_value: 105,
      new_count: 5,
      used_value: null,
      used_count: 0,
      error: 'used condition blocked',
    } as any);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 5 });

    expect(r.newUpdated).toBe(1);
    expect(r.usedUpdated).toBe(0);
    expect(await attemptedAt('NS-1', 'new')).toBeNull();
    expect(await attemptedAt('NS-1', 'used')).not.toBeNull();
    const row = await db.prepare(`SELECT ebay_new_cached_at, ebay_used_cached_at FROM lego_sets WHERE set_num='NS-1'`).first<any>();
    expect(row.ebay_new_cached_at).not.toBeNull();
    expect(row.ebay_used_cached_at).toBeNull();
  });

  it('3x-divergence rejection writes the anomaly row AND stamps the attempt', async () => {
    await applyTestTables(db, ['pricing_anomalies']);
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('DV-1','Diverged', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'ok', new_value: 900, new_count: 4 } as any); // 9x the reference

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 5 });

    expect(r.rejected).toBe(1);
    expect(r.updated).toBe(0);
    expect(await attemptedAt('DV-1')).not.toBeNull();
    const anomaly = await db.prepare(`SELECT status FROM pricing_anomalies WHERE anomaly_key='ebay_sold:DV-1:value_divergence'`).first<{ status: string }>();
    expect(anomaly!.status).toBe('open');
  });

  it('preferFirecrawl forces Firecrawl primary with no Bright Data token', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('FB-1','FcBackfill', 100)`).run();
    mockFcFetcher.mockResolvedValue({ status: 'ok', new_value: 108, new_count: 7 } as any);

    const r = await runEbaySoldScrape({ ...bare, FIRECRAWL_API_KEY: 'fk' } as any, { limit: 5, preferFirecrawl: true });

    expect(r.updated).toBe(1);
    expect(mockFcFetcher).toHaveBeenCalled();
    expect(mockFetcher).not.toHaveBeenCalled();             // Bright Data bypassed
    const row = await db.prepare(`SELECT ebay_new_value FROM lego_sets WHERE set_num='FB-1'`).first<{ ebay_new_value: number | null }>();
    expect(row!.ebay_new_value).toBe(108);
  });


  // --- Firecrawl rescue lane (Bright Data primary + FC configured) ---
  const rescueEnv = { ...bare, BRIGHTDATA_API_TOKENS: 'tkB', FIRECRAWL_API_KEY: 'fk' };

  it('rescues a Bright Data failure through Firecrawl and writes the value', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('RS-1','Rescued', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'blocked' } as any);
    mockFcFetcher.mockResolvedValue({ status: 'ok', new_value: 120, new_count: 5 } as any);

    const r = await runEbaySoldScrape({ ...rescueEnv } as any, { limit: 5 });

    expect(r.rescued).toBe(1);
    expect(r.updated).toBe(1);
    expect(await attemptedAt('RS-1')).toBeNull();           // rescued success → no cooldown marker
    const row = await db.prepare(`SELECT ebay_new_value FROM lego_sets WHERE set_num='RS-1'`).first<{ ebay_new_value: number | null }>();
    expect(row!.ebay_new_value).toBe(120);
  });

  it('rescue returning no_data stamps the attempt marker', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('RS-2','NoDataRescue', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'blocked' } as any);
    mockFcFetcher.mockResolvedValue({ status: 'no_data', new_value: null, new_count: 0 } as any);

    const r = await runEbaySoldScrape({ ...rescueEnv } as any, { limit: 5 });

    expect(r.rescued).toBe(1);
    expect(await attemptedAt('RS-2')).not.toBeNull();
  });

  it('when the rescue also fails, the attempt marker is stamped', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, bl_new_value) VALUES ('RS-3','DoubleFail', 100)`).run();
    mockFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'blocked' } as any);
    mockFcFetcher.mockResolvedValue({ status: 'error', new_value: null, new_count: 0, error: 'fc down' } as any);

    const r = await runEbaySoldScrape({ ...rescueEnv } as any, { limit: 5 });

    expect(r.rescued).toBe(0);
    expect(await attemptedAt('RS-3')).not.toBeNull();
  });
});
