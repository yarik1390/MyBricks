/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/firecrawl', () => ({ firecrawlScrape: vi.fn() }));
vi.mock('./lib/http', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/http')>(), fetchWithRetry: vi.fn(),
}));
import { firecrawlScrape } from './lib/firecrawl';
import { fetchWithRetry } from './lib/http';
import { runBricksetEnrich } from './jobs/brickset-enrich';
import { QUOTA_CAPS } from './lib/api-quota';

const db = (env as any).DB as D1Database;
const mockScrape = vi.mocked(firecrawlScrape);
const mockFetch = vi.mocked(fetchWithRetry);
const today = new Date().toISOString().slice(0, 10);
const withKey = { ...env, FIRECRAWL_API_KEY: 'fc', FIRECRAWL_DAILY_CREDITS: '' } as any;

const row = (setNum: string) =>
  db.prepare(`SELECT brickset_msrp AS msrp, retail_price AS retail, brickset_rating AS rating, brickset_tags AS tags, brickset_enriched_at AS at FROM lego_sets WHERE set_num=?`).bind(setNum).first<any>();

describe('runBricksetEnrich', () => {
  beforeEach(async () => {
    mockScrape.mockReset();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response('busy', { status: 503 }));
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota']);
  });

  it('reads Brickset directly and never asks Firecrawl when that works', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('10305-1','Lion Knights', 2022, NULL)`).run();
    mockFetch.mockResolvedValue(new Response('<dl><dt>RRP</dt><dd>$399.99</dd></dl>', { status: 200 }));
    const r = await runBricksetEnrich({ ...env, FIRECRAWL_API_KEY: '', FIRECRAWL_API_KEYS: '' } as any);
    expect(r).toMatchObject({ processed: 1, updated: 1 });
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('skips only the Firecrawl lane once its daily credit ceiling is reached', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('10305-1','Lion Knights', 2022, NULL)`).run();
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('firecrawl', ?1, ?2, ?2)`).bind(today, QUOTA_CAPS.firecrawl).run();
    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 0, failed: 1 });
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('records a set Brickset has no page for as no data, without paid lanes', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('99998-1','Nope', 2020, NULL)`).run();
    mockFetch.mockResolvedValue(new Response('not found', { status: 404 }));
    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, no_data: 1 });
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

  it('fills a missing piece count on a recent set weekly, never replacing a known one', async () => {
    const yr = new Date().getUTCFullYear();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, pieces, brickset_enriched_at) VALUES
      ('21065-1','Sagrada', ?1, 0, datetime('now','-10 days')),
      ('21066-1','Known', ?1, 500, datetime('now','-10 days')),
      ('21067-1','Fresh', ?1, 0, datetime('now','-2 days'))`).bind(yr).run();
    mockScrape.mockResolvedValue(null as any);
    mockFetch.mockResolvedValue(new Response('<dl><dt>Pieces</dt><dd><a href="/inv">12,060</a></dd><dt>RRP</dt><dd>$799.99</dd></dl>', { status: 200 }));
    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 1 });
    expect(mockFetch.mock.calls[0][0]).toBe('https://brickset.com/sets/21065-1');
    const pieces = async (n: string) => (await db.prepare('SELECT pieces FROM lego_sets WHERE set_num=?').bind(n).first<any>()).pieces;
    expect(await pieces('21065-1')).toBe(12060);
    expect(await pieces('21066-1')).toBe(500);
    expect(await pieces('21067-1')).toBe(0);
  });

  it('reads the Brickset page directly first', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('10305-1','Lion Knights', 2022, NULL)`).run();
    mockScrape.mockResolvedValue(null as any);
    mockFetch.mockResolvedValue(new Response('<dl><dt>Theme group</dt><dd>Historical</dd><dt>RRP</dt><dd>$399.99, 349.99€</dd><dt>Rating</dt><dd>4.8 (120 ratings)</dd></dl>', { status: 200 }));
    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 1 });
    expect(mockFetch.mock.calls[0][0]).toBe('https://brickset.com/sets/10305-1');
    const x = await row('10305-1');
    expect(x.msrp).toBe(399.99);
    expect(x.rating).toBe(4.8);
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

  it('refreshes a stale set from the free direct page, not a Firecrawl probe', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, brickset_enriched_at) VALUES ('21318-1','Tree', 2019, datetime('now','-100 days'))`).run();
    mockFetch.mockResolvedValue(new Response('<dl><dt>Rating</dt><dd>4.6 (300 ratings)</dd></dl>', { status: 200 }));
    const r = await runBricksetEnrich(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 1 });
    expect(mockScrape).not.toHaveBeenCalled();
    expect((await row('21318-1')).rating).toBe(4.6);
  });
});
