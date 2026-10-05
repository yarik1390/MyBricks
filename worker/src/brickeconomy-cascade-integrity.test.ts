/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';
vi.mock('./lib/scrapingant', () => ({ scrapingAntEnabled: () => true, scrapingAntFetchHtml: vi.fn() }));
vi.mock('./lib/brightdata-keys', () => ({ brightDataEnabled: () => false }));
vi.mock('./lib/firecrawl', () => ({ FIRECRAWL_MAX_CONCURRENCY: 2, firecrawlScrape: vi.fn() }));
import { scrapingAntFetchHtml } from './lib/scrapingant';
import { runBrickEconomyEnrich } from './jobs/brickeconomy-enrich';
const db = (env as any).DB as D1Database;
const htmlOnly = { ...env, FIRECRAWL_API_KEY: '', FIRECRAWL_API_KEYS: '' } as any;
beforeEach(async () => {
  vi.clearAllMocks();
  await applyTestTables(db, ['lego_sets', 'set_market_ext', 'api_quota', 'user_collection', 'user_wishlist']);
  await db.prepare(`INSERT INTO lego_sets (set_num,name,year,be_value_new,be_cached_at) VALUES ('12345-1','Old',2020,100,'2020-01-01')`).run();
});
it.each([null, '<html>blocked or unparseable</html>'])('HTML-only failure does not become a 90-day no-data observation (%s)', async body => {
  vi.mocked(scrapingAntFetchHtml).mockResolvedValue(body);
  expect(await runBrickEconomyEnrich(htmlOnly, { limit: 1 })).toMatchObject({ processed: 1, failed: 1, no_data: 0 });
  expect(await db.prepare(`SELECT be_value_new,be_cached_at FROM lego_sets`).first()).toEqual({ be_value_new: 100, be_cached_at: '2020-01-01' });
  expect(await db.prepare(`SELECT be_attempt_status FROM set_market_ext`).first()).toEqual({ be_attempt_status: 'error' });
  expect((await runBrickEconomyEnrich(htmlOnly, { limit: 1 })).processed).toBe(0);
  await db.prepare(`UPDATE set_market_ext SET be_attempted_at=datetime('now','-2 hours')`).run();
  expect((await runBrickEconomyEnrich(htmlOnly, { limit: 1 })).processed).toBe(1);
});
