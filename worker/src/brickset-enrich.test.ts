/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/firecrawl', () => ({ firecrawlScrape: vi.fn() }));
import { firecrawlScrape } from './lib/firecrawl';
import { runBricksetEnrich } from './jobs/brickset-enrich';
import { QUOTA_CAPS } from './lib/api-quota';

const db = (env as any).DB as D1Database;
const mockScrape = vi.mocked(firecrawlScrape);
const today = new Date().toISOString().slice(0, 10);
const withKey = { ...env, FIRECRAWL_API_KEY: 'fc', FIRECRAWL_DAILY_CREDITS: '' } as any;

const row = (setNum: string) =>
  db.prepare(`SELECT brickset_msrp AS msrp, retail_price AS retail, brickset_rating AS rating, brickset_tags AS tags, brickset_enriched_at AS at FROM lego_sets WHERE set_num=?`).bind(setNum).first<any>();

describe('runBricksetEnrich', () => {
  beforeEach(async () => {
    mockScrape.mockReset();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota']);
  });

  it('skips when Firecrawl is not configured', async () => {
    const r = await runBricksetEnrich({ ...env, FIRECRAWL_API_KEY: '', FIRECRAWL_API_KEYS: '' } as any);
    expect(r.skipped).toMatch(/ScrapingAnt, Bright Data, and Firecrawl disabled or unconfigured/);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('skips when the daily Firecrawl credit ceiling is reached', async () => {
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('firecrawl', ?1, ?2, ?2)`).bind(today, QUOTA_CAPS.firecrawl).run();
    const r = await runBricksetEnrich(withKey);
    expect(r.skipped).toMatch(/firecrawl daily ceiling/);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('sparse-writes plausible fields and seeds retail_price from MSRP', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('10300-1','BTTF', 2022, NULL)`).run();
    mockScrape.mockResolvedValue({ data: {
      msrp_usd: 169.99, launch_date: '2022-04-01', theme_group: 'Icons',
      age_min: 18, rating: 4.7, review_count: 500, tags: ['licensed', 'vehicle'], brickset_set_id: 30123,
    } } as any);

    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 1 });
    const x = await row('10300-1');
    expect(x.msrp).toBe(169.99);
    expect(x.retail).toBe(169.99); // COALESCE-seeded from MSRP
    expect(x.rating).toBe(4.7);
    expect(x.tags).toBe(JSON.stringify(['licensed', 'vehicle']));
    expect(x.at).toBeTruthy();
  });

  it('does not claim enrichment when every extracted value is rejected', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('99999-1','Bogus', 2015, NULL)`).run();
    mockScrape.mockResolvedValue({ data: { msrp_usd: 999999, rating: 9, age_min: 500 } } as any);

    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 0, no_data: 1 });
    const x = await row('99999-1');
    expect(x.msrp).toBeNull();   // 999999 > 2000 cap → dropped
    expect(x.retail).toBeNull(); // not seeded from an implausible MSRP
    expect(x.rating).toBeNull(); // 9 > 5 → dropped
    expect(x.at).toBeNull(); // rejected extraction is not a source observation
  });

  it('does not stamp a provider scrape failure as enriched', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('00000-1','Missing', 2015, NULL)`).run();
    mockScrape.mockResolvedValue(null as any);
    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 0 });
    const x = await row('00000-1');
    expect(x.at).toBeNull();
  });

  it.each([null, { data: {} }] as const)('rotates rejected candidates without claiming enrichment (%s)', async response => {
    await db.prepare(`INSERT INTO lego_sets (set_num,name,year) VALUES ('MISS-1','Miss',2025),('GOOD-1','Good',2024)`).run();
    mockScrape.mockResolvedValueOnce(response as any);
    const first = await runBricksetEnrich(withKey, { limit: 1 });
    expect(first.updated).toBe(0);
    mockScrape.mockResolvedValueOnce({ data: { msrp_usd: 50 } } as any);
    expect(await runBricksetEnrich(withKey, { limit: 1 })).toMatchObject({ updated: 1 });
    expect((await row('MISS-1')).at).toBeNull();
    expect((await row('GOOD-1')).msrp).toBe(50);
    await db.prepare(`UPDATE set_market_ext SET brickset_attempted_at=datetime('now','-2 hours') WHERE set_num='MISS-1'`).run();
    mockScrape.mockResolvedValue(null as any);
    expect((await runBricksetEnrich(withKey, { limit: 1 })).processed).toBe(response === null ? 1 : 0);
  });

  it('rotates daily provider failures after the hourly error cooldown expires', async () => {
    await db.prepare(`INSERT INTO lego_sets(set_num,name,year) VALUES('A-1','A',2025),('B-1','B',2024)`).run();
    mockScrape.mockResolvedValue(null);
    await runBricksetEnrich(withKey, { limit: 1 });
    await db.prepare(`UPDATE set_market_ext SET brickset_attempted_at=datetime('now','-25 hours')`).run();
    expect((await runBricksetEnrich(withKey, { limit: 1 })).processed).toBe(1);
    expect(await db.prepare(`SELECT set_num FROM set_market_ext ORDER BY set_num`).all()).toMatchObject({ results: [{ set_num: 'A-1' }, { set_num: 'B-1' }] });
  });

  it('uses a cheap change-probe on refresh and skips the full extract when unchanged', async () => {
    // Already-enriched but stale (>90d) → eligible, and takes the change-tracking path.
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('21318-1','Tree', 2019, datetime('now','-100 days'))`).run();
    mockScrape.mockResolvedValue({ data: { changeTracking: { changeStatus: 'same' } } } as any);

    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 0, unchanged: 1 });
    expect(mockScrape).toHaveBeenCalledTimes(1); // only the probe, no json re-extract
    const x = await row('21318-1');
    expect(x.at).toBeTruthy(); // freshness refreshed
  });
});
