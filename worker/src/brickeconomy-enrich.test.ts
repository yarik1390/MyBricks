/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

// Mock the Firecrawl scrape so the job logic (sparse update, miss-stamping,
// counts) is tested without any real Firecrawl HTTP / credit spend.
vi.mock('./lib/brickeconomy-firecrawl', () => ({ fetchBrickEconomyViaFirecrawl: vi.fn() }));
import { fetchBrickEconomyViaFirecrawl } from './lib/brickeconomy-firecrawl';
import { runBrickEconomyEnrich } from './jobs/brickeconomy-enrich';
import { QUOTA_CAPS } from './lib/api-quota';

const db = (env as any).DB as D1Database;
const mockScrape = vi.mocked(fetchBrickEconomyViaFirecrawl);
const today = new Date().toISOString().slice(0, 10);
const withKey = { ...env, FIRECRAWL_API_KEY: 'fc-key', FIRECRAWL_DAILY_CREDITS: '' } as any;

describe('runBrickEconomyEnrich', () => {
  beforeEach(async () => {
    mockScrape.mockReset();
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'api_quota']);
  });

  it('skips when Firecrawl is not configured', async () => {
    const r = await runBrickEconomyEnrich({ ...env, FIRECRAWL_API_KEY: '', FIRECRAWL_API_KEYS: '' } as any);
    expect(r.skipped).toMatch(/firecrawl disabled or no key/);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('skips when the daily Firecrawl credit ceiling is reached', async () => {
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('firecrawl', ?1, ?2, ?2)`).bind(today, QUOTA_CAPS.firecrawl).run();
    const r = await runBrickEconomyEnrich(withKey);
    expect(r.skipped).toMatch(/firecrawl daily ceiling/);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('writes only the be_* fields the scrape returned (sparse update)', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, be_cached_at) VALUES ('75192-1','Falcon', 2017, NULL)`).run();
    mockScrape.mockResolvedValue({
      current_value_new: 120, current_value_used: 80,
      forecast_value_new_2_years: 140, forecast_value_new_5_years: 180,
      retail_price_us: 100, rolling_growth_12months: 5,
    } as any);

    const r = await runBrickEconomyEnrich(withKey);

    expect(r.processed).toBe(1);
    expect(r.updated).toBe(1);
    const row = await db.prepare(`SELECT be_value_new, be_value_used, be_forecast_2y, be_forecast_5y, be_retail, be_growth_12m, be_cached_at FROM lego_sets WHERE set_num='75192-1'`)
      .first<any>();
    expect(row.be_value_new).toBe(120);
    expect(row.be_value_used).toBe(80);
    expect(row.be_forecast_2y).toBe(140);
    expect(row.be_forecast_5y).toBe(180);
    expect(row.be_retail).toBe(100);
    expect(row.be_growth_12m).toBe(5);
    expect(row.be_cached_at).toBeTruthy();
  });

  it('stamps be_cached_at without writing values when the scrape yields nothing', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, be_cached_at) VALUES ('00000-1','Unknown', 2015, NULL)`).run();
    mockScrape.mockResolvedValue(null as any);

    const r = await runBrickEconomyEnrich(withKey);

    expect(r.processed).toBe(1);
    expect(r.updated).toBe(0);
    const row = await db.prepare(`SELECT be_value_new, be_cached_at FROM lego_sets WHERE set_num='00000-1'`).first<{ be_value_new: number | null; be_cached_at: string | null }>();
    expect(row!.be_value_new).toBeNull();      // nothing written
    expect(row!.be_cached_at).toBeTruthy();     // but parked so it isn't re-scraped
  });

  // BrickEconomy is the widest price source in the app (15,154 sets) and 98.8%
  // of it had gone stale under a single 90-day gate. The gate is now split: sets
  // that HAVE data refresh weekly, sets BrickEconomy has nothing for stay on 90
  // days. That split is the Firecrawl-credit governor, so it is worth pinning.
  describe('split refresh cadence', () => {
    const seedAged = (setNum: string, days: number, beValue: number | null) => db.prepare(
      `INSERT INTO lego_sets (set_num, name, year, be_value_new, be_cached_at)
       VALUES (?1, 'Aged', 2015, ?2, datetime('now', '-${days} days'))`,
    ).bind(setNum, beValue).run();

    it('re-scrapes a covered set past the weekly gate but not an empty one', async () => {
      await seedAged('COVERED-1', 10, 120);   // has data, 10 days old -> due
      await seedAged('EMPTY-1', 10, null);    // no data, 10 days old  -> not due
      mockScrape.mockResolvedValue({ current_value_new: 130 } as any);

      const r = await runBrickEconomyEnrich(withKey);

      expect(r.processed).toBe(1);
      expect(mockScrape).toHaveBeenCalledWith('COVERED-1', expect.anything());
    });

    it('still re-scrapes an empty set once it passes the 90-day gate', async () => {
      await seedAged('EMPTY-2', 120, null);
      mockScrape.mockResolvedValue(null as any);

      const r = await runBrickEconomyEnrich(withKey);

      expect(r.processed).toBe(1);
    });

    it('honours BRICKECONOMY_REFRESH_DAYS as the credit dial', async () => {
      await seedAged('COVERED-2', 10, 120);
      mockScrape.mockResolvedValue({ current_value_new: 130 } as any);

      // 21 days -> a 10-day-old set is not yet due, so the burn drops ~3x.
      const r = await runBrickEconomyEnrich({ ...withKey, BRICKECONOMY_REFRESH_DAYS: '21' });

      expect(r.processed).toBe(0);
      expect(mockScrape).not.toHaveBeenCalled();
    });
  });
});
