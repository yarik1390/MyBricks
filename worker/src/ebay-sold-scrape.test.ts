/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runEbaySoldScrape } from './jobs/ebay-sold-scrape';
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

  it('reserves quota only after confirming a live key (no eligible sets → clean no-op)', async () => {
    // Live token (no exhausted ledger row) but zero eligible sets. The job should
    // confirm the key, THEN reserve, then find nothing to do — proving the ordering.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const r = await runEbaySoldScrape({ ...bare, BRIGHTDATA_API_TOKENS: 'tkB' } as any, { limit: 20 });

    expect(r.skipped).toBeUndefined();
    expect(r.processed).toBe(0);
    expect(r.limit).toBe(20);
    expect(await brightdataUsedToday()).toBe(20); // reserved AFTER the live-key check
    expect(fetchSpy).not.toHaveBeenCalled(); // no eligible rows → no scrape
  });
});
